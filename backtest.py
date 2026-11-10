#!/usr/bin/env python3
"""
backtest.py - replay historical 1h candles through the bot's strategy.

    python backtest.py                          last 365 days, default coin list
    python backtest.py --days 730               two years
    python backtest.py --symbols BTC/USD,ETH/USD,SOL/USD
    python backtest.py --set fee_rate=0.004     test a setting (any field of strategy.Config)
    python backtest.py --source kraken          real Kraken candles (Kraken only serves ~30 days)

It mirrors kraken_bot.py's paper trading, using the same strategy.py code:
  * one "run" per closed 1h candle; signals use closed candles only
  * EMA50/EMA200 are computed over the same 299-candle window the bot fetches,
    so the trend filter sees exactly what the live bot would see
  * entries fill at the next candle's open + slippage; stops are checked before
    targets, gaps fill at the open; trend exits fill at the next candle's open
  * same fee-aware sizing, max positions, total-exposure cap, cooldown,
    daily loss limit and Fear & Greed filter

Limitations - read before trusting a result:
  * The default data source is Binance's free public archive (USDT pairs, years
    of history). Kraken USD prices track it closely but not exactly.
  * The coin list is today's list, so coins that collapsed and were delisted are
    missing (survivorship bias). Real results will tend to be a bit worse.
  * No bid/ask spread filter and no exchange lot-size rounding.
  * A good backtest is necessary, not sufficient. Fewer than ~50 trades says
    very little; tuning settings until the numbers look good is overfitting.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import zipfile
from collections import Counter
from dataclasses import fields
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests

import strategy as st
from strategy import Config

H = 3_600_000            # one hour in ms
BOT_WINDOW = 299         # kraken_bot fetches 300 candles and drops the forming one

DEFAULT_SYMBOLS = [
    "BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "DOGE/USD", "ADA/USD", "LINK/USD",
    "AVAX/USD", "DOT/USD", "LTC/USD", "BCH/USD", "TRX/USD", "XLM/USD", "SUI/USD",
    "PEPE/USD", "SHIB/USD", "UNI/USD", "AAVE/USD", "NEAR/USD", "APT/USD", "ARB/USD",
    "OP/USD", "INJ/USD", "FIL/USD", "ATOM/USD", "HBAR/USD", "ETC/USD", "WIF/USD",
    "BONK/USD", "SEI/USD", "RENDER/USD", "ONDO/USD", "ENA/USD", "TAO/USD", "TIA/USD",
]


def utc(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


# --------------------------------------------------------------------------- #
# Data
# --------------------------------------------------------------------------- #

BINANCE_ARCHIVE = "https://data.binance.vision/data/spot"


def _binance_pair(sym: str) -> str:
    base, quote = sym.split("/")
    return base + ("USDT" if quote == "USD" else quote)


def _download(url: str, path: str) -> bool:
    if os.path.exists(path):
        return True
    try:
        r = requests.get(url, timeout=60)
    except requests.RequestException as e:
        print(f"  ! {url}: {e}", file=sys.stderr)
        return False
    if r.status_code != 200:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(r.content)
    os.replace(tmp, path)
    return True


def _read_kline_zip(path: str) -> pd.DataFrame:
    with zipfile.ZipFile(path) as z:
        with z.open(z.namelist()[0]) as f:
            df = pd.read_csv(f, header=None, usecols=range(6))
    df.columns = ["timestamp", "open", "high", "low", "close", "volume"]
    df = df.apply(pd.to_numeric, errors="coerce").dropna()  # drops a header row if present
    ts = df["timestamp"].astype("int64").to_numpy()
    df["timestamp"] = np.where(ts > 10**14, ts // 1000, ts)  # 2025+ files are in microseconds
    return df


def load_binance(sym: str, start: datetime, end: datetime, cache_dir: str) -> pd.DataFrame | None:
    """Hourly candles from Binance's public archive (monthly files, daily files for recent days)."""
    pair = _binance_pair(sym)
    frames = []
    month = datetime(start.year, start.month, 1, tzinfo=timezone.utc)
    while month <= end:
        tag = month.strftime("%Y-%m")
        path = os.path.join(cache_dir, "binance", pair, f"{pair}-1h-{tag}.zip")
        url = f"{BINANCE_ARCHIVE}/monthly/klines/{pair}/1h/{pair}-1h-{tag}.zip"
        if _download(url, path):
            frames.append(_read_kline_zip(path))
        else:
            # monthly file not published yet (current/last month): use daily files
            day = month
            nxt = (month + timedelta(days=32)).replace(day=1)
            while day < nxt and day <= end:
                dtag = day.strftime("%Y-%m-%d")
                dpath = os.path.join(cache_dir, "binance", pair, f"{pair}-1h-{dtag}.zip")
                durl = f"{BINANCE_ARCHIVE}/daily/klines/{pair}/1h/{pair}-1h-{dtag}.zip"
                if _download(durl, dpath):
                    frames.append(_read_kline_zip(dpath))
                day += timedelta(days=1)
        month = (month + timedelta(days=32)).replace(day=1)
    if not frames:
        return None
    df = pd.concat(frames).drop_duplicates("timestamp").sort_values("timestamp")
    lo, hi = int(start.timestamp() * 1000), int(end.timestamp() * 1000)
    df = df[(df["timestamp"] >= lo) & (df["timestamp"] + H <= hi)]  # closed candles only
    return st.to_df(df.to_numpy().tolist()) if len(df) else None


