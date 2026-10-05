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
# API-only (fast, recommended for Phase 0):
npm install --workspace=@waste/shared --workspace=apps/api
npm run build --workspace=@waste/shared
npm run build --workspace=apps/api
npm run seed --workspace=apps/api
npm run dev --workspace=apps/api   # :4000, blocks — run in its own terminal
# new terminal:
npm run test --workspace=apps/api  # smoke test on :4101

# Full monorepo (admin + mobile — heavy, Next.js + RN):
npm install
```

Health check: `GET http://127.0.0.1:4000/health` → `{"ok":true,"phase":0}`
Catalog: `GET http://127.0.0.1:4000/api/v1/catalog` → 4 categories / 2 LGAs.
Env: copy `.env.example` to `.env`. For real SMS set `OTP_MODE=termii` + `TERMII_API_KEY`.

## Phase 0 status — DONE + verified

- [x] Monorepo + CI + `docker-compose.yml` + `apps/api/db/schema.sql`
- [x] Auth OTP + JWT + `consent_logs` + `/privacy` v1.0-phase0 + DPO placeholder
- [x] Server-authoritative estimate API, pilot-gated, seed data
- [x] Upload presign (local signed URL now, S3 swap in Phase 1)
- Verified: `shared build` pass, `api typecheck/build` pass, `seed` pass, `smoke.test` 7/7 pass (health, catalog, estimate 31000, OTP→JWT→/me→consent).

## Next (Phase 1)
Vendor onboarding docs + admin approve/reject + pricing console + active jobs map.
