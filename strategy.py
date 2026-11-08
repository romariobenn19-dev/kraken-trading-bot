"""
strategy.py - pure strategy logic. No exchange, no network, no files.

Both the live/paper bot (kraken_bot.py) and the backtester (backtest.py) import
this module, so what you backtest is exactly what the bot trades.

Indicators are implemented in plain pandas (Wilder smoothing for RSI/ATR), so
there is no pandas_ta dependency.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #


@dataclass
class Config:
    # Market / data
    quote: str = "USD"
    timeframe: str = "1h"
    min_candles: int = 220              # need a real EMA-200, no fallbacks
    scan_top_n: int = 35                # deep-scan the N most liquid pairs
    min_24h_volume_usd: float = 250_000.0
    max_spread_pct: float = 0.005       # skip pairs with bid/ask spread > 0.5%

    # Portfolio / risk
    max_open_positions: int = 4
    risk_per_trade_pct: float = 0.01    # loss at the stop, INCLUDING fees, = 1% equity
    max_position_pct: float = 0.25      # one position <= 25% of equity
    max_total_exposure_pct: float = 0.70  # all positions together <= 70% of equity
    min_order_usd: float = 10.0
    daily_loss_limit_pct: float = 0.03  # no new entries after -3% on the UTC day
    cooldown_hours: float = 6.0         # no re-entry on a symbol after an exit
    fng_block_below: int = 25           # no new entries in extreme fear

    # Trade geometry (multiples of ATR)
    sl_atr: float = 1.5
    tp_atr: float = 3.0
    meme_sl_atr: float = 2.5
    meme_tp_atr: float = 5.0
    max_stop_pct: float = 0.08          # skip if stop would be > 8% away

    # Costs. Kraken Pro Tier 1 spot taker is 0.80% (maker 0.40%) as of
    # July 2026 - CHECK YOUR OWN TIER and edit. Stop-loss triggers and market
    # orders both pay the taker fee.
    fee_rate: float = 0.0080
    slippage_rate: float = 0.0005
    min_net_rr: float = 1.2             # require (TP - costs) / (SL + costs) >= this

    # Paper trading
    paper_start_cash: float = 1000.0

    # Timing for --loop
    run_delay_seconds: int = 90         # run this long after each candle closes

    excluded_bases: set = field(default_factory=lambda: {
        # stablecoins
        "USDT", "USDC", "DAI", "PYUSD", "USDG", "RLUSD", "TUSD", "FDUSD", "USDD",
        "USDE", "USDS", "USD1", "UST", "EURT", "EURC", "EURR", "EURQ", "AUDT",
        # fiat
        "USD", "EUR", "GBP", "CAD", "JPY", "CHF", "AUD", "AED",
        # gold tokens (don't behave like crypto)
        "PAXG", "XAUT",
    })
    meme_bases: set = field(default_factory=lambda: {
        "DOGE", "SHIB", "PEPE", "BONK", "WIF", "FLOKI", "MEME", "TURBO", "BOME",
    })

    def is_excluded(self, base: str) -> bool:
        return base.upper() in self.excluded_bases

    def is_meme(self, base: str) -> bool:
        return base.upper() in self.meme_bases


# --------------------------------------------------------------------------- #
# Timeframes & candles
# --------------------------------------------------------------------------- #

_TF_UNITS = {"m": 60_000, "h": 3_600_000, "d": 86_400_000, "w": 604_800_000}


def timeframe_ms(tf: str) -> int:
    m = re.fullmatch(r"(\d+)([mhdw])", tf.strip())
    if not m:
        raise ValueError(f"Unsupported timeframe: {tf!r}")
    return int(m.group(1)) * _TF_UNITS[m.group(2)]


def to_df(ohlcv) -> pd.DataFrame:
    df = pd.DataFrame(ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df = df.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
    df["timestamp"] = df["timestamp"].astype("int64")
    return df


def closed_only(df: pd.DataFrame, tf_ms: int, now_ms: int) -> pd.DataFrame:
    """Drop the still-forming last candle (open time + timeframe > now)."""
    if df is None or df.empty:
        return df
    if int(df["timestamp"].iloc[-1]) + tf_ms > now_ms:
        return df.iloc[:-1].reset_index(drop=True)
    return df


# --------------------------------------------------------------------------- #
# Indicators
# --------------------------------------------------------------------------- #


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()
    avg_loss = loss.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100.0 - 100.0 / (1.0 + rs)
    # no losses at all in the window -> RSI is 100 (not NaN)
    return out.mask((avg_loss == 0.0) & avg_gain.notna(), 100.0)


def atr(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat(
        [(high - low), (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return tr.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()


def macd_hist(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.Series:
    macd_line = ema(close, fast) - ema(close, slow)
    signal_line = macd_line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return macd_line - signal_line


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["ema50"] = ema(df["close"], 50)
    df["ema200"] = ema(df["close"], 200)
    df["rsi"] = rsi(df["close"], 14)
    df["atr"] = atr(df["high"], df["low"], df["close"], 14)
    df["macdh"] = macd_hist(df["close"])
    return df


# --------------------------------------------------------------------------- #
# Entry rule (one implementation, used by bot AND backtester)
# --------------------------------------------------------------------------- #

_REQUIRED = ["ema50", "ema200", "rsi", "atr", "macdh"]


def signal_series(df: pd.DataFrame) -> pd.Series:
    """
    True on candle i when, using only data up to and including candle i's close:
      * Trend gate:  close > EMA50, close > EMA200 and EMA50 > EMA200
      * Not overheated: RSI < 70
      * Trigger: MACD histogram crosses above 0  OR  RSI crosses back up through 40
    """
    close = df["close"]
    trend = (close > df["ema50"]) & (close > df["ema200"]) & (df["ema50"] > df["ema200"])
    macd_cross = (df["macdh"] > 0) & (df["macdh"].shift(1) <= 0)
    rsi_rebound = (df["rsi"].shift(1) < 40) & (df["rsi"] >= 40)
    not_hot = df["rsi"] < 70
    valid = df[_REQUIRED].notna().all(axis=1)
    return (valid & trend & not_hot & (macd_cross | rsi_rebound)).fillna(False)


@dataclass
class Signal:
    ok: bool
    atr: float = 0.0
    close: float = 0.0
    reason: str = ""


def entry_signal(df_closed_with_ind: pd.DataFrame, min_candles: int = 220) -> Signal:
    """Evaluate the entry rule on the LAST row, which must be a closed candle."""
    if df_closed_with_ind is None or len(df_closed_with_ind) < min_candles:
        return Signal(False, reason="not enough history")
    last = df_closed_with_ind.iloc[-1]
    if last[_REQUIRED].isna().any():
        return Signal(False, reason="indicators not ready")
    ok = bool(signal_series(df_closed_with_ind).iloc[-1])
    return Signal(ok, float(last["atr"]), float(last["close"]), "signal" if ok else "no signal")


# --------------------------------------------------------------------------- #
# Fee-aware trade planning
# --------------------------------------------------------------------------- #


def plan_trade(price: float, atr_value: float, equity: float, is_meme: bool, cfg: Config):
    """
    Returns (plan_dict, "") or (None, reason).

    Sizing: quantity is chosen so that the loss if the stop is hit - price move
    PLUS entry and exit fees/slippage - equals risk_per_trade_pct of equity,
    then capped at max_position_pct of equity.

    Trade filter: after costs, the take-profit must be worth at least
    min_net_rr times the stop-loss. At Tier-1 Kraken fees (1.6% round trip) this
    skips quiet coins, which is the point: their targets don't pay for the fees.
    """
    if not (price > 0 and atr_value > 0 and equity > 0):
        return None, "bad inputs"

    sl_mult = cfg.meme_sl_atr if is_meme else cfg.sl_atr
    tp_mult = cfg.meme_tp_atr if is_meme else cfg.tp_atr
    sl_dist = sl_mult * atr_value
    tp_dist = tp_mult * atr_value
    sl_price = price - sl_dist
    tp_price = price + tp_dist

    if sl_price <= 0:
        return None, "stop would be <= 0"
    if sl_dist / price > cfg.max_stop_pct:
        return None, f"stop {sl_dist / price:.1%} away exceeds {cfg.max_stop_pct:.0%}"

    c = cfg.fee_rate + cfg.slippage_rate
    cost_in = price * c
    loss_per_unit = sl_dist + cost_in + sl_price * c
    gain_per_unit = tp_dist - cost_in - tp_price * c
    if gain_per_unit <= 0:
        return None, "take-profit does not cover fees"
    net_rr = gain_per_unit / loss_per_unit
    if net_rr < cfg.min_net_rr:
        return None, f"net R:R {net_rr:.2f} < {cfg.min_net_rr} after fees"

    qty_risk = (equity * cfg.risk_per_trade_pct) / loss_per_unit
    qty_cap = (equity * cfg.max_position_pct) / price
    qty = min(qty_risk, qty_cap)
    return {
        "qty": qty,
        "sl_dist": sl_dist,
        "tp_dist": tp_dist,
        "sl": sl_price,
        "tp": tp_price,
        "net_rr": net_rr,
        "capped": qty_cap < qty_risk,
        "risk_usd": qty * loss_per_unit,
    }, ""
