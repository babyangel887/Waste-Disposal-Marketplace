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

Prereqs: Node >=22.5 (CI uses 24; `node:sqlite` needs 22.5+), PowerShell 5.1+, ports 4000–4106 free. No Docker/Git required for local API.

```powershell
# API-only (fast, recommended):
npm install --workspace=@waste/shared --workspace=apps/api
npm run build --workspace=@waste/shared
npm run build --workspace=apps/api
npm run seed --workspace=apps/api
npm run dev --workspace=apps/api   # :4000, blocks — run in its own terminal
# new terminal:
npm run test --workspace=apps/api  # smoke (:4101) + phase1 (:4102) + phase2 (:4103) + phase3 (:4104) + phase4 (:4105) + phase5 (:4106)

# Full monorepo (admin + mobile — heavy, Next.js + RN):
npm ci
npm run build --workspace=@waste/shared
npm run typecheck --workspaces --if-present
npm run build --workspaces --if-present
npm run seed --workspace=apps/api
npm run test --workspace=apps/api
```

Health check: `GET http://127.0.0.1:4000/health` → `{"ok":true,"phase":5}`
Catalog: `GET http://127.0.0.1:4000/api/v1/catalog` → 4 categories / 2 LGAs (DB-backed).
Env: copy `.env.example` to `.env`. For real SMS set `OTP_MODE=termii` + `TERMII_API_KEY`; DPO via `DPO_CONTACT`. Never commit real secrets.

## Status: Phases 0–5 DONE + verified

- [x] Phase 0 — Foundation: DONE + verified
- [x] Phase 1 — Vendor onboarding + Admin console: DONE + verified
- [x] Phase 2 — Customer booking + payments (mock): DONE + verified
- [x] Phase 3 — Matching + Tracking + Adjustments: DONE + verified
- [x] Phase 4 — Completion, refunds, disputes: DONE + verified
- [x] Phase 5 — Pilot hardening: DONE + verified (see below)

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

## Phase 2 status — DONE + verified

- [x] Bookings: `POST /bookings` (1–5 photos, pilot-gated, qty 1–100, server pricing snapshot NGN), `GET /bookings/:id`, `GET /bookings/mine`, pre-payment cancel only
- [x] Payments mock: `POST /bookings/:id/authorize-payment` (paystack mock hold + flutterwave stub, cash/COD 400-blocked, idempotent), `POST /webhooks/paystack|flutterwave` idempotent
- [x] Customer app: `BookingScreen` (picker + qty estimator + photo key + estimate + book+pay) wired in `App.tsx`
- Verified: `shared + api typecheck/build` pass, `smoke.test` 7/7 + `phase1.test` 14/14 + `phase2.test` 12/12 pass (photo/pilot validation, 6500 snapshot, cash blocked, held + searching_vendor, webhook persists, pre-payment cancel, mine filter).

## Phase 3 status — DONE + verified

- [x] Rolling 60s offer queue: auto-offer on payment, `GET /vendor/jobs/offers` (photo/volume/payout), accept/decline, least-busy-first matching, `POST /admin/matching/expire-due` hook
- [x] Milestones + tracking: `en-route → arrived` (7-min timer) `→ loading`, `POST /tracking/ping` (window-only), `GET /bookings/:id/location` (customer en_route-only), live `GET /admin/jobs/active`
- [x] Adjust-quote: vendor submit → `adjustment_pending`, customer approve (mock re-hold + loading) / reject (back to arrived); capped at 2x original since Phase 5; booking detail includes masked vendor + adjustment + history
- [x] App stubs: vendor `OffersScreen` + `backgroundTracking` heartbeat contract, customer `JobTracking`
- Verified: `shared + api typecheck/build` pass, `smoke.test` 7/7 + `phase1.test` 14/14 + `phase2.test` 12/12 + `phase3.test` 17/17 pass (offer+payout, accept, privacy hidden→visible en_route, ping, arrived+timer, adjust+2000 re-hold, live map).

## Phase 4 status — DONE + verified

- [x] Complete: `POST /vendor/jobs/:id/complete` (arrived|loading) → mock split transfer + receipt, idempotent
- [x] Cancel rules: 7.1 no-show/late → full refund + delay evidence; 7.2 change-mind (5-min grace), absent via `POST /vendor/jobs/:id/no-show` (7min+3calls), adjustment-reject → ₦3,000 fuel fee + vendor payout
- [x] Disputes + earnings: raise/mine/admin-list, `GET /admin/jobs/:id/timeline`, `POST /admin/disputes/:id/resolve` (refund_vendor|refund_customer|split), `GET /vendor/earnings`
- Verified: all 7.1/7.2 scenarios pass with mocked gateway.

## Phase 5 status — DONE + verified

- [x] NDPA: `GET /privacy` (version + DPO + retention), `GET /me/export`, `DELETE /me` (PII scrub), `POST /admin/retention/purge` (pings older than 90 days)
- [x] Fraud guardrails: adjust-quote capped at 2x original, no-show flags max 3/vendor/day, OTP max 5/phone/hour
- [x] Pilot + ops: `POST /waitlist` (outside-pilot LGAs) + admin list, `GET /admin/ops` (counts + mocked-gateway reconciliation + heartbeat 30/60s), admin `/ops` page, `docs/pilot-release-checklist.md`
- Verified: `shared + api typecheck/build` pass, all 6 suites ALL PASS from clean DB on Node 24 (smoke + phase1–5).

## Release checklist

See `docs/pilot-release-checklist.md` — backend, mobile (bare workflow), admin dashboard live, and compliance gates for TestFlight / Play Internal.
