# Waste Disposal Marketplace

On-demand Lagos marketplace connecting residents/businesses with private waste vendors for bulky, excess, or specialized waste outside regular weekly PSP trucks.

- **Customers:** book by waste category + photo, upfront LGA-based price, approve post-arrival adjustments, en-route-only tracking, Paystack/Flutterwave escrow (no cash).
- **Vendors:** onboarding with docs, 60-sec rolling job queue, Adjust Quote on arrival, 30–60s GPS heartbeats, payouts to bank via gateway.
- **Admins:** vendor approvals, live ops map, LGA pricing console, dispute center with route/photo logs.
- **Pilot:** Eti-Osa (Lekki-Ikoyi-VI) + Ikeja only. Tracking strictly during active jobs, stops on Job Completed (NDPA).

## Tech stack

- Monorepo: npm workspaces (`apps/*`, `packages/*`) + `turbo.json`
- `apps/customer`, `apps/vendor`: React Native (bare workflow — required for `react-native-background-geolocation`)
- `apps/admin`: Next.js 14 (App Router) — approvals, pricing, ops map, disputes, privacy page
- `apps/api`: Express + TypeScript, JWT (15m access / 30d refresh), phone OTP (Termii hook, mock in dev), NDPA consent logs, S3 presigned uploads
- `packages/shared`: canonical pricing engine + pilot LGAs/categories
- Data: Postgres 15 + PostGIS + Redis (via `docker-compose.yml` for staging/prod); local dev uses `node:sqlite` (`apps/api/dev.db`) — no Docker needed
- Pricing: `Total = Base Volume Rate × Qty + LGA Flat Surcharge + Special Item Fee`
- CI: `.github/workflows/ci.yml` (typecheck + build + api smoke test)

## How to run it

Prereqs: Node 20+ (tested on 24), PowerShell 5.1+, ports 4000 free. No Docker/Git required for local API.

```powershell
# API-only (fast, recommended for Phase 0-1):
npm install --workspace=@waste/shared --workspace=apps/api
npm run build --workspace=@waste/shared
npm run build --workspace=apps/api
npm run seed --workspace=apps/api
npm run dev --workspace=apps/api   # :4000, blocks — run in its own terminal
# new terminal:
npm run test --workspace=apps/api  # smoke (:4101) + phase1 (:4102)

# Full monorepo (admin + mobile — heavy, Next.js + RN):
npm install
```

Health check: `GET http://127.0.0.1:4000/health` → `{"ok":true,"phase":1}`
Catalog: `GET http://127.0.0.1:4000/api/v1/catalog` → 4 categories / 2 LGAs (DB-backed).
Env: copy `.env.example` to `.env`. For real SMS set `OTP_MODE=termii` + `TERMII_API_KEY`. Never commit real secrets.

## Phase 0 status — DONE + verified

- [x] Monorepo + CI + `docker-compose.yml` + `apps/api/db/schema.sql`
- [x] Auth OTP + JWT + `consent_logs` + `/privacy` v1.0-phase0 + DPO placeholder
- [x] Server-authoritative estimate API, pilot-gated, seed data
- [x] Upload presign (local signed URL now, S3 swap in later phase)
- Verified: `shared build` pass, `api typecheck/build` pass, `seed` pass, `smoke.test` 7/7 pass (health, catalog, estimate 31000, OTP→JWT→/me→consent).

## Phase 1 status — DONE + verified

- [x] Vendor onboarding: `POST /vendor/onboarding` (business + vehicle + all 3 docs required → `pending`) + `GET /vendor/me/profile`
- [x] Admin console: `GET /admin/vendors?status=` + `GET /admin/vendors/:id` + approve/reject (reason required) + block/unblock + `GET /admin/audit`
- [x] Seed-admin-only: self-register as admin blocked; blocked users cannot login
- [x] Pricing console DB-backed: `GET/PUT /admin/pricing`, history, `estimate` + `catalog` read DB
- [x] Active jobs stub: `GET /admin/jobs/active` → `[]` with Phase-3 shape; admin UI pages (`vendors`, `pricing`, `jobs`); vendor `OnboardingScreen`
- Verified: `shared + api typecheck/build` pass, `smoke.test` 7/7 + `phase1.test` 14/14 pass (onboarding validation, pending→approved, pricing +100 flows to estimate 5000→5100, block/unblock, audit).

## Next (Phase 2 — Booking + Escrow payment)

Per implementation plan: estimate + booking creation with photo required, Paystack auth/hold + webhook (idempotent) + Flutterwave interface stub, customer category picker + photo capture + upfront total, cash-blocked enforcement. Exit: paid booking → `held` + `searching_vendor`.
