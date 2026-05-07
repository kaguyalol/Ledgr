# Ledgr — Asset Manager

A **100% local** personal finance app. Upload bank statements (PDF, CSV, TXT) and get instant analysis with interactive charts and a full transaction ledger. **No data ever leaves your machine.**

**Live:** [https://kaguyalol.github.io/Ledgr/](https://kaguyalol.github.io/Ledgr/)

## Quick Start

```bash
git clone https://github.com/kaguyalol/Ledgr.git
cd Ledgr
npm install
npm run dev
```

Opens at **http://localhost:3000**

## Tech Stack

- **React 18** + **TypeScript**
- **Vite** for dev/build
- **Recharts** for charts
- **pdf.js** for local PDF text extraction
- **localStorage** for persistence
- **GitHub Pages** for hosting (via GitHub Actions)

## Features

| Tab | What it does |
|-----|-------------|
| **Statements** | Upload PDF/CSV/TXT bank statements. View extracted raw text. |
| **Ledger** | Full transaction table with search, filter by category/account, sortable columns, pagination. |
| **Analysis** | Interactive pie chart (click to drill down), category breakdown, monthly income vs expenses bar chart. |
| **Overview** | Aggregate metrics, per-account summary, auto-generated insights. |

## Privacy

Zero network calls. All data stays in your browser's `localStorage`. GitHub Pages only serves the static app code — it never sees your financial data.
