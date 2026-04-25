// netlify/functions/quotes.js
// Consulta Yahoo Finance en paralelo para todos los tickers solicitados.
// Endpoint público v8/finance/chart — no requiere API key.

const SYMBOLS = [
  'YPF', 'PAM', 'TGS', 'GGAL', 'BMA', 'BBAR',
  'SPY', 'QQQ', 'DIA', 'GLD', 'SLV', 'USO',
  'AMZN', 'WMT', 'GOOG', 'TSLA', 'META', 'AAPL',
  'INTC', 'TSM', 'EWZ', 'EWY', 'EWJ', 'IBIT',
  'AGRO', 'MELI', 'VIST'
];

async function getQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  const res = await fetch(url, {
    headers: {
      // Yahoo es exigente: usamos un UA de navegador real para evitar 401/429.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json,text/plain,*/*',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${symbol}`);
  }

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}`);

  const meta = result.meta || {};
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose ?? meta.previousClose;

  if (price == null || prev == null) {
    throw new Error(`Incomplete data for ${symbol}`);
  }

  const change = price - prev;
  const changePct = (change / prev) * 100;

  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    price: Number(price.toFixed(4)),
    change: Number(change.toFixed(4)),
    changePct: Number(changePct.toFixed(3)),
    currency: meta.currency || 'USD'
  };
}

exports.handler = async () => {
  const settled = await Promise.allSettled(SYMBOLS.map(getQuote));

  const quotes = settled
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  const failed = settled
    .map((r, i) => r.status === 'rejected' ? SYMBOLS[i] : null)
    .filter(Boolean);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=120',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      quotes,
      failed,
      updated: Date.now()
    })
  };
};