def load_kraken(sym: str, exchange) -> pd.DataFrame | None:
    """Kraken's API only returns the latest 720 candles (~30 days of 1h)."""
    try:
        raw = exchange.fetch_ohlcv(sym, timeframe="1h", limit=720)
    except Exception as e:
        print(f"  ! {sym}: {e}", file=sys.stderr)
        return None
    if not raw:
        return None
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    return st.closed_only(st.to_df(raw), H, now_ms)


def load_fear_greed(cache_dir: str) -> dict | None:
    """{'YYYY-MM-DD': value}. Falls back to a cached copy; None disables the filter."""
    path = os.path.join(cache_dir, "fear_greed.json")
    try:
        r = requests.get("https://api.alternative.me/fng/?limit=0&format=json", timeout=30)
        r.raise_for_status()
        data = {
            utc(int(row["timestamp"]) * 1000).strftime("%Y-%m-%d"): int(row["value"])
            for row in r.json()["data"]
        }
        os.makedirs(cache_dir, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f)
        return data
    except Exception as e:
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
        print(f"  ! Fear & Greed history unavailable ({e}); filter disabled.", file=sys.stderr)
        return None


# --------------------------------------------------------------------------- #
# Indicators exactly as the bot sees them
# --------------------------------------------------------------------------- #


def windowed_ema(close: pd.Series, span: int, window: int) -> pd.Series:
    """
    EMA recomputed from scratch over only the last `window` closes at every
    candle, as the bot does (it fetches a fixed 300-candle window each run).
    With adjust=False that is a fixed-weight filter, so it is one convolution.
    """
    out = st.ema(close, span).to_numpy(copy=True)  # exact while history <= window
    x = close.to_numpy(dtype=float)
    if len(x) > window:
        a = 2.0 / (span + 1)
        w = np.empty(window)
        w[: window - 1] = a * (1 - a) ** np.arange(window - 1)
        w[window - 1] = (1 - a) ** (window - 1)
        out[window - 1:] = np.convolve(x, w, mode="valid")
    return pd.Series(out, index=close.index)


