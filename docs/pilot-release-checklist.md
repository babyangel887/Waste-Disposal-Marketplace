# Pilot release checklist (Eti-Osa + Ikeja)

Exit bar for TestFlight (iOS) / Play Internal (Android) + admin dashboard live for ops.

## 1. Backend
- [ ] `npm run build --workspace=@waste/shared` passes
- [ ] `npm run typecheck --workspaces` passes (all 5 workspaces)
- [ ] `npm run test --workspace=apps/api` passes from clean DB (smoke + phase1–5)
- [ ] `GET /admin/ops` reconciliation `ok: true` (no held-on-inactive, every split has a payout)
- [ ] `POST /admin/retention/purge` run (pings older than 90 days deleted)
- [ ] Real `PAYSTACK_SECRET` / `TERMII_API_KEY` set in staging env (never in files)
- [ ] `DPO_CONTACT` set to the real Data Protection Officer address

## 2. Mobile (bare workflow)
- [ ] `react-native-background-geolocation` license key in place (Transistorsoft)
- [ ] Heartbeat verified on low-end Android: 30s moving / 60s idle, screen locked
- [ ] Battery + data spot-check on a Tecno/Infinix-class device
- [ ] Customer: booking → pay → en_route-only tracking → receipt
- [ ] Vendor: offer countdown → Adjust Quote (2x cap enforced) → no-show rules

## 3. Admin dashboard live
- [ ] `/vendors` queue staffed, `/pricing` reviewed for diesel costs
- [ ] `/disputes` + `/jobs/:id/timeline` verified with a test booking
- [ ] `/ops` reconciliation green, `/waitlist` reviewed for expansion LGAs

## 4. Compliance
- [ ] Privacy Policy published, `policy_version` bumped, consent re-prompted
- [ ] Export (`GET /me/export`) + delete (`DELETE /me`) verified
- [ ] Waitlist message live for outside-pilot LGAs
