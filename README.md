# SEC EDGAR Financial Dashboard

A single-page financial dashboard that pulls Revenue, Operating Income, and EBITDA directly from SEC EDGAR XBRL filings for any US-listed company.

Displays last 8 quarters and last 3 fiscal years with calculated Y/Y growth and margins.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:5173` — enter any US ticker (AAPL, MSFT, GOOG, etc.)

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Follow the prompts. Your app will be live at a public URL.

## Architecture

- **Frontend**: React + Vite (static SPA)
- **Backend**: Two Vercel serverless functions that proxy SEC EDGAR API requests with proper `User-Agent` headers
  - `/api/tickers` → SEC company tickers index
  - `/api/facts/[cik]` → XBRL company facts

## Data Source

All financial data is sourced from [SEC EDGAR XBRL API](https://www.sec.gov/edgar/sec-api-documentation). EBITDA is calculated as Operating Income + D&A.