class Series:
    """One symbol's candles + indicators as numpy arrays, indexed by candle open time."""

    def __init__(self, df: pd.DataFrame, cfg: Config):
        df = st.add_indicators(df.reset_index(drop=True))
        df["ema50"] = windowed_ema(df["close"], 50, BOT_WINDOW)
        df["ema200"] = windowed_ema(df["close"], 200, BOT_WINDOW)
        sig = st.signal_series(df).to_numpy(copy=True)
        sig[: cfg.min_candles - 1] = False  # the bot needs >= min_candles closed candles
        self.ts = df["timestamp"].to_numpy()
        self.open = df["open"].to_numpy(float)
        self.high = df["high"].to_numpy(float)
        self.low = df["low"].to_numpy(float)
        self.close = df["close"].to_numpy(float)
        self.ema50 = df["ema50"].to_numpy(float)
        self.atr = df["atr"].to_numpy(float)
        self.signal = sig
        self.qvol24 = (df["close"] * df["volume"]).rolling(24, min_periods=1).sum().to_numpy(float)
        self.idx = {int(t): i for i, t in enumerate(self.ts)}


# --------------------------------------------------------------------------- #
# Simulation
# --------------------------------------------------------------------------- #


class Backtest:
    def __init__(self, data: dict, cfg: Config, fng: dict | None = None, start_ms: int | None = None):
        self.cfg = cfg
        self.fng = fng
        self.s = {sym: Series(df, cfg) for sym, df in data.items() if df is not None and len(df) >= cfg.min_candles}
        all_ts = sorted(set().union(*[set(x.idx) for x in self.s.values()])) if self.s else []
        self.timeline = [t for t in all_ts if start_ms is None or t >= start_ms]
        self.cash = cfg.paper_start_cash
        self.pos: dict = {}
        self.cooldown: dict = {}
        self.last_close: dict = {}
        self.trades: list = []
        self.equity_curve: list = []
        self.counts = Counter()
        self.day = None
        self.day_start = None

    # ---- helpers -------------------------------------------------------- #

    def equity(self) -> float:
        return self.cash + sum(p["qty"] * self.last_close[s] for s, p in self.pos.items())

    def exposure(self) -> float:
        return sum(p["qty"] * self.last_close[s] for s, p in self.pos.items())

    def fng_ok(self, run_ms: int) -> bool:
        if not self.fng:
            return True
        v = self.fng.get(utc(run_ms).strftime("%Y-%m-%d"))
        return v is None or v >= self.cfg.fng_block_below

    def _exit(self, sym: str, raw: float, reason: str, run_ms: int) -> None:
        cfg = self.cfg
        p = self.pos.pop(sym)
        fill = raw * (1.0 - cfg.slippage_rate)
        fee = p["qty"] * fill * cfg.fee_rate
        proceeds = p["qty"] * fill - fee
        cost = p["qty"] * p["entry"] + p["fee"]
        pnl = proceeds - cost
        self.cash += proceeds
        self.cooldown[sym] = run_ms + int(cfg.cooldown_hours * H)
        self.trades.append({
            "symbol": sym,
            "opened_at": utc(p["opened_ms"]).isoformat(),
            "closed_at": utc(run_ms).isoformat(),
            "hours_held": round((run_ms - p["opened_ms"]) / H, 1),
            "qty": p["qty"],
            "entry_price": p["entry"],
            "exit_price": fill,
            "fees": round(p["fee"] + fee, 6),
            "pnl": round(pnl, 6),
            "pnl_pct": round(pnl / cost * 100, 4),
            "r_multiple": round(pnl / p["risk"], 3) if p["risk"] else 0.0,
            "reason": reason,
        })

    def _try_enter(self, sym: str, x: Series, i: int, run_ms: int) -> None:
        cfg = self.cfg
        j = x.idx.get(int(x.ts[i]) + H)
        if j is None:
            self.counts["skip: no next candle"] += 1
            return
        entry = x.open[j] * (1.0 + cfg.slippage_rate)
        eq = self.equity()
        plan, why = st.plan_trade(entry, x.atr[i], eq, cfg.is_meme(sym.split("/")[0]), cfg)
        if plan is None:
            if "exceeds" in why:
                key = "stop too wide"
            elif "R:R" in why or "fees" in why:
                key = "target too small after fees"
            else:
                key = why
            self.counts[f"skip: {key}"] += 1
            return
        qty = plan["qty"]
        cost = qty * entry
        if cost < cfg.min_order_usd:
            self.counts["skip: order too small"] += 1
            return
        if self.exposure() + cost > eq * cfg.max_total_exposure_pct:
            self.counts["skip: exposure cap"] += 1
            return
        fee = cost * cfg.fee_rate
        if self.cash < cost + fee:
            self.counts["skip: not enough cash"] += 1
            return
        self.cash -= cost + fee
        self.pos[sym] = {
            "qty": qty, "entry": entry, "fee": fee,
            "sl": entry - plan["sl_dist"], "tp": entry + plan["tp_dist"],
            "entry_ts": int(x.ts[j]), "opened_ms": run_ms, "risk": plan["risk_usd"],
        }
        self.counts["entered"] += 1

    # ---- main loop ------------------------------------------------------ #

    def step(self, ts: int) -> None:
        cfg = self.cfg
        run_ms = ts + H  # the bot runs right after candle `ts` closes
        rows = {}
        for sym, x in self.s.items():
            i = x.idx.get(ts)
            if i is not None:
                rows[sym] = i
                self.last_close[sym] = x.close[i]

        day = utc(run_ms).strftime("%Y-%m-%d")
        if day != self.day:
            self.day, self.day_start = day, self.equity()

        # 1) manage open positions
        for sym in list(self.pos):
            p, i = self.pos[sym], rows.get(sym)
            if i is None or ts < p["entry_ts"]:
                continue
            x = self.s[sym]
            o, h, l = x.open[i], x.high[i], x.low[i]
            hit = None
            if o <= p["sl"]:
                hit = ("stop", o)
            elif l <= p["sl"]:
                hit = ("stop", p["sl"])
            elif o >= p["tp"]:
                hit = ("take_profit", o)
            elif h >= p["tp"]:
                hit = ("take_profit", p["tp"])
            if hit:
                self._exit(sym, hit[1], hit[0], run_ms)
                continue
            # trend exit: only on candles that opened after entry, as in the bot
            if ts > p["entry_ts"] and x.close[i] < x.ema50[i]:
                j = x.idx.get(ts + H)
                self._exit(sym, x.open[j] if j is not None else x.close[i], "trend", run_ms)

        # 2) new entries
        signals = [s for s, i in rows.items() if self.s[s].signal[i]]
        self.counts["signals"] += len(signals)
        eq = self.equity()
        dd = (self.day_start - eq) / self.day_start if self.day_start else 0.0
        if signals:
            if dd >= cfg.daily_loss_limit_pct:
                self.counts["skip: daily loss limit"] += len(signals)
            elif not self.fng_ok(run_ms):
                self.counts["skip: extreme fear"] += len(signals)
            else:
                cands = sorted(signals, key=lambda s: self.s[s].qvol24[rows[s]], reverse=True)
                for sym in cands:
                    if sym in self.pos:
                        self.counts["skip: already open"] += 1
                        continue
                    if run_ms < self.cooldown.get(sym, 0):
                        self.counts["skip: cooldown"] += 1
                        continue
                    if len(self.pos) >= cfg.max_open_positions:
                        self.counts["skip: max positions"] += 1
                        continue
                    self._try_enter(sym, self.s[sym], rows[sym], run_ms)

        self.equity_curve.append((run_ms, self.equity(), len(self.pos)))

    def run(self) -> "Backtest":
        for ts in self.timeline:
            self.step(ts)
        if self.timeline:
            end_ms = self.timeline[-1] + H
            for sym in list(self.pos):
                self._exit(sym, self.last_close[sym], "end_of_test", end_ms)
        return self


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #


