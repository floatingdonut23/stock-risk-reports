// Netlify Function: secure live market data proxy.
// Provider: Financial Modeling Prep (FMP).
// Place your API key in Netlify, not in browser code:
//   Site configuration -> Environment variables -> Add FMP_API_KEY
// Required scope: Functions.
// Test after deployment:
//   https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/stock?ticker=AMD

// FMP changed new/free accounts from legacy `/api/v3/...` endpoints to `/stable/...`.
// If you see "Legacy Endpoint" errors, this file must use the stable base URL below.
const FMP_BASE = "https://financialmodelingprep.com/stable";

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
  const rows = Array.isArray(payload) ? payload : payload?.historical || [];
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
    grossProfit: toNumber(row.grossProfit),
    operatingIncome: toNumber(row.operatingIncome),
    grossProfitRatio: toNumber(row.grossProfitRatio) ?? ratio(toNumber(row.grossProfit), toNumber(row.revenue)),
    operatingIncomeRatio: toNumber(row.operatingIncomeRatio) ?? ratio(toNumber(row.operatingIncome), toNumber(row.revenue)),
    netIncome: toNumber(row.netIncome)
  }));
}

function sumNumbers(rows, key) {
  const values = rows.map((row) => row[key]).filter((value) => typeof value === "number");
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0);
}

function averageNumbers(rows, key) {
  const values = rows.map((row) => row[key]).filter((value) => typeof value === "number");
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function ratio(numerator, denominator) {
  if (typeof numerator !== "number" || typeof denominator !== "number" || denominator === 0) return null;
  return numerator / denominator;
}

function growthPercent(newValue, oldValue) {
  if (typeof newValue !== "number" || typeof oldValue !== "number" || oldValue === 0) return null;
  return ((newValue - oldValue) / Math.abs(oldValue)) * 100;
}

async function optionalFmp(path, apiKey, fallback) {
  try {
    return await fmp(path, apiKey);
  } catch (error) {
    console.warn(`Optional FMP request failed for ${path}: ${error.message}`);
    return fallback;
  }
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
    const [quoteRaw, profileRaw, ratiosRaw, metricsRaw, incomeRaw, historyRaw, balanceRaw] = await Promise.all([
      fmp(`/quote?symbol=${encodeURIComponent(ticker)}`, apiKey),
      optionalFmp(`/profile?symbol=${encodeURIComponent(ticker)}`, apiKey, []),
      optionalFmp(`/ratios-ttm?symbol=${encodeURIComponent(ticker)}`, apiKey, []),
      optionalFmp(`/key-metrics-ttm?symbol=${encodeURIComponent(ticker)}`, apiKey, []),
      optionalFmp(`/income-statement?symbol=${encodeURIComponent(ticker)}&period=quarter&limit=4`, apiKey, []),
      fmp(`/historical-price-eod/full?symbol=${encodeURIComponent(ticker)}`, apiKey),
      optionalFmp(`/balance-sheet-statement?symbol=${encodeURIComponent(ticker)}&period=quarter&limit=1`, apiKey, [])
    ]);

    const quote = first(quoteRaw) || {};
    const profile = first(profileRaw) || {};
    const ratios = first(ratiosRaw) || {};
    const metrics = first(metricsRaw) || {};
    const history = normalizeHistory(historyRaw);
    const quarters = normalizeQuarters(incomeRaw);
    const balance = first(balanceRaw) || {};
    const ttmRevenue = sumNumbers(quarters, "revenue");
    const ttmNetIncome = sumNumbers(quarters, "netIncome");
    const ttmEps = sumNumbers(quarters, "eps");
    const ttmGrossProfit = sumNumbers(quarters, "grossProfit");
    const ttmOperatingIncome = sumNumbers(quarters, "operatingIncome");
    const averageGrossMargin = averageNumbers(quarters, "grossProfitRatio");
    const averageOperatingMargin = averageNumbers(quarters, "operatingIncomeRatio");
    const latestPrice = toNumber(quote.price);
    const previousClose = history.length > 1 ? history[history.length - 2].close : null;
    const dailyPercent = toNumber(quote.changesPercentage) ?? (
      ratio(toNumber(quote.change), previousClose) === null ? null : ratio(toNumber(quote.change), previousClose) * 100
    );
    const calculatedPe = latestPrice && ttmEps && ttmEps > 0 ? latestPrice / ttmEps : null;
    const epsGrowth = quarters.length >= 2 ? growthPercent(quarters[0].eps, quarters[quarters.length - 1].eps) : null;
    const calculatedPeg = calculatedPe && epsGrowth && epsGrowth > 0 ? calculatedPe / epsGrowth : null;
    const calculatedRoe = ratio(ttmNetIncome, toNumber(balance.totalStockholdersEquity));
    const calculatedDebtEquity = ratio(toNumber(balance.totalDebt), toNumber(balance.totalStockholdersEquity));
    const calculatedGrossMargin = ratio(ttmGrossProfit, ttmRevenue) ?? averageGrossMargin;
    const calculatedOperatingMargin = ratio(ttmOperatingIncome, ttmRevenue) ?? averageOperatingMargin;

    return response(200, {
      provider: "Financial Modeling Prep",
      symbol: quote.symbol || ticker,
      companyName: quote.name || profile.companyName || ticker,
      exchange: quote.exchange || profile.exchangeShortName || "Not available",
      currency: profile.currency || quote.currency || "USD",
      timestamp: new Date().toISOString(),
      quote: {
        price: latestPrice,
        change: toNumber(quote.change),
        changesPercentage: dailyPercent,
        dayLow: toNumber(quote.dayLow),
        dayHigh: toNumber(quote.dayHigh),
        yearLow: toNumber(quote.yearLow),
        yearHigh: toNumber(quote.yearHigh),
        marketCap: toNumber(quote.marketCap),
        pe: toNumber(quote.pe) ?? calculatedPe,
        eps: toNumber(quote.eps) ?? ttmEps,
        sharesOutstanding: toNumber(quote.sharesOutstanding),
        volume: toNumber(quote.volume)
      },
      profile: {
        sector: profile.sector || "Not available",
        industry: profile.industry || "Not available",
        beta: toNumber(profile.beta),
        dividendYield: toNumber(profile.lastDiv) && latestPrice ? (toNumber(profile.lastDiv) / latestPrice) * 100 : 0,
        website: profile.website || null
      },
      ratios: {
        priceToSalesRatioTTM: toNumber(ratios.priceToSalesRatioTTM) ?? ratio(toNumber(quote.marketCap), ttmRevenue),
        pegRatioTTM: toNumber(ratios.pegRatioTTM) ?? calculatedPeg,
        grossProfitMarginTTM: calculatedGrossMargin,
        operatingProfitMarginTTM: toNumber(ratios.operatingProfitMarginTTM) ?? calculatedOperatingMargin,
        netProfitMarginTTM: ratio(ttmNetIncome, ttmRevenue),
        returnOnEquityTTM: toNumber(ratios.returnOnEquityTTM) ?? calculatedRoe,
        debtEquityRatioTTM: toNumber(ratios.debtEquityRatioTTM) ?? calculatedDebtEquity
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
