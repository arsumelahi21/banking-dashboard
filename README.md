# Meridian

A modern banking dashboard for growing businesses, built as a technical case study.

> **Simulation only.** All data is fictional and no real money moves.

## Run locally

Requires Node 24 (`nvm use`) and PostgreSQL.

```bash
npm install
cp .env.example .env.local   # set DATABASE_URL
createdb banking_dashboard
npm run db:migrate
npm run dev
```

## Verify

```bash
createdb banking_dashboard_test   # once
npm run check                     # lint, types, unit tests
npm run test:db                   # ledger and auth guarantees on real Postgres
npm run build && npm run test:e2e # browser tests on the production build
```
