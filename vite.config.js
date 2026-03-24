import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/tickers': {
        target: 'https://www.sec.gov',
        changeOrigin: true,
        rewrite: () => '/files/company_tickers.json',
        headers: {
          'User-Agent': 'SEC-Dashboard contact@example.com',
          'Accept-Encoding': 'gzip, deflate',
        },
      },
      '/api/facts': {
        target: 'https://data.sec.gov',
        changeOrigin: true,
        rewrite: (path) => {
          const cik = path.split('/api/facts/')[1];
          return `/api/xbrl/companyfacts/CIK${cik}.json`;
        },
        headers: {
          'User-Agent': 'SEC-Dashboard contact@example.com',
          'Accept-Encoding': 'gzip, deflate',
        },
      },
    },
  },
})