def _pct(x: float) -> str:
    return f"{x * 100:+.2f}%"


def summarize(bt: Backtest, cfg: Config, label: str, overrides: dict) -> str:
    tr = pd.DataFrame(bt.trades)
    eq = pd.DataFrame(bt.equity_curve, columns=["ms", "equity", "open"])
    start_cash = cfg.paper_start_cash
    L = [f"# Backtest: {label}", ""]
    if eq.empty:
        return "\n".join(L + ["No data in range."])

    final = eq["equity"].iloc[-1] if tr.empty else start_cash + tr["pnl"].sum()
    peak = eq["equity"].cummax()
    max_dd = ((eq["equity"] - peak) / peak).min()
    days = (eq["ms"].iloc[-1] - eq["ms"].iloc[0]) / H / 24
    L += [
        f"Period: {utc(eq['ms'].iloc[0]):%Y-%m-%d} to {utc(eq['ms'].iloc[-1]):%Y-%m-%d} "
        f"({days:.0f} days, {len(bt.s)} coins)",
        f"Settings changed from default: {overrides or 'none'}",
        "",
        "| | |", "|---|---|",
        f"| Start → end equity | ${start_cash:,.2f} → ${final:,.2f} ({_pct(final / start_cash - 1)}) |",
        f"| Max drawdown | {_pct(max_dd)} |",
        f"| Time with a position open | {(eq['open'] > 0).mean() * 100:.0f}% |",
    ]
    btc = bt.s.get("BTC/USD")
    if btc is not None and bt.timeline:
        a, b = btc.idx.get(bt.timeline[0]), btc.idx.get(bt.timeline[-1])
        if a is not None and b is not None:
            L.append(f"| BTC buy & hold, same period | {_pct(btc.close[b] / btc.open[a] - 1)} |")

    if tr.empty:
        L += ["", "**No trades.**"]
    else:
        wins, losses = tr[tr["pnl"] > 0], tr[tr["pnl"] <= 0]
        pf = wins["pnl"].sum() / -losses["pnl"].sum() if len(losses) and losses["pnl"].sum() else float("inf")
        L += [
            f"| Trades | {len(tr)} |",
            f"| Win rate | {len(wins) / len(tr) * 100:.0f}% |",
            f"| Average win / loss | ${wins['pnl'].mean() if len(wins) else 0:+.2f} / "
            f"${losses['pnl'].mean() if len(losses) else 0:+.2f} |",
            f"| Profit factor (gross wins ÷ gross losses) | {pf:.2f} |",
            f"| Average result per trade | ${tr['pnl'].mean():+.2f} ({tr['r_multiple'].mean():+.2f}R) |",
            f"| Fees paid | ${tr['fees'].sum():,.2f} |",
            f"| Average hold | {tr['hours_held'].mean():.0f} h |",
        ]
        if len(tr) < 50:
            L += ["", f"⚠️ Only {len(tr)} trades: too few to tell skill from luck."]

        L += ["", "## Exits by reason", "", "| Reason | Trades | Win rate | PnL |", "|---|---|---|---|"]
        for reason, g in tr.groupby("reason"):
            L.append(f"| {reason} | {len(g)} | {(g['pnl'] > 0).mean() * 100:.0f}% | ${g['pnl'].sum():+.2f} |")

        tr["month"] = tr["closed_at"].str[:7]
        L += ["", "## PnL by month (closed trades)", "", "| Month | Trades | PnL |", "|---|---|---|"]
        for m, g in tr.groupby("month"):
            L.append(f"| {m} | {len(g)} | ${g['pnl'].sum():+.2f} |")

        by_sym = tr.groupby("symbol")["pnl"].agg(["count", "sum"]).sort_values("sum")
        L += ["", "## Coins", "", "| Coin | Trades | PnL |", "|---|---|---|"]
        shown = list(dict.fromkeys(list(by_sym.index[::-1][:5]) + list(by_sym.index[:5][::-1])))
        for sym in shown:
            r = by_sym.loc[sym]
            L.append(f"| {sym} | {int(r['count'])} | ${r['sum']:+.2f} |")
        L += ["", "_Best 5 and worst 5 coins by PnL._"]

    L += ["", "## What happened to the signals", "", "| | Count |", "|---|---|"]
    for k, v in sorted(bt.counts.items(), key=lambda kv: (-kv[1], kv[0])):
        L.append(f"| {k} | {v} |")
    L += ["", "_Data: see backtest.py docstring for limitations (Binance USDT prices, survivorship bias)._"]
    return "\n".join(L)


