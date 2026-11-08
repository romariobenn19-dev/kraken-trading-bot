import os
import ccxt
import requests
import feedparser
import pandas as pd
import pandas_ta as ta
import nltk
from nltk.sentiment.vader import SentimentIntensityAnalyzer

nltk.download('vader_lexicon', quiet=True)

class KrakenMarketOpportunityBot:
    def __init__(self):
        # ---------------- 1. RISK & PORTFOLIO LIMITS ----------------
        self.paper_trading = True            # True = Simulation; False = Real Money on Kraken
        self.quote_currency = 'USD'
        self.max_open_positions = 4          # Max concurrent trades
        self.pct_per_trade = 0.15            # Allocate 15% of available USD cash per trade
        self.min_order_usd = 10.0            # Kraken minimum order value threshold
        self.min_24h_volume_usd = 25000.0    # Ignores illiquid pairs to prevent slippage

        # Known volatile meme tokens get wider stops to prevent premature stop-outs
        self.known_meme_bases = {'DOGE', 'SHIB', 'PEPE', 'BONK', 'WIF', 'FLOKI', 'MEME', 'TURBO', 'BOME'}

        # ---------------- 2. KRAKEN & SENTIMENT SETUP ----------------
        self.kraken_api_key = os.getenv('KRAKEN_API_KEY')
        self.kraken_secret = os.getenv('KRAKEN_PRIVATE_KEY')

        self.exchange = ccxt.kraken({
            'apiKey': self.kraken_api_key,
            'secret': self.kraken_secret,
            'enableRateLimit': True,
        })
        self.sia = SentimentIntensityAnalyzer()
        self.rss_feeds = [
            'https://cointelegraph.com/rss',
            'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml'
        ]

    # ---------------- 3. SENTIMENT ENGINES ----------------
    def fetch_live_news_sentiment(self):
        headlines = []
        try:
            for url in self.rss_feeds:
                feed = feedparser.parse(url)
                for entry in feed.entries[:5]:
                    if hasattr(entry, 'title'):
                        headlines.append(entry.title)
            if not headlines:
                return 0.0
            scores = [self.sia.polarity_scores(h)['compound'] for h in headlines]
            return float(sum(scores) / len(scores))
        except Exception:
            return 0.0

    def fetch_fear_and_greed_score(self):
        try:
            res = requests.get('https://api.alternative.me/fng/?limit=1', timeout=5)
            if res.status_code == 200:
                val = float(res.json()['data'][0]['value'])
                return (val - 50.0) / 50.0
        except Exception:
            pass
        return 0.0

    # ---------------- 4. REAL-TIME ACCOUNT BALANCE ----------------
    def get_portfolio_state(self):
        """Returns available USD and list of assets currently held."""
        if self.paper_trading:
            return 1000.0, []
        try:
            balance = self.exchange.fetch_balance()
            free_usd = balance.get('free', {}).get(self.quote_currency, 0.0)
            
            open_symbols = []
            for asset, amount in balance.get('free', {}).items():
                if asset not in ['USD', 'USDT', 'USDC'] and amount > 0:
                    symbol = f"{asset}/{self.quote_currency}"
                    try:
                        ticker = self.exchange.fetch_ticker(symbol)
                        if (amount * ticker['last']) >= 5.0:
                            open_symbols.append(symbol)
                    except Exception:
                        continue
            return free_usd, open_symbols
        except Exception as e:
            print(f"[Balance Query Warning]: {e}")
            return 0.0, []

    # ---------------- 5. STAGE 1: FULL MARKET SCANNER ----------------
    def scan_all_kraken_opportunities(self):
        """Scans every active USD pair on Kraken and picks top candidates showing momentum."""
        print("--> Fetching all market tickers across Kraken...")
        tickers = self.exchange.fetch_tickers()
        candidates = []

        for symbol, ticker in tickers.items():
            if not symbol.endswith(f"/{self.quote_currency}"):
                continue
            
            last_price = ticker.get('last')
            base_vol = ticker.get('baseVolume')
            if not last_price or not base_vol:
                continue

            quote_volume_usd = base_vol * last_price
            if quote_volume_usd < self.min_24h_volume_usd:
                continue  # Skip dead tokens

            pct_change = ticker.get('percentage', 0.0) or 0.0
            candidates.append({
                'symbol': symbol,
                'price': last_price,
                'volume_usd': quote_volume_usd,
                'change_24h': pct_change
            })

        # Rank by highest 24h price action to focus deep scans on breakout tokens
        candidates.sort(key=lambda x: abs(x['change_24h']), reverse=True)
        print(f"--> Found {len(candidates)} tradeable, liquid USD pairs on Kraken.")
        return candidates[:25]

    # ---------------- 6. STAGE 2: NULL-SAFE TECHNICAL ANALYSIS ----------------
    def analyze_candidate(self, symbol):
        try:
            # Request 250 candles so 200 EMA can calculate properly
            candles = self.exchange.fetch_ohlcv(symbol, timeframe='15m', limit=250)
            if not candles or len(candles) < 30:
                return None
            df = pd.DataFrame(candles, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])

            # Moving Averages
            df['ema_20'] = ta.ema(df['close'], length=20)
            df['ema_50'] = ta.ema(df['close'], length=50)
            df['ema_200'] = ta.ema(df['close'], length=200)

            # Momentum
            df['rsi'] = ta.rsi(df['close'], length=14)
            macd_df = ta.macd(df['close'], fast=12, slow=26, signal=9)
            if macd_df is not None and not macd_df.empty:
                hist_col = [col for col in macd_df.columns if 'h' in col.lower()]
                df['MACDh'] = macd_df[hist_col[0]] if hist_col else 0.0
            else:
                df['MACDh'] = 0.0

            # Bollinger Bands
            sma20 = df['close'].rolling(window=20).mean()
            std20 = df['close'].rolling(window=20).std()
            df['BBL'] = sma20 - (2.0 * std20)
            df['BBU'] = sma20 + (2.0 * std20)

            # Volatility (ATR)
            df['atr'] = ta.atr(df['high'], df['low'], df['close'], length=14)

            # Validate that critical values exist on the latest candle
            if pd.isna(df['atr'].iloc[-1]) or pd.isna(df['rsi'].iloc[-1]):
                return None

            # Candlestick Formations
            body = df['close'] - df['open']
            prev_body = body.shift(1)
            df['bullish_engulfing'] = (prev_body < 0) & (body > 0) & (df['close'] > df['open'].shift(1)) & (df['open'] < df['close'].shift(1))
            df['bearish_engulfing'] = (prev_body > 0) & (body < 0) & (df['close'] < df['open'].shift(1)) & (df['open'] > df['close'].shift(1))
            return df
        except Exception:
            return None

    def evaluate_confluence(self, df, news_sentiment, macro_sentiment, is_meme):
        curr = df.iloc[-1]
        prev = df.iloc[-2]
        score = 0

        # Safe Trend Evaluation: Fall back to 50 EMA if coin is too new for 200 EMA
        if pd.notna(curr.get('ema_200')):
            score += 15 if curr['close'] > curr['ema_200'] else -15
        elif pd.notna(curr.get('ema_50')):
            score += 15 if curr['close'] > curr['ema_50'] else -15

        # EMA alignment
        if pd.notna(curr.get('ema_20')) and pd.notna(curr.get('ema_50')):
            score += 10 if curr['ema_20'] > curr['ema_50'] else -10

        # RSI Momentum
        rsi = curr.get('rsi', 50)
        if pd.notna(rsi):
            if rsi < 30:
                score += 15
            elif rsi > 70:
                score -= 15
            elif 45 <= rsi <= 60:
                score += 5

        # MACD Crossover
        macdh_curr = curr.get('MACDh', 0.0)
        macdh_prev = prev.get('MACDh', 0.0)
        if pd.notna(macdh_curr) and pd.notna(macdh_prev):
            if macdh_curr > 0 and macdh_prev <= 0:
                score += 15
            elif macdh_curr < 0 and macdh_prev >= 0:
                score -= 15

        # Bollinger Bands bounds
        if pd.notna(curr.get('BBL')) and curr['close'] <= curr['BBL']:
            score += 10
        elif pd.notna(curr.get('BBU')) and curr['close'] >= curr['BBU']:
            score -= 10

        # Candlestick Formations
        if curr.get('bullish_engulfing', False):
            score += 10
        elif curr.get('bearish_engulfing', False):
            score -= 10

        # Sentiment weighting
        sentiment_weight = 20 if is_meme else 10
        score += int(news_sentiment * sentiment_weight)
        score += int(macro_sentiment * 10)

        atr_val = curr['atr'] if pd.notna(curr.get('atr')) else (curr['close'] * 0.02)
        return score, atr_val, curr['close']

    # ---------------- 7. EXECUTION ENGINE ----------------
    def execute_trade(self, symbol, side, amount, price=None, sl=None):
        mode_label = "[PAPER]" if self.paper_trading else "[LIVE]"
        print(f"{mode_label} ORDER: {side} {amount} {symbol} @ ~${price:.6f}")
        if self.paper_trading:
            return True
        try:
            if side == 'BUY':
                self.exchange.create_market_buy_order(symbol, amount)
                if sl:
                    self.exchange.create_order(
                        symbol=symbol,
                        type='stop-loss',
                        side='sell',
                        amount=amount,
                        price=sl,
                        params={'stopLossPrice': sl}
                    )
            elif side == 'SELL':
                self.exchange.cancel_all_orders(symbol)
                self.exchange.create_market_sell_order(symbol, amount)
            return True
        except Exception as e:
            print(f"[Execution Error on {symbol}]: {e}")
            return False

    # ---------------- 8. RUN CYCLE ----------------
    def run_check(self):
        print("=== KRAKEN GLOBAL MARKET OPPORTUNITY SCANNER ===")
        free_usd, open_positions = self.get_portfolio_state()
        print(f"Available Capital: ${free_usd:.2f} USD | Open Trades: {open_positions}")

        news_sent = self.fetch_live_news_sentiment()
        macro_sent = self.fetch_fear_and_greed_score()
        print(f"Global News: {news_sent:+.2f} | Macro Index: {macro_sent:+.2f}")

        # Scan the entire exchange
        candidates = self.scan_all_kraken_opportunities()
        evaluated = []

        for c in candidates:
            sym = c['symbol']
            base_coin = sym.split('/')[0]
            is_meme = base_coin in self.known_meme_bases

            df = self.analyze_candidate(sym)
            if df is None:
                continue

            score, atr, current_price = self.evaluate_confluence(df, news_sent, macro_sent, is_meme)
            evaluated.append({
                'symbol': sym,
                'base': base_coin,
                'price': current_price,
                'score': score,
                'atr': atr,
                'rsi': df['rsi'].iloc[-1],
                'is_meme': is_meme
            })

        # Rank all scanned coins by Confluence Score
        evaluated.sort(key=lambda x: x['score'], reverse=True)

        print("\n--- Top Opportunities Detected This Cycle ---")
        for e in evaluated[:5]:
            print(f"[{e['symbol']}] Score: {e['score']}/100 | RSI: {e['rsi']:.1f} | Price: ${e['price']:.4f}")

        # Check for Exits on current open positions first
        for sym in list(open_positions):
            base_coin = sym.split('/')[0]
            df = self.analyze_candidate(sym)
            if df is not None:
                score, _, current_price = self.evaluate_confluence(df, news_sent, macro_sent, base_coin in self.known_meme_bases)
                if score <= -40:
                    print(f"--> [EXIT SIGNAL] Score fell to {score} for {sym}. Selling position.")
                    if not self.paper_trading:
                        bal = self.exchange.fetch_balance()
                        qty = bal.get('free', {}).get(base_coin, 0.0)
                        self.execute_trade(sym, 'SELL', qty, current_price)
                    else:
                        self.execute_trade(sym, 'SELL', 1.0, current_price)
                    open_positions.remove(sym)

        # Execute Buys on the highest-scoring qualified setups
        for opp in evaluated:
            if len(open_positions) >= self.max_open_positions:
                print(f"Max portfolio allocation ({self.max_open_positions} positions) reached. Holding.")
                break

            sym = opp['symbol']
            if sym in open_positions:
                continue

            if opp['score'] >= 45:
                allocation_usd = free_usd * self.pct_per_trade
                if allocation_usd < self.min_order_usd:
                    print(f"Capital remaining (${allocation_usd:.2f}) below minimum order threshold.")
                    break

                sl_mult = 2.5 if opp['is_meme'] else 1.5
                tp_mult = 5.0 if opp['is_meme'] else 3.0

                order_qty = round(allocation_usd / opp['price'], 6)
                sl_price = round(opp['price'] - (sl_mult * opp['atr']), 4)
                tp_price = round(opp['price'] + (tp_mult * opp['atr']), 4)

                print(f"\n--> [BUY TRIGGERED] {sym} | Score: {opp['score']} | Allocation: ${allocation_usd:.2f} | SL: ${sl_price} | TP: ${tp_price}")
                success = self.execute_trade(sym, 'BUY', order_qty, opp['price'], sl_price)
                if success:
                    open_positions.append(sym)
                    free_usd -= allocation_usd

        if not open_positions and (not evaluated or evaluated[0]['score'] < 45):
            print("Status: No coins met confluence criteria (Score >= 45). Capital preserved.")

if __name__ == '__main__':
    bot = KrakenMarketOpportunityBot()
    bot.run_check()
