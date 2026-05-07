const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const REPORTS = [
  { slug: "amd", symbol: "AMD", timeZone: "America/New_York" },
  { slug: "shaz", symbol: "SHAZ", timeZone: "America/New_York" },
  { slug: "meta", symbol: "META", timeZone: "America/New_York" },
  { slug: "goog", symbol: "GOOG", timeZone: "America/New_York" },
  { slug: "tsla", symbol: "TSLA", timeZone: "America/New_York" },
  { slug: "rddt", symbol: "RDDT", timeZone: "America/New_York" },
  { slug: "ntnx", symbol: "NTNX", timeZone: "America/New_York" },
  { slug: "0992-hk", symbol: "0992.HK", timeZone: "Asia/Hong_Kong" }
];

function currencyPrefix(currency) {
  if (currency === "HKD") return "HK$";
  if (currency === "USD") return "$";
  return currency ? `${currency} ` : "";
}

function formatMoney(value, currency, decimals = 2) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return `${currencyPrefix(currency)}${value.toFixed(decimals)}`;
}

function formatMarketCap(value, currency) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  const prefix = currencyPrefix(currency);
  if (Math.abs(value) >= 1e12) return `${prefix}${(value / 1e12).toFixed(2)}T`;
  if (Math.abs(value) >= 1e9) return `${prefix}${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${prefix}${(value / 1e6).toFixed(2)}M`;
  return `${prefix}${value.toFixed(0)}`;
}

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatRatio(value) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return "Not available";
  return `${value.toFixed(value >= 100 ? 1 : 2)}x`;
}

function formatTimestamp(epochSeconds, timeZone) {
  if (!epochSeconds) return null;
  const date = new Date(epochSeconds * 1000);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function replaceSnapshot(html, timestamp) {
  if (!timestamp) return html;
  return html.replace(
    /(<div class="snapshot">[\s\S]*?<strong>)[^<]*(<\/strong>)/,
    `$1${timestamp}$2`
  );
}

function replaceMetricBlock(html, label, value, className = "") {
  if (!value) return html;
  const classAttr = className ? `metric-value ${className}` : "metric-value";
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = `<div><div class="metric-label">${label}</div><div class="${classAttr}">${value}</div></div>`;
  const regex = new RegExp(
    `<div><div class="metric-label">${escapedLabel}<\\/div><div class="metric-value[^"]*">[^<]*<\\/div><\\/div>`
  );
  return html.replace(regex, block);
}

function replaceKpiValue(html, label, value) {
  if (!value) return html;
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `(<div class="kpi fade"><div class="metric-label">${escapedLabel}<\\/div><div class="metric-value[^"]*">)[^<]*(<\\/div>)`
  );
  return html.replace(regex, `$1${value}$2`);
}

function replaceSourceNote(html) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (html.includes("Live quote fields refreshed by GitHub Actions")) return html;
  return html.replace(
    /(Data points reflect publicly available sources used during report build and may differ from live market feeds\.)/,
    `$1 Live quote fields refreshed by GitHub Actions using Yahoo Finance public quote data on ${stamp}.`
  );
}

function updateHtml(html, quote, report) {
  const currency = quote.currency || quote.meta?.currency || "USD";
  const price = formatMoney(quote.regularMarketPrice, currency, currency === "HKD" ? 2 : 2);
  const change = formatPercent(quote.regularMarketChangePercent);
  const timestamp = formatTimestamp(quote.regularMarketTime, report.timeZone);
  const marketCap = formatMarketCap(quote.marketCap, currency);
  const pe = formatRatio(quote.trailingPE);
  const eps = formatMoney(quote.epsTrailingTwelveMonths, currency, 2);
  const dividendYield = typeof quote.trailingAnnualDividendYield === "number"
    ? formatPercent(quote.trailingAnnualDividendYield * 100)
    : null;

  let out = html;
  out = replaceSnapshot(out, timestamp);
  out = replaceMetricBlock(out, "Current price", price);
  out = replaceMetricBlock(out, "Daily change", change, quote.regularMarketChangePercent >= 0 ? "positive" : "negative");
  out = replaceMetricBlock(out, "Currency", currency);
  out = replaceMetricBlock(out, "Last updated", timestamp);
  out = replaceMetricBlock(out, "Updated", timestamp);
  out = replaceKpiValue(out, "Market Cap", marketCap);
  out = replaceKpiValue(out, "P/E Ratio", pe);
  out = replaceKpiValue(out, "EPS", eps);
  out = replaceKpiValue(out, "Dividend Yield", dividendYield);
  out = replaceSourceNote(out);
  return out;
}

async function fetchChartQuote(report) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(report.symbol)}?range=5d&interval=1d`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 stock-risk-report-updater" }
  });
  if (!response.ok) throw new Error(`Yahoo chart request failed for ${report.symbol}: ${response.status}`);
  const data = await response.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data returned for ${report.symbol}`);

  const meta = result.meta || {};
  const closes = (result.indicators?.quote?.[0]?.close || []).filter((value) => typeof value === "number");
  const latest = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : closes.at(-1);
  const previous = typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : closes.at(-2);
  const changePercent = latest && previous ? ((latest - previous) / previous) * 100 : null;

  return {
    symbol: report.symbol,
    currency: meta.currency,
    regularMarketPrice: latest,
    regularMarketChangePercent: changePercent,
    regularMarketTime: meta.regularMarketTime,
    marketCap: null,
    trailingPE: null,
    epsTrailingTwelveMonths: null,
    trailingAnnualDividendYield: null
  };
}

async function main() {
  let updated = 0;

  for (const report of REPORTS) {
    let quote;
    try {
      quote = await fetchChartQuote(report);
    } catch (error) {
      console.warn(error.message);
      continue;
    }

    const filePath = path.join(ROOT, report.slug, "index.html");
    if (!fs.existsSync(filePath)) {
      console.warn(`Missing report file: ${filePath}`);
      continue;
    }

    const before = fs.readFileSync(filePath, "utf8");
    const after = updateHtml(before, quote, report);
    if (after !== before) {
      fs.writeFileSync(filePath, after, "utf8");
      updated += 1;
      console.log(`Updated ${report.symbol}`);
    } else {
      console.log(`No changes for ${report.symbol}`);
    }
  }

  console.log(`Completed quote refresh. Files changed: ${updated}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
