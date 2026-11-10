"""Run with:  python -m unittest discover -s tests"""
import io
import os
import sys
import tempfile
import unittest
from unittest import mock

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import backtest as bt  # noqa: E402
import strategy as st  # noqa: E402
from strategy import Config  # noqa: E402

H = bt.H
T0 = 1_767_225_600_000  # 2026-01-01 00:00 UTC


def synthetic(n=2500, seed=0, start_price=100.0, drift=0.0):
    """Random walk with alternating trends, so the strategy produces signals."""
    rng = np.random.default_rng(seed)
    regime = np.repeat(rng.choice([-1, 1], size=n // 200 + 1), 200)[:n] * 0.0015 + drift
    rets = regime + rng.normal(0, 0.01, n)
    close = start_price * np.exp(np.cumsum(rets))
    open_ = np.concatenate([[start_price], close[:-1]])
    wig = np.abs(rng.normal(0, 0.006, n))
    high = np.maximum(open_, close) * (1 + wig)
    low = np.minimum(open_, close) * (1 - wig)
    vol = rng.uniform(1000, 5000, n)
    ts = T0 + np.arange(n) * H
    return st.to_df(np.column_stack([ts, open_, high, low, close, vol]).tolist())


class WindowedEmaTest(unittest.TestCase):
    def test_matches_bot_window_recomputation(self):
        df = synthetic(900)
        fast = bt.windowed_ema(df["close"], 200, bt.BOT_WINDOW)
        for t in (250, 298, 299, 500, 899):
            lo = max(0, t - bt.BOT_WINDOW + 1)
            expected = st.ema(df["close"].iloc[lo:t + 1], 200).iloc[-1]
            self.assertAlmostEqual(fast.iloc[t], expected, places=9, msg=f"t={t}")


class SignalParityTest(unittest.TestCase):
    def test_backtest_signal_equals_bot_entry_signal(self):
        """At every candle, the backtester's signal = what kraken_bot would compute."""
        cfg = Config()
        df = synthetic(1500, seed=3)
        s = bt.Series(df, cfg)
        checked = hits = 0
        for t in range(cfg.min_candles - 1, len(df)):
            lo = max(0, t - bt.BOT_WINDOW + 1)
            window = st.add_indicators(df.iloc[lo:t + 1].reset_index(drop=True))
            bot = st.entry_signal(window, cfg.min_candles).ok
            # RSI/ATR/MACD use full history in the backtest; they converge within
            # far fewer than 299 candles, so allow nothing but float noise.
            self.assertEqual(bool(s.signal[t]), bot, msg=f"t={t}")
            checked += 1
            hits += bot
        self.assertGreater(hits, 3, "synthetic data should produce some signals")


class EngineTest(unittest.TestCase):
    def setUp(self):
        self.cfg = Config()
        self.data = {
            "AAA/USD": synthetic(3000, seed=1),
            "BBB/USD": synthetic(3000, seed=2, start_price=5.0),
            "PEPE/USD": synthetic(3000, seed=4, start_price=1e-5),
        }

    def test_accounting_and_rules(self):
        cfg = self.cfg
        r = bt.Backtest(self.data, cfg, start_ms=T0 + 400 * H).run()
        self.assertGreater(len(r.trades), 5)
        self.assertEqual(r.pos, {})
        # cash at the end = start + every trade's pnl (fees included)
        self.assertAlmostEqual(r.cash, cfg.paper_start_cash + sum(t["pnl"] for t in r.trades), places=4)
        self.assertLessEqual(max(n for _, _, n in r.equity_curve), cfg.max_open_positions)
        for t in r.trades:
            self.assertGreater(t["fees"], 0)
            if t["reason"] == "stop":
                # a stop loses about 1% of equity, more only if price gapped through it
                self.assertLess(t["pnl"], 0)

    def test_entry_uses_next_open_not_signal_close(self):
        cfg = self.cfg
        r = bt.Backtest(self.data, cfg, start_ms=T0 + 400 * H).run()
        self.assertTrue(r.trades)
        for t in r.trades:
            s = r.s[t["symbol"]]
            opened = pd.Timestamp(t["opened_at"]).value // 10**6  # run time = signal candle close
            nxt = s.idx[opened]  # the candle that opens when the bot runs
            self.assertTrue(s.signal[nxt - 1])
            self.assertAlmostEqual(t["entry_price"], s.open[nxt] * (1 + cfg.slippage_rate), places=9)

    def test_cooldown_blocks_reentry(self):
        cfg = self.cfg
        r = bt.Backtest(self.data, cfg, start_ms=T0 + 400 * H).run()
        last_close = {}
        for t in r.trades:
            sym = t["symbol"]
            if sym in last_close:
                gap_h = (pd.Timestamp(t["opened_at"]) - last_close[sym]).total_seconds() / 3600
                self.assertGreaterEqual(gap_h, cfg.cooldown_hours)
            last_close[sym] = pd.Timestamp(t["closed_at"])

    def test_higher_fees_never_help(self):
        lo = bt.Backtest(self.data, Config(fee_rate=0.002), start_ms=T0 + 400 * H).run()
        hi = bt.Backtest(self.data, Config(fee_rate=0.02), start_ms=T0 + 400 * H).run()
        self.assertGreaterEqual(len(lo.trades), len(hi.trades))


class CliTest(unittest.TestCase):
    def test_main_writes_reports(self):
        data = {"BTC/USD": synthetic(3000, seed=5, start_price=60000), "ETH/USD": synthetic(3000, seed=6)}
        end = pd.Timestamp(T0 + 3000 * H, unit="ms").strftime("%Y-%m-%d")
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(bt, "load_binance", side_effect=lambda s, a, b, c: data.get(s)), \
                mock.patch.object(bt, "load_fear_greed", return_value=None), \
                mock.patch("sys.stdout", new_callable=io.StringIO):
            rc = bt.main(["--days", "100", "--end", end, "--symbols", "BTC/USD,ETH/USD,XYZ/USD",
                          "--set", "fee_rate=0.004", "--out", d, "--cache", d])
            self.assertEqual(rc, 0)
            summary = open(os.path.join(d, "summary.md")).read()
            self.assertIn("fee_rate", summary)
            self.assertIn("BTC buy & hold", summary)
            self.assertTrue(os.path.exists(os.path.join(d, "equity.csv")))

    def test_unknown_setting_rejected(self):
        with self.assertRaises(SystemExit):
            bt.apply_overrides(Config(), ["not_a_setting=1"])


if __name__ == "__main__":
    unittest.main()
