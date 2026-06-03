# Deploy ClinicOS on app.clinicos.id

This guide is for live deployment where:

- Marketing site: `https://clinicos.id` (WordPress)
- ClinicOS frontend: `https://app.clinicos.id`
- ClinicOS API: `https://api.clinicos.id`

---

## 1) DNS records

Create these DNS records in your DNS provider:

- `A` / `CNAME` for `app.clinicos.id` -> frontend hosting target
- `A` / `CNAME` for `api.clinicos.id` -> backend hosting target
- `A` / `CNAME` for `clinicos.id` and `www.clinicos.id` -> WordPress hosting target

Recommended:

- TTL: 300s during migration; increase after stable
- Enable proxy/WAF only after baseline smoke tests pass

---

## 2) Backend production config (`api.clinicos.id`)

Use `backend/.env.production.example` as template.

Required baseline:

- `APP_ENV=production`
- `FRONTEND_URL=https://app.clinicos.id`
- `BACKEND_URL=https://api.clinicos.id`
- `CORS_ORIGINS=https://app.clinicos.id`
- `MONGO_URL=<production mongo>`
- `DB_NAME=clinicos_prod` (or your chosen prod DB)
- `JWT_SECRET=<strong random secret>`
- `STORAGE_URL=<production object storage>`
- `USE_LOCAL_UPLOADS=true`
- `UPLOAD_DIR=/app/uploads`
- `PUBLIC_UPLOAD_BASE_URL=https://api.clinicos.id/uploads`
- `SUPER_ADMIN_EMAIL`
- `SUPER_ADMIN_PASSWORD`
- `ENABLE_API_DOCS=false`
- `BETA_MODE=false` (set true only for beta label)

### Security behavior in production mode

Server now enforces:

- no wildcard CORS in production
- CORS origins from `CORS_ORIGINS` (or fallback to `FRONTEND_URL`)
- API docs disabled unless `ENABLE_API_DOCS=true`
- local demo bootstrap skipped (no Body Lab/demo auto-seed)
- uploaded files served from `GET /api/uploads/{path}` (auth required except branding assets)

---

## 3) Frontend production config (`app.clinicos.id`)

Use `frontend/.env.production.example` as template.

Required baseline:

- `REACT_APP_BACKEND_URL=https://api.clinicos.id`
- `REACT_APP_PUBLIC_UPLOAD_BASE_URL=https://api.clinicos.id/uploads`
- `REACT_APP_APP_ENV=production`
- `REACT_APP_BETA_MODE=false`

Optional beta environment:

- `REACT_APP_APP_ENV=production_beta` or `REACT_APP_BETA_MODE=true`
- App shell shows a visible **ClinicOS Beta Environment** banner

---

## 4) Database strategy

Production must use a clean DB. Avoid demo seed scripts.

### Allowed in production

- `python backend/scripts/seed_superadmin_only.py`

This upserts only platform admin credentials.

### Do not run in production

- `seed_demo_clinics.py`
- `seed_glow_staff.py`
- other QA/demo cleanup or smoke scripts that assume demo tenants

Optional demo seeding should be isolated to staging/demo environments.

---

## 5) Backup readiness checklist

- [ ] MongoDB Atlas backup enabled (continuous + point-in-time if available)
- [ ] Daily backup policy documented (if self-hosted Mongo)
- [ ] Restore test practiced on staging with last backup snapshot
- [ ] Object storage backup/versioning enabled for uploaded files
- [ ] Recovery runbook includes DB + file restore order
- [ ] RPO/RTO targets documented for on-call team

---

## 6) Deploy steps

### Backend

1. Provision server/container and attach prod env vars
2. Mount persistent upload volume:
   - `uploads:/app/uploads`
3. Deploy backend app
4. Verify API health:
   - `GET https://api.clinicos.id/api/platform/support`
5. Run superadmin seed once:
   - `python backend/scripts/seed_superadmin_only.py`
6. Confirm login at `https://app.clinicos.id/login` with superadmin credentials

### Frontend

1. Build with production env:
   - `REACT_APP_BACKEND_URL=https://api.clinicos.id`
2. Deploy build artifact to `app.clinicos.id`
3. Verify browser network calls target `https://api.clinicos.id/api/*`

### WordPress marketing

1. Keep WordPress on `clinicos.id`
2. Ensure CTA/login links point to `https://app.clinicos.id`

---

## 7) Smoke test checklist (post-deploy)

- [ ] Login as superadmin
- [ ] Create clinic
- [ ] Login as clinic owner
- [ ] Create patient
- [ ] Create booking
- [ ] Check-in visit
- [ ] Create invoice/payment
- [ ] POS sale
- [ ] Daily closing preview
- [ ] Gift card sale
- [ ] Account page update (name + password)
- [ ] Permission access for FO/doctor/accounting
- [ ] Print receipt
- [ ] Upload clinic logo returns `logo_path` and `file_url` on `https://api.clinicos.id/uploads/...`
- [ ] Upload visit before/after photo works and file is accessible by returned URL
- [ ] Upload template image works in Visit Settings mapping templates
- [ ] Restart backend container and previously uploaded files still exist
- [ ] No upload API response contains `localhost` in production
- [ ] No frontend console errors
- [ ] No API 5xx in logs during walkthrough

---

## 8) Rollback checklist

- [ ] Keep previous backend image/artifact tagged
- [ ] Keep previous frontend build artifact/version
- [ ] If rollback needed:
  1. Route traffic back to previous frontend version
  2. Route backend to previous stable image
  3. Verify login + bookings + invoices + POS + account
- [ ] Announce incident + rollback status to team
- [ ] Capture root cause and patch in staging first

---

## 9) Notes on safety defaults

- Messaging automation and online booking payment defaults are already off in seeded clinic settings.
- Production startup now skips local demo tenant bootstrap.
- This deployment prep does not alter business workflows or automation logic.
