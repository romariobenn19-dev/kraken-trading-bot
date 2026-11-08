#!/usr/bin/env python3
"""
kraken_bot.py - Kraken spot trend/pullback bot. PAPER TRADING BY DEFAULT.

    python kraken_bot.py                    one paper run (use cron / Task Scheduler)
    python kraken_bot.py --loop             paper-trade continuously, once per candle
    python kraken_bot.py --status           show open positions and results (no trading)
    python kraken_bot.py --check-live       verify API keys + stop-order syntax (no real orders)
    python kraken_bot.py --live --i-understand-the-risks      REAL MONEY

Design notes
  * Strategy logic lives in strategy.py (shared with backtest.py).
  * Separate state files for paper and live, so they can never be mixed up.
  * Only positions this bot opened are tracked/managed; your other holdings
    are never counted, sold, or sized against.
  * Signals use CLOSED candles only. Entries/exits use live bid/ask.
  * Live stop-loss orders live on the exchange; every run verifies they are
    still open, re-places them if they were cancelled, and detects fills.
  * Take-profit is bot-managed (checked each run) because Kraken spot has no
    OCO and the stop order locks the coins.
  * Paper fills include fees and slippage, gaps through stops fill at the open,
    and stops are checked before targets when one candle spans both.
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

import strategy as st
from strategy import Config

log = logging.getLogger("bot")

TRADE_FIELDS = [
    "symbol", "opened_at", "closed_at", "qty", "entry_price", "exit_price",
    "entry_fee", "exit_fee", "pnl", "pnl_pct", "reason",
]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Single-instance lock
# --------------------------------------------------------------------------- #


class RunLock:
    """Prevents overlapping runs (cron + loop, or a slow run still going)."""

    def __init__(self, path: str, stale_seconds: int = 1800):
        self.path = path
        self.stale_seconds = stale_seconds

    def __enter__(self):
        for _ in range(2):
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode())
                os.close(fd)
                return self
            except FileExistsError:
                age = time.time() - os.path.getmtime(self.path)
                if age > self.stale_seconds:
                    log.warning(f"Removing stale lock ({age:.0f}s old): {self.path}")
                    os.remove(self.path)
                    continue
                raise SystemExit(f"Another run is in progress (lock: {self.path}). Exiting.")
        raise SystemExit("Could not acquire run lock.")

    def __exit__(self, *exc):
        try:
            os.remove(self.path)
        except FileNotFoundError:
            pass


# --------------------------------------------------------------------------- #
# Bot
# --------------------------------------------------------------------------- #


class Bot:
    def __init__(self, cfg: Config, live: bool = False, state_dir: str = ".", exchange=None):
        self.cfg = cfg
        self.live = live
        mode = "live" if live else "paper"
        os.makedirs(state_dir, exist_ok=True)
        self.state_path = os.path.join(state_dir, f"bot_state_{mode}.json")
        self.trades_path = os.path.join(state_dir, f"trades_{mode}.csv")
        self.lock_path = os.path.join(state_dir, f"bot_{mode}.lock")
        self.tf_ms = st.timeframe_ms(cfg.timeframe)
        self.sleep = time.sleep
        self.exchange = exchange if exchange is not None else self._make_exchange()
        self.markets = self.exchange.load_markets()
        self.tickers: dict = {}
        self.state = self._load_state()

    # ---- setup ---------------------------------------------------------- #

    def _make_exchange(self):
        import ccxt  # imported here so backtests/tests don't need it

        key = os.getenv("KRAKEN_API_KEY")
        secret = os.getenv("KRAKEN_PRIVATE_KEY")
        if self.live and not (key and secret):
            raise SystemExit("Live mode needs KRAKEN_API_KEY and KRAKEN_PRIVATE_KEY in the environment.")
        return ccxt.kraken({"apiKey": key, "secret": secret, "enableRateLimit": True})

    def now_ms(self) -> int:
        return int(time.time() * 1000)

    # ---- state ---------------------------------------------------------- #

    def _default_state(self) -> dict:
        return {
            "version": 1,
            "paper_cash": self.cfg.paper_start_cash,
            "positions": {},
            "cooldowns": {},
            "day": None,
            "closed_trades": [],
        }

    def _load_state(self) -> dict:
        if os.path.exists(self.state_path):
            try:
                with open(self.state_path) as f:
                    loaded = json.load(f)
                state = self._default_state()
                state.update(loaded)
                return state
            except Exception as e:
                backup = f"{self.state_path}.corrupt-{int(time.time())}"
                os.replace(self.state_path, backup)
                msg = f"State file unreadable ({e}); moved to {backup}."
                if self.live:
                    raise RuntimeError(
                        msg + " Refusing to start live with unknown positions - "
                        "check Kraken manually, then restore or recreate the state file."
                    )
                log.error(msg + " Starting paper mode fresh.")
        return self._default_state()

    def save(self) -> None:
        tmp = f"{self.state_path}.tmp"
        with open(tmp, "w") as f:
            json.dump(self.state, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.state_path)

    # ---- market data ---------------------------------------------------- #

    def refresh_tickers(self) -> None:
        try:
            self.tickers = self.exchange.fetch_tickers()
        except Exception as e:
            log.error(f"fetch_tickers failed: {e}")
            self.tickers = {}

    def last_price(self, sym: str):
        t = self.tickers.get(sym)
        if t and t.get("last"):
            return float(t["last"])
        try:
            t = self.exchange.fetch_ticker(sym)
            return float(t["last"]) if t.get("last") else None
        except Exception:
            return None

    def quote(self, sym: str):
        """Fresh (bid, ask) or None."""
        try:
            t = self.exchange.fetch_ticker(sym)
        except Exception as e:
            log.warning(f"fetch_ticker({sym}) failed: {e}")
            return None
        last = t.get("last")
        bid = t.get("bid") or last
        ask = t.get("ask") or last
        if not (bid and ask):
            return None
        return float(bid), float(ask)

    def get_closed_df(self, sym: str):
        try:
            raw = self.exchange.fetch_ohlcv(sym, timeframe=self.cfg.timeframe, limit=300)
        except Exception as e:
            log.warning(f"fetch_ohlcv({sym}) failed: {e}")
            return None
        if not raw:
            return None
        df = st.closed_only(st.to_df(raw), self.tf_ms, self.now_ms())
        if df is None or len(df) < 60:
            return None
        return st.add_indicators(df)

    def scan_candidates(self) -> list:
        cfg = self.cfg
        found = []
        for sym, t in self.tickers.items():
            if "/" not in sym or ":" in sym:
                continue
            base, quote = sym.split("/")
            if quote != cfg.quote or cfg.is_excluded(base):
                continue
            m = self.markets.get(sym)
            if not m or m.get("active") is False or m.get("spot") is False:
                continue
            last, qv = t.get("last"), t.get("quoteVolume")
            if not last or not qv or qv < cfg.min_24h_volume_usd:
                continue
            bid, ask = t.get("bid"), t.get("ask")
            if bid and ask and bid > 0 and (ask - bid) / bid > cfg.max_spread_pct:
                continue
            found.append((sym, qv))
        found.sort(key=lambda x: x[1], reverse=True)
        return [s for s, _ in found[: cfg.scan_top_n]]

    def fear_and_greed_ok(self) -> bool:
        try:
            res = requests.get("https://api.alternative.me/fng/?limit=1", timeout=5)
            if res.status_code == 200:
                score = int(res.json()["data"][0]["value"])
                log.info(f"Fear & Greed index: {score}/100")
                return score >= self.cfg.fng_block_below
        except Exception as e:
            log.warning(f"Fear & Greed check failed ({e}); not blocking.")
        return True

    # ---- equity --------------------------------------------------------- #

    def equity(self):
        """Mark-to-market equity of the bot's own capital, or None if unknown."""
        if self.live:
            try:
                bal = self.exchange.fetch_balance()
            except Exception as e:
                log.error(f"fetch_balance failed: {e}")
                return None
            total = float((bal.get("total") or {}).get(self.cfg.quote) or 0.0)
        else:
            total = float(self.state["paper_cash"])
        for sym, pos in self.state["positions"].items():
            px = self.last_price(sym) or pos["entry_price"]
            total += pos["qty"] * px
        return total

    def exposure(self) -> float:
        total = 0.0
        for sym, pos in self.state["positions"].items():
            total += pos["qty"] * (self.last_price(sym) or pos["entry_price"])
        return total

    def update_watermark(self, eq: float) -> None:
        today = utcnow().strftime("%Y-%m-%d")
        day = self.state.get("day")
        if not day or day.get("date") != today or not day.get("start_equity"):
            self.state["day"] = {"date": today, "start_equity": eq}

    # ---- bookkeeping ---------------------------------------------------- #

    def _in_cooldown(self, sym: str) -> bool:
        until = self.state["cooldowns"].get(sym)
        if not until:
            return False
        return utcnow() < datetime.fromisoformat(until)

    def record_close(self, sym: str, pos: dict, exit_price: float, exit_fee: float, reason: str) -> None:
        qty = pos["qty"]
        proceeds = qty * exit_price - exit_fee
        cost = qty * pos["entry_price"] + pos.get("entry_fee", 0.0)
        pnl = proceeds - cost
        trade = {
            "symbol": sym,
            "opened_at": pos.get("opened_at", ""),
            "closed_at": utcnow().isoformat(),
            "qty": qty,
            "entry_price": pos["entry_price"],
            "exit_price": exit_price,
            "entry_fee": round(pos.get("entry_fee", 0.0), 6),
            "exit_fee": round(exit_fee, 6),
            "pnl": round(pnl, 6),
            "pnl_pct": round(pnl / cost * 100, 4) if cost else 0.0,
            "reason": reason,
        }
        self.state["closed_trades"].append(trade)
        if not self.live:
            self.state["paper_cash"] += proceeds
        self.state["positions"].pop(sym, None)
        self.state["cooldowns"][sym] = (utcnow() + timedelta(hours=self.cfg.cooldown_hours)).isoformat()
        self.save()
        new_file = not os.path.exists(self.trades_path)
        with open(self.trades_path, "a", newline="") as f:
            w = csv.DictWriter(f, fieldnames=TRADE_FIELDS)
            if new_file:
                w.writeheader()
            w.writerow(trade)
        log.info(f"CLOSED {sym} ({reason}) exit {exit_price:.8g} | PnL {pnl:+.2f} ({trade['pnl_pct']:+.2f}%)")

    def _market_ok(self, sym: str, qty: float, price: float):
        """Round to exchange precision and enforce minimums. Returns (qty, error)."""
        try:
            q = float(self.exchange.amount_to_precision(sym, qty))
        except Exception as e:
            return None, f"precision error: {e}"
        limits = (self.markets.get(sym) or {}).get("limits") or {}
        min_amt = ((limits.get("amount") or {}).get("min")) or 0.0
        min_cost = ((limits.get("cost") or {}).get("min")) or 0.0
        if q <= 0 or q < min_amt:
            return None, f"quantity {q} below exchange minimum {min_amt}"
        if q * price < max(self.cfg.min_order_usd, min_cost):
            return None, f"order value ${q * price:.2f} below minimum"
        return q, ""

    def _px(self, sym: str, price: float) -> float:
        try:
            return float(self.exchange.price_to_precision(sym, price))
        except Exception:
            return price

    def _order_fee(self, order: dict, notional: float) -> float:
        fee = (order or {}).get("fee") or {}
        cost = fee.get("cost")
        if cost is not None and fee.get("currency") in (None, self.cfg.quote):
            return float(cost)
        return notional * self.cfg.fee_rate  # estimate

    # ---- entries -------------------------------------------------------- #

    def try_enter(self, sym: str, sig: st.Signal, eq: float) -> bool:
        cfg = self.cfg
        q = self.quote(sym)
        if q is None:
            return False
        _, ask = q
        entry_px = ask * (1.0 + cfg.slippage_rate)
        base = sym.split("/")[0]
        plan, why = st.plan_trade(entry_px, sig.atr, eq, cfg.is_meme(base), cfg)
        if plan is None:
            log.info(f"Skip {sym}: {why}")
            return False
        qty, err = self._market_ok(sym, plan["qty"], entry_px)
        if qty is None:
            log.info(f"Skip {sym}: {err}")
            return False
        cost = qty * entry_px
        if self.exposure() + cost > eq * cfg.max_total_exposure_pct:
            log.info(f"Skip {sym}: would exceed {cfg.max_total_exposure_pct:.0%} total exposure")
            return False
        log.info(
            f"ENTRY SIGNAL {sym} | px {entry_px:.8g} qty {qty} (${cost:.2f}"
            f"{', capped' if plan['capped'] else ''}) | net R:R {plan['net_rr']:.2f}"
        )
        if self.live:
            return self._live_entry(sym, plan, qty, entry_px)
        return self._paper_entry(sym, plan, qty, entry_px, sig.atr)

    def _new_position(self, qty, entry, fee, sl, tp, plan, atr) -> dict:
        now = utcnow()
        return {
            "qty": qty, "entry_price": entry, "entry_fee": fee,
            "sl": sl, "tp": tp, "atr": atr,
            "sl_dist": plan["sl_dist"], "tp_dist": plan["tp_dist"],
            "opened_at": now.isoformat(), "opened_ms": self.now_ms(),
            "last_checked_ms": self.now_ms(),
            "sl_order_id": None, "unprotected": False,
        }

    def _paper_entry(self, sym, plan, qty, fill, atr) -> bool:
        cost = qty * fill
        fee = cost * self.cfg.fee_rate
        if self.state["paper_cash"] < cost + fee:
            log.info(f"Skip {sym}: paper cash ${self.state['paper_cash']:.2f} < ${cost + fee:.2f}")
            return False
        sl = self._px(sym, fill - plan["sl_dist"])
        tp = self._px(sym, fill + plan["tp_dist"])
        self.state["paper_cash"] -= cost + fee
        self.state["positions"][sym] = self._new_position(qty, fill, fee, sl, tp, plan, atr)
        self.save()
        log.info(f"[PAPER] BOUGHT {qty} {sym} @ {fill:.8g} | SL {sl} | TP {tp} | fee ${fee:.2f}")
        return True

    def _place_stop(self, sym: str, qty: float, sl_px: float, validate: bool = False):
        # ccxt's Kraken driver maps stopLossPrice to a stop-loss order. Verify
        # with:  python kraken_bot.py --check-live
        params = {"stopLossPrice": sl_px}
        if validate:
            params["validate"] = True
        return self.exchange.create_order(sym, "market", "sell", qty, None, params)

    def _settle_order(self, order: dict, sym: str, tries: int = 5, delay: float = 1.0) -> dict:
        oid = (order or {}).get("id")
        for _ in range(tries):
            status = order.get("status")
            if status == "closed" and (order.get("filled") or 0) > 0:
                return order
            if status in ("canceled", "expired", "rejected") or not oid:
                return order
            self.sleep(delay)
            try:
                order = self.exchange.fetch_order(oid, sym)
            except Exception as e:
                log.warning(f"fetch_order({oid}) failed: {e}")
        return order

    def _emergency_sell(self, sym: str, qty: float, tries: int = 3):
        for _ in range(tries):
            try:
                o = self.exchange.create_market_sell_order(sym, qty)
                return self._settle_order(o, sym)
            except Exception as e:
                log.critical(f"Emergency sell of {qty} {sym} failed: {e}")
                self.sleep(2)
        return None

    def _live_entry(self, sym, plan, qty, entry_px) -> bool:
        cfg = self.cfg
        base, quote = sym.split("/")
        try:
            bal = self.exchange.fetch_balance()
        except Exception as e:
            log.error(f"Skip {sym}: balance fetch failed: {e}")
            return False
        free_quote = float((bal.get("free") or {}).get(quote) or 0.0)
        pre_total = float((bal.get("total") or {}).get(base) or 0.0)
        if free_quote < qty * entry_px * (1 + cfg.fee_rate) * 1.01:
            log.info(f"Skip {sym}: free {quote} ${free_quote:.2f} too low")
            return False

        try:
            order = self.exchange.create_market_buy_order(sym, qty)
        except Exception as e:
            log.error(f"[LIVE] buy rejected for {sym}: {e}")
            return False
        order = self._settle_order(order, sym)

        filled = float(order.get("filled") or 0.0)
        avg = float(order.get("average") or order.get("price") or entry_px)
        delta = None
        try:
            bal2 = self.exchange.fetch_balance()
            delta = float((bal2.get("total") or {}).get(base) or 0.0) - pre_total
        except Exception:
            pass
        if filled <= 0 and delta and delta > 0:
            filled = delta
        if filled <= 0:
            log.critical(f"[LIVE] buy of {sym} could not be confirmed (order {order.get('id')}). "
                         f"CHECK KRAKEN MANUALLY. Bot is not tracking this order.")
            return False
        sellable = min(filled, delta) if (delta is not None and delta > 0) else filled
        fee = self._order_fee(order, filled * avg)

        sl_px = self._px(sym, avg - plan["sl_dist"])
        tp_px = self._px(sym, avg + plan["tp_dist"])
        pos = self._new_position(sellable, avg, fee, sl_px, tp_px, plan, 0.0)
        pos["unprotected"] = True
        try:
            stop_qty = float(self.exchange.amount_to_precision(sym, sellable))
            pos["qty"] = stop_qty
            stop = self._place_stop(sym, stop_qty, sl_px)
            pos["sl_order_id"] = stop["id"]
            pos["unprotected"] = False
        except Exception as e:
            log.critical(f"[LIVE] stop order failed for {sym}: {e}. Exiting position now.")
            sold = self._emergency_sell(sym, pos["qty"])
            if sold:
                px = float(sold.get("average") or sold.get("price") or avg)
                self.state["positions"][sym] = pos
                self.record_close(sym, pos, px, self._order_fee(sold, pos["qty"] * px), "stop_failed_exit")
                return False
            log.critical(f"[LIVE] EMERGENCY EXIT FAILED for {sym}. Tracking as UNPROTECTED; "
                         f"will retry each run. Act manually if this persists.")

        self.state["positions"][sym] = pos
        self.save()
        log.info(f"[LIVE] BOUGHT {pos['qty']} {sym} @ {avg:.8g} | SL {sl_px} (order {pos['sl_order_id']}) | TP {tp_px}")
        return True

    # ---- position management -------------------------------------------- #

    def _scan_candles(self, pos: dict, df, check_stop: bool):
        """
        Walk candles that CLOSED after the last check. Stop is tested before
        target (conservative when one candle spans both) and gaps fill at the open.
        Returns (reason, raw_price) or None.
        """
        last_ms = pos.get("last_checked_ms", pos.get("opened_ms", 0))
        new = df[df["timestamp"] > last_ms]
        for row in new.itertuples(index=False):
            o, h, l = float(row.open), float(row.high), float(row.low)
            if check_stop:
                if o <= pos["sl"]:
                    return "stop", o
                if l <= pos["sl"]:
                    return "stop", pos["sl"]
            if o >= pos["tp"]:
                return "take_profit", o
            if h >= pos["tp"]:
                return "take_profit", pos["tp"]
        return None

    def _trend_broken(self, pos: dict, df) -> bool:
        last = df.iloc[-1]
        return bool(
            int(last["timestamp"]) > pos["opened_ms"]
            and last["close"] == last["close"]
            and last["ema50"] == last["ema50"]
            and last["close"] < last["ema50"]
        )

    def _paper_exit(self, sym: str, pos: dict, raw_price: float, reason: str) -> None:
        fill = raw_price * (1.0 - self.cfg.slippage_rate)
        fee = pos["qty"] * fill * self.cfg.fee_rate
        self.record_close(sym, pos, fill, fee, reason)

    def _manage_paper(self, sym: str, pos: dict, df) -> None:
        hit = self._scan_candles(pos, df, check_stop=True)
        if hit:
            self._paper_exit(sym, pos, hit[1], hit[0])
            return
        pos["last_checked_ms"] = int(df["timestamp"].iloc[-1])
        q = self.quote(sym)
        bid = q[0] if q else None
        if bid is not None:
            if bid <= pos["sl"]:
                self._paper_exit(sym, pos, bid, "stop")
                return
            if bid >= pos["tp"]:
                self._paper_exit(sym, pos, pos["tp"], "take_profit")
                return
        if self._trend_broken(pos, df):
            self._paper_exit(sym, pos, bid if bid is not None else float(df["close"].iloc[-1]), "trend")

    def _safe_fetch_order(self, oid, sym):
        try:
            return self.exchange.fetch_order(oid, sym)
        except Exception as e:
            log.warning(f"fetch_order({oid}) failed: {e}")
            return None

    def _cancel_stop(self, sym: str, pos: dict) -> str:
        """Returns 'none' | 'cancelled' | 'filled' | 'error'."""
        oid = pos.get("sl_order_id")
        if not oid:
            return "none"
        try:
            self.exchange.cancel_order(oid, sym)
            return "cancelled"
        except Exception as e:
            log.warning(f"cancel_order({oid}) failed: {e}")
            o = self._safe_fetch_order(oid, sym)
            if o:
                if o.get("status") == "closed":
                    return "filled"
                if o.get("status") in ("canceled", "expired"):
                    return "cancelled"
            return "error"

    def _restore_stop(self, sym: str, pos: dict) -> bool:
        """Re-protect a position. True if protected afterwards; False if exited or still naked."""
        q = self.quote(sym)
        if q and q[0] <= pos["sl"]:
            log.warning(f"{sym} is already through its stop level; exiting at market.")
            sold = self._emergency_sell(sym, pos["qty"])
            if sold:
                px = float(sold.get("average") or sold.get("price") or q[0])
                self.record_close(sym, pos, px, self._order_fee(sold, pos["qty"] * px), "stop_restore_exit")
            return False
        try:
            stop = self._place_stop(sym, pos["qty"], pos["sl"])
            pos["sl_order_id"] = stop["id"]
            pos["unprotected"] = False
            self.save()
            log.warning(f"Re-placed stop for {sym} (order {stop['id']}).")
            return True
        except Exception as e:
            log.critical(f"Could not re-place stop for {sym}: {e}. Exiting at market.")
            sold = self._emergency_sell(sym, pos["qty"])
            if sold:
                px = float(sold.get("average") or sold.get("price") or pos["entry_price"])
                self.record_close(sym, pos, px, self._order_fee(sold, pos["qty"] * px), "stop_restore_exit")
            else:
                pos["unprotected"] = True
                self.save()
            return False

    def _live_exit(self, sym: str, pos: dict, reason: str) -> None:
        result = self._cancel_stop(sym, pos)
        if result == "filled":  # stop fired while we were deciding to exit
            o = self._safe_fetch_order(pos["sl_order_id"], sym) or {}
            px = float(o.get("average") or pos["sl"])
            self.record_close(sym, pos, px, self._order_fee(o, pos["qty"] * px), "stop")
            return
        if result == "error":
            log.error(f"Could not cancel stop for {sym}; leaving position (and stop) untouched.")
            return

        base = sym.split("/")[0]
        qty = pos["qty"]
        try:
            free_base = float((self.exchange.fetch_balance().get("free") or {}).get(base) or 0.0)
            if 0 < free_base < qty:
                qty = free_base  # never sell more than we hold; never more than the position
            qty = float(self.exchange.amount_to_precision(sym, qty))
        except Exception:
            pass
        try:
            o = self._settle_order(self.exchange.create_market_sell_order(sym, qty), sym)
        except Exception as e:
            log.error(f"[LIVE] market sell of {sym} failed: {e}. Re-protecting position.")
            pos["sl_order_id"] = None
            pos["unprotected"] = True
            self._restore_stop(sym, pos)
            return
        px = float(o.get("average") or o.get("price") or (self.last_price(sym) or pos["entry_price"]))
        pos["qty"] = qty
        self.record_close(sym, pos, px, self._order_fee(o, qty * px), reason)

    def _manage_live(self, sym: str, pos: dict, df) -> None:
        # 1) make sure the position is protected, and detect stop fills
        if pos.get("unprotected") or not pos.get("sl_order_id"):
            if not self._restore_stop(sym, pos):
                return
        else:
            o = self._safe_fetch_order(pos["sl_order_id"], sym)
            if o is None:
                return  # can't verify this cycle; do nothing rather than guess
            status = o.get("status")
            if status == "closed":
                px = float(o.get("average") or pos["sl"])
                self.record_close(sym, pos, px, self._order_fee(o, pos["qty"] * px), "stop")
                return
            if status in ("canceled", "expired", "rejected"):
                log.warning(f"Stop order for {sym} is {status}; re-protecting.")
                pos["sl_order_id"] = None
                pos["unprotected"] = True
                if not self._restore_stop(sym, pos):
                    return
        if df is None:
            return
        # 2) take-profit (bot-managed) and trend exit
        hit = self._scan_candles(pos, df, check_stop=False)
        if hit:
            self._live_exit(sym, pos, "take_profit")
            return
        pos["last_checked_ms"] = int(df["timestamp"].iloc[-1])
        q = self.quote(sym)
        if q and q[0] >= pos["tp"]:
            self._live_exit(sym, pos, "take_profit")
            return
        if self._trend_broken(pos, df):
            self._live_exit(sym, pos, "trend")

    def manage_positions(self) -> None:
        for sym in list(self.state["positions"]):
            pos = self.state["positions"].get(sym)
            if pos is None:
                continue
            df = self.get_closed_df(sym)
            if self.live:
                self._manage_live(sym, pos, df)
            elif df is None:
                log.warning(f"No candle data for {sym}; skipping management this run.")
            else:
                self._manage_paper(sym, pos, df)
        self.save()

    # ---- main cycle ----------------------------------------------------- #

    def scan_and_enter(self) -> None:
        cfg = self.cfg
        cands = self.scan_candidates()
        log.info(f"Scanning {len(cands)} liquid {cfg.quote} pairs")
        for sym in cands:
            if len(self.state["positions"]) >= cfg.max_open_positions:
                break
            if sym in self.state["positions"] or self._in_cooldown(sym):
                continue
            df = self.get_closed_df(sym)
            if df is None:
                continue
            sig = st.entry_signal(df, cfg.min_candles)
            if not sig.ok:
                continue
            eq = self.equity()
            if eq is None or eq <= 0:
                log.error("Equity unknown; stopping entries this run.")
                return
            self.try_enter(sym, sig, eq)

    def run_once(self) -> None:
        cfg = self.cfg
        mode = "LIVE" if self.live else "PAPER"
        self.refresh_tickers()
        eq = self.equity()
        if eq is None or eq <= 0:
            log.critical("Could not determine equity (or it is zero). Aborting this run; no trades.")
            return
        self.update_watermark(eq)
        log.info(f"=== {mode} run | equity ${eq:.2f} | open {list(self.state['positions'])} ===")

        self.manage_positions()

        eq = self.equity() or eq
        start = self.state["day"]["start_equity"]
        dd = (start - eq) / start if start else 0.0
        allow = True
        if dd >= cfg.daily_loss_limit_pct:
            log.warning(f"Daily loss limit hit ({dd:.2%}). No new entries today.")
            allow = False
        elif len(self.state["positions"]) >= cfg.max_open_positions:
            log.info("Max positions open; not scanning.")
            allow = False
        elif not self.fear_and_greed_ok():
            log.info("Extreme fear; no new entries.")
            allow = False
        if allow:
            self.scan_and_enter()

        self.save()
        self.log_summary()

    def run_locked(self) -> None:
        with RunLock(self.lock_path):
            self.run_once()

    def log_summary(self) -> None:
        trades = self.state["closed_trades"]
        if not trades:
            return
        pnls = [t["pnl"] for t in trades]
        wins = sum(1 for p in pnls if p > 0)
        log.info(f"Results so far: {len(trades)} trades | win rate {wins / len(trades):.0%} | net PnL ${sum(pnls):+.2f}")

    # ---- live preflight ------------------------------------------------- #

    def check_live(self) -> None:
        print("Checking balance access ...")
        bal = self.exchange.fetch_balance()
        print(f"  {self.cfg.quote} total: {(bal.get('total') or {}).get(self.cfg.quote)}")
        sym = "BTC/USD"
        q = self.quote(sym)
        if not q:
            print("  Could not fetch BTC/USD quote.")
            return
        m = self.markets.get(sym) or {}
        min_amt = (((m.get("limits") or {}).get("amount") or {}).get("min")) or 0.0001
        qty = float(self.exchange.amount_to_precision(sym, min_amt))
        sl = float(self.exchange.price_to_precision(sym, q[0] * 0.5))
        print(f"Validating a stop-loss ({qty} {sym}, trigger {sl}) with validate=true - nothing is placed ...")
        try:
            self._place_stop(sym, qty, sl, validate=True)
            print("  Stop-loss syntax accepted.")
        except Exception as e:
            print(f"  Rejected: {e}")
            print("  'Insufficient funds' means the syntax was accepted but you hold no BTC to validate "
                  "against; any other error means fix _place_stop() before going live.")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def print_status(state_dir: str, live: bool) -> None:
    mode = "live" if live else "paper"
    path = os.path.join(state_dir, f"bot_state_{mode}.json")
    if not os.path.exists(path):
        print(f"No {mode} state yet ({path}).")
        return
    with open(path) as f:
        s = json.load(f)
    print(f"--- {mode.upper()} state ---")
    if not live:
        print(f"Paper cash: ${s.get('paper_cash', 0):.2f}")
    for sym, p in s.get("positions", {}).items():
        flag = "  [UNPROTECTED]" if p.get("unprotected") else ""
        print(f"OPEN {sym}: {p['qty']} @ {p['entry_price']:.8g} | SL {p['sl']} | TP {p['tp']}{flag}")
    trades = s.get("closed_trades", [])
    if trades:
        pnls = [t["pnl"] for t in trades]
        wins = sum(1 for x in pnls if x > 0)
        print(f"Closed: {len(trades)} | win rate {wins / len(trades):.0%} | net PnL ${sum(pnls):+.2f}")
    else:
        print("No closed trades yet.")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Kraken spot bot (paper by default)")
    ap.add_argument("--live", action="store_true", help="trade real money")
    ap.add_argument("--i-understand-the-risks", action="store_true", help="required with --live")
    ap.add_argument("--loop", action="store_true", help="run once per candle, forever")
    ap.add_argument("--status", action="store_true", help="print state and exit")
    ap.add_argument("--check-live", action="store_true", help="verify keys/stop syntax and exit")
    ap.add_argument("--state-dir", default=".", help="where state/trade/log files live")
    ap.add_argument("--fee", type=float, help="taker fee rate override, e.g. 0.0040")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    os.makedirs(args.state_dir, exist_ok=True)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler(), logging.FileHandler(os.path.join(args.state_dir, "bot.log"))],
    )

    if args.status:
        print_status(args.state_dir, args.live)
        return 0
    if args.live and not args.i_understand_the_risks:
        print("Refusing: --live also requires --i-understand-the-risks")
        return 2

    cfg = Config()
    if args.fee is not None:
        cfg.fee_rate = args.fee

    bot = Bot(cfg, live=args.live or args.check_live, state_dir=args.state_dir)
    if args.check_live:
        bot.check_live()
        return 0

    if not args.loop:
        bot.run_locked()
        return 0

    errors = 0
    while True:
        try:
            bot.run_locked()
            errors = 0
        except KeyboardInterrupt:
            return 0
        except SystemExit as e:  # lock held by another process
            log.warning(str(e))
        except Exception:
            errors += 1
            log.exception(f"Run failed ({errors}/5)")
            if errors >= 5:
                log.critical("Too many consecutive failures; stopping the loop.")
                return 1
        now = bot.now_ms()
        nxt = (now // bot.tf_ms + 1) * bot.tf_ms + cfg.run_delay_seconds * 1000
        try:
            time.sleep(max(1.0, (nxt - now) / 1000.0))
        except KeyboardInterrupt:
            return 0


if __name__ == "__main__":
    sys.exit(main())