def write_outputs(bt: Backtest, summary: str, out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "summary.md"), "w") as f:
        f.write(summary + "\n")
    if bt.trades:
        with open(os.path.join(out_dir, "trades.csv"), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(bt.trades[0]))
            w.writeheader()
            w.writerows(bt.trades)
    with open(os.path.join(out_dir, "equity.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["time", "equity", "open_positions"])
        for ms, e, n in bt.equity_curve:
            w.writerow([utc(ms).isoformat(), round(e, 4), n])


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def apply_overrides(cfg: Config, items: list) -> dict:
    names = [f.name for f in fields(cfg) if not isinstance(getattr(cfg, f.name), set)]
    done = {}
    for item in items:
        for part in item.replace(",", " ").split():
            if "=" not in part:
                raise SystemExit(f"--set expects name=value, got {part!r}")
            k, v = part.split("=", 1)
            if k not in names:
                raise SystemExit(f"Unknown setting {k!r}. Options: {', '.join(names)}")
            cur = getattr(cfg, k)
            setattr(cfg, k, type(cur)(float(v)) if isinstance(cur, (int, float)) else v)
            done[k] = getattr(cfg, k)
    return done


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Backtest the Kraken bot's strategy on historical candles")
    ap.add_argument("--days", type=int, default=365, help="length of the test period (default 365)")
    ap.add_argument("--end", help="end date YYYY-MM-DD (default: today)")
    ap.add_argument("--symbols", help="comma-separated, e.g. BTC/USD,ETH/USD (default: 35 liquid coins)")
    ap.add_argument("--source", choices=["binance", "kraken"], default="binance")
    ap.add_argument("--set", action="append", default=[], metavar="NAME=VALUE",
                    help="override a strategy.Config setting; repeatable")
    ap.add_argument("--fee", type=float, help="shortcut for --set fee_rate=...")
    ap.add_argument("--no-fng", action="store_true", help="ignore the Fear & Greed filter")
    ap.add_argument("--cache", default="data", help="download cache directory")
    ap.add_argument("--out", default="reports", help="where to write summary.md, trades.csv, equity.csv")
    args = ap.parse_args(argv)

    cfg = Config()
    overrides = apply_overrides(cfg, args.set + ([f"fee_rate={args.fee}"] if args.fee is not None else []))
    symbols = [s.strip().upper() for s in args.symbols.split(",")] if args.symbols else DEFAULT_SYMBOLS

    end = (datetime.strptime(args.end, "%Y-%m-%d").replace(tzinfo=timezone.utc) if args.end
           else datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0))
    start = end - timedelta(days=args.days)
    warmup = start - timedelta(hours=BOT_WINDOW + 24)  # indicators need history before day 1

    data = {}
    exchange = None
    if args.source == "kraken":
        import ccxt
        exchange = ccxt.kraken({"enableRateLimit": True})
    print(f"Loading {len(symbols)} coins from {args.source} ...")
    for sym in symbols:
        df = load_kraken(sym, exchange) if exchange else load_binance(sym, warmup, end, args.cache)
        if df is None or len(df) < cfg.min_candles:
            print(f"  - {sym}: not enough data, skipped")
            continue
        data[sym] = df
        print(f"  - {sym}: {len(df)} candles from {utc(int(df['timestamp'].iloc[0])):%Y-%m-%d}")
    if not data:
        print("No data loaded.")
        return 1

    fng = None if args.no_fng else load_fear_greed(args.cache)
    bt = Backtest(data, cfg, fng, start_ms=int(start.timestamp() * 1000)).run()
    label = f"{args.days} days, {args.source} data"
    summary = summarize(bt, cfg, label, overrides)
    write_outputs(bt, summary, args.out)
    print()
    print(summary)
    print(f"\nWrote {args.out}/summary.md, trades.csv, equity.csv")
    return 0


if __name__ == "__main__":
    sys.exit(main())
