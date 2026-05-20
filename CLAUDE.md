# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Development server (localhost:3000)
npm test           # Jest tests via react-scripts
vercel --prod      # Deploy to production (do NOT use npm run build — fails due to pg module)
```

`CI=false npm run build` is used only by Vercel's build infrastructure internally (set in `vercel.json`).

## Architecture

Single-page React app with Vercel serverless API functions connecting to AWS Redshift. Auth is backed by Upstash Redis; transactional emails use Resend.

```
src/App.js          — entire frontend: auth flow, tab navigation, all components, all charts
src/App.css         — all styles (CSS variables for design tokens, DM Sans font)
api/*.js            — serverless functions (Node.js, deployed as Vercel functions)
vercel.json         — routing: /api/* → functions, /* → index.html SPA fallback
```

**Frontend** (`src/App.js`) is a single large file. Navigation is tab-based (no react-router). Tabs available to a user are controlled by the `pestanas` array stored in their Redis session. Charts use Recharts; dates use date-fns; HTTP calls use axios.

**API Layer** (`api/`) — each file is an independent serverless function:

| File | Purpose |
|---|---|
| `auth-login.js` | POST: validates credentials, returns 7-day session token in Redis |
| `auth-register.js` | Self-registration with pending-approval workflow |
| `auth-session.js` | GET: validates Bearer token, returns user data |
| `auth-reset.js` | Password reset |
| `auth-users.js` | Admin user management (approve/reject/suspend) |
| `auth-setup.js` | Initial admin bootstrapping |
| `recurrencia.js` | Core MRR data: joins invoices + opportunities + students from Redshift |
| `salud.js` | Retention, ticket promedio, churn flow; uses LEAD() window function |
| `salud-cohortes.js` | Cohort retention over time by acquisition month |
| `cancelaciones.js` | Zuora subscription cancellations with classification |
| `churn.js` | 5 parallel queries: new customers, cancellations, churn rate, payment failures, LTV |
| `churn-vida.js` | Time-to-cancellation analysis |
| `marketing.js` | CAC = marketing spend ÷ new paying customers |

All API functions: return CORS headers (`Access-Control-Allow-Origin: *`), set `s-maxage=14400 stale-while-revalidate=3600` cache headers, connect to Redshift with 10–60s timeouts, use parameterized queries.

## Environment Variables

```
REDSHIFT_HOST / REDSHIFT_PORT / REDSHIFT_DATABASE / REDSHIFT_USER / REDSHIFT_PASSWORD
UPSTASH_REDIS_KV_REST_API_URL / UPSTASH_REDIS_KV_REST_API_TOKEN
```

Redis key schema: `user:{email}`, `session:{token}`, `users:all`.

## Auth & Roles

- Admin: `jpalacios@smartbeemo.com` — can manage users and unlock tabs
- User states: `aprobado` | `pendiente` | `rechazado` | `suspendido`
- Tabs: `Recurrencia` | `Upgrades` | `Salud` | `Cancelaciones` | `Churn` | `Usuarios` (admin only)

## Key Business Concepts

- **MRR** — Monthly Recurring Revenue, broken down by country (México, Colombia, Estados Unidos, Otros) and payment type (Bootcamp, Suscripción, Mentoría, Upgrades)
- **Retención / Churn** — % of customers who pay the following month; churn tracked with LEAD() across invoice history
- **Cohortes** — cohort retention grid: customers grouped by acquisition month vs. months retained
- **CAC** — Customer Acquisition Cost from real marketing spend vs. actual paid invoices
- **Semáforo** — traffic-light status indicator used across health metrics

## Database Tables (Redshift)

- `salesforce.tabla_core_invoices_facturas` — payment transactions
- `salesforce.tabla_core_oportunidades` — sales opportunities/contracts
- `salesforce.tabla_core_estudiantes` — students/customers
- `salesforce.tabla_intermedia_marketing` — marketing spend
- `salesforce.tabla_intermedia_casos_cobranza` — collection cases
- `salesforce-database.subscriptions` — Zuora subscription lifecycle (status, start_date, cancelled_date)

## Pending Work

- MRR waterfall decomposition: nuevo + expandido − contraído − perdido
- MRR 3-month projection
