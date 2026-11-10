# kraken-trading-bot

A Kraken spot trend-following bot. **Paper trading by default.**

- `strategy.py` – indicators, entry rule and fee-aware position sizing (no exchange access).
- `kraken_bot.py` – runs the strategy against Kraken: scans pairs, opens/manages positions, saves state.
- `.github/workflows/trade.yml` – runs the bot on GitHub Actions and commits its state back to the repo.

## Strategy in one paragraph

On closed 1h candles it buys liquid USD pairs that are in an uptrend
(close > EMA50 > EMA200, RSI < 70) when the MACD histogram turns positive or
RSI rebounds through 40. Stop = 1.5×ATR, target = 3×ATR (2.5/5×ATR for meme
coins). Position size risks 1% of equity at the stop *including fees*; trades
whose target doesn't cover fees at a net reward:risk of 1.2 are skipped. It
also exits if a candle closes below EMA50. Max 4 positions, 70% total exposure,
no new entries after a 3% daily loss or when the Fear & Greed index is below 25.

## Running locally

```bash
pip install -r requirements.txt
```

```bash
python kraken_bot.py            # one paper run
```

```bash
python kraken_bot.py --loop     # paper-trade continuously, once per candle
```

```bash
python kraken_bot.py --status   # show positions and results
```

## Backtesting

`backtest.py` replays historical 1h candles through the same `strategy.py`
code, with the bot's sizing, fees, exits and risk limits. It also computes
EMA50/EMA200 over the same 299-candle window the bot uses.

Easiest: Actions tab → **Backtest** → **Run workflow**. Choose how many days,
optionally which coins and which settings to change (e.g. `fee_rate=0.004`).
The report appears on the run's page; the trade list and equity curve are
attached as `backtest-results`.

Locally:

```bash
python backtest.py --days 730
```

```bash
python backtest.py --days 730 --set "fee_rate=0.004 tp_atr=4"
```

Any number field in `strategy.Config` can be changed with `--set`. Read the
limitations in the `backtest.py` docstring: it uses Binance USDT price
history (Kraken only serves ~30 days) and today's coin list.

Run the tests with:

```bash
python -m unittest discover -s tests
```

## Running on GitHub Actions

The workflow runs at 2 minutes past every hour, **but GitHub does not guarantee
scheduled runs**. On this repo they have actually fired every 4–11 hours. While
paper trading that only makes results noisier. Before trading real money, run
the bot somewhere that really runs hourly, for example:

- an always-on machine or small VPS running `python kraken_bot.py --loop`, or
- an external scheduler (e.g. cron-job.org) calling GitHub's
  `workflow_dispatch` API for `trade.yml` every hour.

Stop-losses are real orders on Kraken in live mode, so a late run cannot skip
a stop – but take-profit and trend exits only happen when the bot runs.

### Repository settings

Settings → Secrets and variables → Actions:

| Name | Type | Purpose |
| --- | --- | --- |
| `KRAKEN_API_KEY` | secret | Kraken API key (needs query + trade permissions for live) |
| `KRAKEN_PRIVATE_KEY` | secret | Kraken API private key |
| `FEE_RATE` | variable | Your taker fee as a decimal, e.g. `0.0040`. Check your tier on Kraken. Default: `0.0080` |
| `LIVE_TRADING` | variable | `true` = real money. Anything else = paper |

Live mode refuses to start if the repository is public, because the live state
file (positions, balances, trade history) is committed to the repo.

### Before going live

1. Get a few weeks of paper trades and check `--status` / `trades_paper.csv`.
2. Set `FEE_RATE` to your real fee.
3. Run the workflow manually with action **check-live** to verify your keys
   and that Kraken accepts the stop-loss order format (nothing is placed).
4. Make the repository private, then set `LIVE_TRADING=true`.

Dependencies are pinned in `requirements.txt`. If you upgrade ccxt, run
**check-live** again.
