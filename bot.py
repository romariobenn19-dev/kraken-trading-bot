import os
import ccxt
import requests
import feedparser
import pandas as pd
import pandas_ta as ta
import nltk
from nltk.sentiment.vader import SentimentIntensityAnalyzer

nltk.download('vader_lexicon', quiet=True)

class GitHubActionTradingBot:
    def __init__(self):
        self.symbol = 'BTC/USD'
        self.base_asset = 'BTC'
        self.timeframe = '15m'
        self.trade_qty_btc = 0.0005     # Position size
        self.paper_trading = True       # True = Simulation; False = Real Funds on Kraken

        self.kraken_api_key = os.getenv('KRAKEN_API_KEY')
        self.kraken_secret = os.getenv('KRAKEN_PRIVATE_KEY')

        self.rss_feeds = [
            'https://cointelegraph.com/rss',
            'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml'
        ]

        self.exchange = ccxt.kraken({
            'apiKey': self.kraken_api_key,
            'secret': self.kraken_secret,
            'enableRateLimit': True,
        })
        self.sia = SentimentIntensityAnalyzer()

    def get_market_position(self):
        """Checks Kraken balance to verify if BTC is currently held."""
        if self.paper_trading:
            return False
        try:
            balance = self.exchange.fetch_balance()
            btc_free = balance.get('free', {}).get(self.base_asset, 0.0)
            return btc_free >= self.trade_qty_btc
        except Exception as e:
            print(f"[Balance Fetch Error]: {e}")
            return False

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

    def fetch_technical_analysis(self):
        candles = self.exchange.fetch_ohlcv(self.symbol, timeframe=self.timeframe, limit=200)
        df = pd.DataFrame(candles, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        
        # Moving Averages (Trend)
        df['ema_20'] = ta.ema(df['close'], length=20)
        df['ema_50'] = ta.ema(df['close'], length=50)
        df['ema_200'] = ta.ema(df['close'], length=200)
        
        # Momentum (RSI)
        df['rsi'] = ta.rsi(df['close'], length=14)
        
        # MACD (Dynamic column extraction)
        macd_df = ta.macd(df['close'], fast=12, slow=26, signal=9)
        if macd_df is not None and not macd_df.empty:
            hist_col = [col for col in macd_df.columns if 'h' in col.lower()][0]
            df['MACDh'] = macd_df[hist_col]
        else:
            df['MACDh'] = 0.0

        # Bollinger Bands (Calculated directly to prevent version naming mismatches)
        sma20 = df['close'].rolling(window=20).mean()
        std20 = df['close'].rolling(window=20).std()
        df['BBL'] = sma20 - (2.0 * std20)
        df['BBU'] = sma20 + (2.0 * std20)
        
        # Volatility (ATR)
        df['atr'] = ta.atr(df['high'], df['low'], df['close'], length=14)

        # Candlestick Pattern Detection
        body = df['close'] - df['open']
        prev_body = body.shift(1)
        df['bullish_engulfing'] = (prev_body < 0) & (body > 0) & (df['close'] > df['open'].shift(1)) & (df['open'] < df['close'].shift(1))
        df['bearish_engulfing'] = (prev_body > 0) & (body < 0) & (df['close'] < df['open'].shift(1)) & (df['open'] > df['close'].shift(1))
        
        return df

    def evaluate_confluence(self, df, news_sentiment, macro_sentiment):
        curr = df.iloc[-1]
        prev = df.iloc[-2]
        score = 0

        # Trend alignment
        score += 15 if curr['close'] > curr['ema_200'] else -15
        score += 10 if curr['ema_20'] > curr['ema_50'] else -10

        # RSI Momentum
        if curr['rsi'] < 30:
            score += 15
        elif curr['rsi'] > 70:
            score -= 15
        elif 45 <= curr['rsi'] <= 60:
            score += 5

        # MACD Histogram Crossover
        if curr['MACDh'] > 0 and prev['MACDh'] <= 0:
            score += 15
        elif curr['MACDh'] < 0 and prev['MACDh'] >= 0:
            score -= 15

        # Bollinger Bands Boundaries
        if curr['close'] <= curr['BBL']:
            score += 10
        elif curr['close'] >= curr['BBU']:
            score -= 10

        # Engulfing Candles
        if curr['bullish_engulfing']:
            score += 10
        elif curr['bearish_engulfing']:
            score -= 10

        # Sentiment
        score += int(news_sentiment * 15)
        score += int(macro_sentiment * 10)
        
        return score, curr['atr']

    def run_check(self):
        print(f"=== Running Market Evaluation on GitHub Cloud ===")
        df = self.fetch_technical_analysis()
        current_price = df['close'].iloc[-1]
        news_sent = self.fetch_live_news_sentiment()
        macro_sent = self.fetch_fear_and_greed_score()
        score, atr = self.evaluate_confluence(df, news_sent, macro_sent)

        in_position = self.get_market_position()
        print(f"Current BTC Price: ${current_price:.2f}")
        print(f"RSI: {df['rsi'].iloc[-1]:.1f} | News: {news_sent:+.2f} | Confluence: {score}/100")
        print(f"Currently in Position: {in_position}")

        # BUY trigger: High Confluence & not holding BTC
        if not in_position and score >= 45:
            sl = round(current_price - (1.5 * atr), 2)
            tp = round(current_price + (3.0 * atr), 2)
            print(f"[SIGNAL: BUY] Score: {score} | SL: ${sl} | TP: ${tp}")
            if not self.paper_trading:
                self.exchange.create_market_buy_order(self.symbol, self.trade_qty_btc)
                self.exchange.create_order(
                    symbol=self.symbol,
                    type='stop-loss',
                    side='sell',
                    amount=self.trade_qty_btc,
                    price=sl,
                    params={'stopLossPrice': sl}
                )

        # SELL trigger: Bearish breakdown & currently holding BTC
        elif in_position and score <= -45:
            print(f"[SIGNAL: EXIT] Bearish Score: {score}. Exiting Position.")
            if not self.paper_trading:
                self.exchange.cancel_all_orders(self.symbol)
                self.exchange.create_market_sell_order(self.symbol, self.trade_qty_btc)
        else:
            print("Status: No action criteria met. Holding idle.")

if __name__ == '__main__':
    bot = GitHubActionTradingBot()
    bot.run_check()
