# Live Dashboard Setup

This project now includes a live ticker-input dashboard at:

```text
live/index.html
```

The live dashboard does not call the market data API directly from browser code. That would expose the API key and may hit CORS restrictions on GitHub Pages.

Instead it uses a Netlify Function proxy:

```text
netlify/functions/stock.js
```

## API Provider

Provider: Financial Modeling Prep

Environment variable required on Netlify:

```text
FMP_API_KEY
```

Do not put the API key inside any HTML or browser JavaScript file.

## Deploy Safely

1. Push/upload the repo to GitHub.
2. Create a Netlify site from the GitHub repo.
3. In Netlify, add this environment variable:

```text
FMP_API_KEY=your_financial_modeling_prep_key
```

4. Redeploy the Netlify site.
5. Test the function directly:

```text
https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/stock?ticker=AMD
```

6. Open the live dashboard:

```text
https://YOUR-NETLIFY-SITE.netlify.app/live/
```

## GitHub Pages Option

GitHub Pages cannot run Netlify Functions.

If you keep the front end on GitHub Pages, deploy only the function to Netlify and set the browser API base in `live/index.html`:

```js
window.LIVE_API_BASE = "https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions";
```

## What Updates Live

The live dashboard updates when a ticker is entered:

- Current price
- Daily change
- Currency
- Timestamp
- Market cap, P/E, EPS, dividend yield where available from the API
- KPI cards
- 12-month Chart.js price chart
- Quarterly table
- Risk score
- Gauge needle
- Error messages

## Troubleshooting

If the dashboard shows an error:

- Confirm `FMP_API_KEY` exists in Netlify environment variables.
- Confirm the function test URL returns JSON.
- Open browser DevTools Console for JavaScript errors.
- Open Network tab and check the `/stock?ticker=...` request.
- If the browser blocks the request, verify the function returns CORS headers.
- If the API returns a provider error, test a common ticker such as `AMD`.
