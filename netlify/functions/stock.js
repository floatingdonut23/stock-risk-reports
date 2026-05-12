// Netlify Function: secure live market data proxy.
// Provider: Financial Modeling Prep (FMP).
// Place your API key in Netlify, not in browser code:
//   Site configuration -> Environment variables -> Add FMP_API_KEY
// Required scope: Functions.
// Test after deployment:
//   https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/stock?ticker=AMD

const FMP_BASE = "https://financialmodelingprep.com/api/v3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body)
  };
}

function cleanTicker(rawTicker = "") {
  return rawTicker.trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, "");
}

async function fmp(path, apiKey) {
  const joiner = path.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${path}${joiner}apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FMP ${path} failed with ${res.status}: ${text.slice(0, 180)}`);
  }
  return res.json();
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeHistory(payload) {
  const rows = payload?.historical || [];
  return rows
    .slice(0, 252)
    .reverse()
    .map((row) => ({
      date: row.date,
      close: toNumber(row.close),
      volume: toNumber(row.volume)
    }))
    .filter((row) => row.date && row.close !== null);
}

function normalizeQuarters(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.slice(0, 4).map((row) => ({
    period: row.period || row.date || "Not available",
    date: row.date || "Not available",
    revenue: toNumber(row.revenue),
    eps: toNumber(row.eps),
    grossProfitRatio: toNumber(row.grossProfitRatio),
    operatingIncomeRatio: toNumber(row.operatingIncomeRatio),
    netIncome: toNumber(row.netIncome)
  }));
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return response(204, {});

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return response(500, {
      error: "Missing FMP_API_KEY on the serverless function.",
      fix: "Add FMP_API_KEY in Netlify environment variables with Functions scope, then redeploy."
    });
  }

  const ticker = cleanTicker(event.queryStringParameters?.ticker || "AMD");
  if (!ticker) {
    return response(400, { error: "Ticker is required." });
  }

  try {
    const [quoteRaw, profileRaw, ratiosRaw, metricsRaw, incomeRaw, historyRaw] = await Promise.all([
      fmp(`/quote/${ticker}`, apiKey),
      fmp(`/profile/${ticker}`, apiKey),
      fmp(`/ratios-ttm/${ticker}`, apiKey),
      fmp(`/key-metrics-ttm/${ticker}`, apiKey),
      fmp(`/income-statement/${ticker}?period=quarter&limit=4`, apiKey),
      fmp(`/historical-price-full/${ticker}?timeseries=365`, apiKey)
    ]);

    const quote = first(quoteRaw) || {};
    const profile = first(profileRaw) || {};
    const ratios = first(ratiosRaw) || {};
    const metrics = first(metricsRaw) || {};
    const history = normalizeHistory(historyRaw);
    const quarters = normalizeQuarters(incomeRaw);

    return response(200, {
      provider: "Financial Modeling Prep",
      symbol: quote.symbol || ticker,
      companyName: quote.name || profile.companyName || ticker,
      exchange: quote.exchange || profile.exchangeShortName || "Not available",
      currency: profile.currency || quote.currency || "USD",
      timestamp: new Date().toISOString(),
      quote: {
        price: toNumber(quote.price),
        change: toNumber(quote.change),
        changesPercentage: toNumber(quote.changesPercentage),
        dayLow: toNumber(quote.dayLow),
        dayHigh: toNumber(quote.dayHigh),
        yearLow: toNumber(quote.yearLow),
        yearHigh: toNumber(quote.yearHigh),
        marketCap: toNumber(quote.marketCap),
        pe: toNumber(quote.pe),
        eps: toNumber(quote.eps),
        sharesOutstanding: toNumber(quote.sharesOutstanding),
        volume: toNumber(quote.volume)
      },
      profile: {
        sector: profile.sector || "Not available",
        industry: profile.industry || "Not available",
        beta: toNumber(profile.beta),
        dividendYield: toNumber(profile.lastDiv) && toNumber(quote.price)
          ? (toNumber(profile.lastDiv) / toNumber(quote.price)) * 100
          : null,
        website: profile.website || null
      },
      ratios: {
        priceToSalesRatioTTM: toNumber(ratios.priceToSalesRatioTTM),
        pegRatioTTM: toNumber(ratios.pegRatioTTM),
        operatingProfitMarginTTM: toNumber(ratios.operatingProfitMarginTTM),
        returnOnEquityTTM: toNumber(ratios.returnOnEquityTTM),
        debtEquityRatioTTM: toNumber(ratios.debtEquityRatioTTM)
      },
      metrics: {
        revenuePerShareTTM: toNumber(metrics.revenuePerShareTTM),
        freeCashFlowPerShareTTM: toNumber(metrics.freeCashFlowPerShareTTM),
        freeCashFlowYieldTTM: toNumber(metrics.freeCashFlowYieldTTM)
      },
      quarters,
      history
    });
  } catch (error) {
    console.error(error);
    return response(502, {
      error: "Live data request failed.",
      detail: error.message,
      ticker
    });
  }
};
