# Meridian

A modern banking dashboard for growing businesses, built as a technical case study.

**Live demo: https://banking-dashboard-beta-two.vercel.app** (click **Explore the demo**; no sign-up needed)

> **Simulation only.** All data is fictional, no real money moves, and there is no banking partner behind it.

## What you can do

- **Overview:** total cash, account balances, runway, and charts of balance and cash flow.
- **Transactions:** search, ten filters, shareable filtered links, a details panel with ledger entries, memos and CSV export.
- **Payments:** move money between accounts or pay recipients, with review, a one-time code at $10,000 and above, receipts and scheduled payments.
- **Cards:** freeze a card, set monthly limits, and simulate purchases against the real rules.
- **Insights:** spending by category, merchant and month, reconciled to the cent with the overview.

Each demo visitor gets their own private workspace with twelve months of generated activity.

## Technologies

| Area | Choice |
|---|---|
| App | Next.js 16 (App Router, Server Components, Server Actions), React 19, TypeScript in strict mode |
| Interface | Tailwind CSS 4, Radix UI primitives, Recharts |
| Data | PostgreSQL on Neon, Drizzle ORM, Zod |
| Quality | Vitest, Playwright, axe, GitHub Actions |
| Hosting | Vercel |

## How it works

**Money.** Amounts are integer cents. Every movement is a balanced double-entry transaction, and balances are calculated from the ledger, never stored. Database triggers reject unbalanced transactions and any edit to ledger or audit history, whichever code path attempts it.

**Payments.** All money moves through one function in `src/server/ledger/ledger.ts`. It runs in a single database transaction, locks accounts in a fixed order so concurrent payments can't spend the same balance, and uses idempotency keys so a retry or double-click can't send twice.

**Workspaces.** Every query is scoped to the organization from the verified session, never from the client. Composite foreign keys stop a ledger line from touching another organization's records.

## Security

- Server-side sessions: only a hash of the token is stored, in an HttpOnly, Secure, `__Host-` cookie, with idle and absolute expiry.
- Passwords hashed with scrypt, with rate limits that an attacker can't use to lock out someone else.
- One-time payment codes that are hashed, single-use, attempt-limited and bound to the exact payment.
- Nonce-based Content Security Policy and security headers on every page.
- Input from URLs, forms and server actions is validated on the server.
- CSV export neutralizes spreadsheet formulas. Audit log of sensitive actions. Query values are kept out of logs.
- Only the last four digits of account and card numbers are stored.

**Demo storage.** Each workspace takes about 0.6 MB, so sign-ins remove expired workspaces and the oldest beyond a total of 200. That keeps storage bounded without ever turning a visitor away.

## What production would still need

This is a demonstration, so these are deliberately left out:

- A banking partner, KYC and compliance work such as SOC 2 and PCI DSS. No certification is claimed.
- Delivering codes by SMS or an authenticator. The demo shows the code on screen, and says so.
- Multi-person approvals and roles. A demo workspace has one user, so self-approval would prove nothing.
- Daily payment limits. Payments are checked one at a time, so several just under $10,000 need no code.
- A job queue for scheduled payments, which here run when a workspace is opened, and for cleaning up demos.
- A restricted database role. The app's role owns its tables, so it could technically disable the ledger triggers.
- A bot check on demo sign-in, and error monitoring.
- `/api/health` is public and queries the database, which suits a demo. Production would restrict it.

## Run locally

Requires Node 24 (`nvm use`) and PostgreSQL.

```bash
npm install
cp .env.example .env.local   # set DATABASE_URL
createdb banking_dashboard
npm run db:migrate
npm run dev
```

## Tests

```bash
createdb banking_dashboard_test   # once; this database is wiped on every run
npm run check                     # lint, types, unit tests
npm run test:db                   # ledger, payment and access rules on real Postgres
npm run build && npm run test:e2e # browser tests on the production build
```

CI runs all of these on every push.
