# ClinicOS Production Readiness Checklist

For the full `app.clinicos.id` / `api.clinicos.id` rollout guide, see `docs/DEPLOY_APP_CLINICOS_ID.md`.

Use this checklist before pointing a real domain at production and onboarding the first paying clinic.

## Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `MONGO_URL` | Yes | Production MongoDB connection string (TLS enabled) |
| `DB_NAME` | Yes | Dedicated production database name |
| `JWT_SECRET` | Yes | Strong random secret; never commit to git |
| `SUPER_ADMIN_EMAIL` | Yes | Platform admin login email |
| `SUPER_ADMIN_PASSWORD` | Yes | Strong password; rotate after first login |
| `STORAGE_URL` / S3 vars | Yes | Object storage for photos, logos, payment proofs |
| `REACT_APP_BACKEND_URL` | Yes (frontend build) | Public API URL, e.g. `https://api.yourclinic.com` |
| `CORS_ORIGINS` | Recommended | Restrict to your app domain(s) |

## Database

- [ ] MongoDB backups scheduled (daily minimum; test restore monthly)
- [ ] Indexes verified on `clinic_id` fields for hot collections
- [ ] Production DB separate from dev/staging
- [ ] Connection limits and monitoring configured

## Storage

- [ ] S3-compatible bucket created with private ACL
- [ ] CORS configured for upload from app domain only
- [ ] Lifecycle policy for old demo/test assets (optional)

## Email / WhatsApp (manual workflows)

- [ ] Support WhatsApp number set in **Super Admin → Settings → Platform**
- [ ] Support hours / contact copy verified on Help page
- [ ] Message templates reviewed in **Super Admin → Customers → Templates**
- [ ] No automatic sending enabled (by design at launch)

## Platform admin

- [ ] Super Admin credentials stored in password manager
- [ ] Super Admin login tested at `/superadmin`
- [ ] Impersonation tested and audit log verified
- [ ] Platform ops health tab shows green

## Plans & pricing

- [ ] Plan prices verified in **Super Admin → Settings → Plans**
- [ ] Trial length (14 days default) confirmed
- [ ] Feature gating per plan smoke-tested (Starter / Clinic / Complete)
- [ ] Bank transfer instructions and unique payment codes working

## Bank accounts

- [ ] At least one active bank account in platform settings
- [ ] Account names match legal entity on invoices
- [ ] Test payment request → SA verify flow end-to-end

## Support contact

- [ ] Public `/api/platform/support` returns correct WhatsApp & hours
- [ ] Help page and drawer show support diagnostics for owners
- [ ] Escalation path documented for SA team

## Domain & SSL

- [ ] Frontend served over HTTPS
- [ ] API served over HTTPS
- [ ] Cookie/token storage reviewed (localStorage; consider CSP headers)
- [ ] Public booking URL tested: `/book/{clinic-slug}`

## Seed & default clinic settings

- [ ] New trial signup seeds settings, categories, and forms
- [ ] Operating hours template appropriate for target market
- [ ] Default treatment categories reviewed
- [ ] Demo/test clinics flagged with `is_test_clinic` in Super Admin

## Security & compliance

- [ ] No secrets in audit logs or platform error logs
- [ ] Export support data excludes passwords/tokens
- [ ] Permanent delete only available for test clinics
- [ ] Archive/cancel requires churn reason + note
- [ ] Rate limiting on public registration (recommended before wide launch)

## Launch smoke test

Run before go-live:

```bash
cd backend
py -3.10 -m pytest tests/test_launch_regression.py tests/test_commercial.py tests/test_customer_lifecycle.py -q
```

- [ ] All tests pass against production-like environment
- [ ] One full manual walkthrough using `docs/DEMO_SCRIPT.md`

## Post-launch monitoring

- [ ] Super Admin → Platform ops → System health reviewed daily (first week)
- [ ] Super Admin → Customers pipeline reviewed for trial follow-ups
- [ ] Payment queue cleared within 24h SLA
