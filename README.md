# Waste Disposal Marketplace — Phase 0 Foundation

## What was built (Phase 0)
- Monorepo: `apps/api` (Nest-style Express + node:sqlite local, Postgres schema for staging), `apps/admin` (Next.js), `apps/customer` + `apps/vendor` (RN bare skeletons), `packages/shared` (pricing + pilot LGAs).
- Auth: phone OTP (mock now, Termii hook ready), JWT access+refresh, NDPA consent log, privacy policy page.
- Pricing: server-authoritative `Total = Base*Qty + LGA surcharge + Special fee`, pilot-gated to Eti-Osa/Ikeja.
- Uploads: presign endpoint (local signed URL now, S3 swap in Phase 1).
- Infra: `docker-compose.yml` (Postgres+PostGIS+Redis), `db/schema.sql`, CI workflow.

## Run locally (no Docker needed)
```powershell
npm install
npm run build --workspace=@waste/shared
npm run seed --workspace=apps/api
npm run dev --workspace=apps/api   # :4000
npm run test --workspace=apps/api  # smoke test :4101
```

## Env
Copy `.env.example` to `.env`. For real SMS set `OTP_MODE=termii` + `TERMII_API_KEY`.

## Next (Phase 1)
Vendor onboarding docs + admin approve/reject + pricing console + active jobs map.
