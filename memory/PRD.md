# ClinicOS — Multi-tenant Aesthetic Clinic SaaS

## Original problem statement
Evolve the existing single-clinic aesthetic EMR ("Body Lab Bali") into **ClinicOS**, a multi-tenant SaaS platform.

**Top-level requirements**
1. Multi-tenant architecture — all data scoped by `clinic_id` (hard isolation).
2. Registration + onboarding flow for new clinics. 14-day free trial with full features.
3. Subscription plans (Starter, Clinic, Complete) with feature gating + manual bank-transfer payment flow.
4. Public Online Booking System (`/book/[clinic-slug]`) and FO Booking Management (with WhatsApp reminder templates UI).
5. Enhanced Clinic Dashboards (Owner / FO).
6. Separate Super Admin portal (`/superadmin`) to manage clinics, subscriptions, and payment verifications.

## User personas
- **Clinic Owner** (`super_admin` role inside their clinic) — registers, picks a plan, manages billing.
- **Doctor / Therapist / FO / Manager** — staff seats within a clinic.
- **Platform Super Admin** — env-credentialed `/superadmin` access; manages all clinics.

## Architecture
- Backend: FastAPI + MongoDB (Motor), JWT auth, Emergent Object Storage for images.
- Frontend: React 19 + React Router + Tailwind + Shadcn/UI + Sonner toasts + Lucide.
- Hard multi-tenant isolation: every collection except `users.platform_admin` has a `clinic_id` field; `scope(user)` helper guarantees queries are scoped.
- Plan catalog defined in `/app/backend/saas.py`. Features computed via `get_clinic_features(clinic)`, returned in `public_clinic_view`.

## What's been implemented

### Iteration 1-3 (legacy / pre-SaaS)
- JWT login, role-aware sidebar, dashboard with KPIs.
- Patient + visit lifecycle (in_progress → completed); doctor clinical form, therapist treatment form, treatments, photos, mapping canvas, audit log.
- Admin Settings Center (`/admin`) with 6 tabs.
- Camera capture for photos; mobile/tablet responsive shell with bottom nav.

### Iteration 4 (SaaS Phase 1 — multi-tenant backend, Feb 2026)
- Added `clinic_id` scoping across every backend collection and query.
- Removed legacy in-clinic patient billing from EMR (separate from SaaS subscription billing).
- Created `/app/backend/saas.py`: plan catalog, helpers, `public_clinic_view`, `clinic_is_readonly`, registration logic.
- Endpoints: `POST /api/auth/register-clinic`, `GET /api/clinics/me`, `PUT /api/clinics/me`, `GET /api/plans`, `GET /api/clinics/by-slug/{slug}`.
- Seed script `/app/backend/seed_demo_clinics.py` for 4 demo clinics (Starter, Clinic, Complete, Trial).
- Backend regression: 10/10 SaaS pytest + 63/64 full suite green.

### Iteration 5 (SaaS Phase 2 — frontend wiring, Feb 2026)
- `App.js`: wrapped with `ClinicProvider`. New routes `/register`, `/onboarding`, `/billing/plans`, `/billing/checkout`. `OnboardingRedirect` forces unfinished clinics to `/onboarding`.
- `lib/clinic.js`: `ClinicProvider` context, `hasFeature`, `trialDaysLeft`, `formatIdr`.
- `AppShell`: globally injects `SubscriptionBanner` (trial countdown / renewal warning) + `ExpiryGate` (modal lockout when readonly). New "Billing & Plan" sidebar item for owners. Locked nav items show a lock icon when feature missing in current plan.
- Clinic name now correctly resolves from `branding.clinic_name || clinic?.name || "ClinicOS"` (fixed multi-tenant identity leak).
- `RegisterPage` + `OnboardingPage` + `BillingPlansPage` + `BillingCheckoutPage` fully wired; on register the settings doc seeds `branding.clinic_name = <new clinic name>` so the new tenant doesn't inherit "Body Lab Bali".
- `VisitDetailPage`: tabs wrapped in `FeatureGate`. Starter plan locks `clinical/therapist/treatments/mapping`; photos remain unlocked. Complete unlocks all.
- `LoginPage`: added "Start your free trial →" link to `/register`.
- Frontend e2e validated 92%+ via testing agent; 3 fixes applied (clinic name fallback, `current-plan-badge` + `bank-info` + `payment-submit` testids).

## Plan catalog (current)
| Plan | Price (IDR/mo) | Staff | Storage | Features |
|------|---------------|-------|---------|----------|
| Starter | 800,000 | 3 | 2 GB | patients, online_booking, photos, whatsapp_templates |
| Clinic (most popular) | 1,200,000 | 7 | 5 GB | Starter + emr, billing, mapping, signature, treatments |
| Complete | 1,500,000 | unlimited | 20 GB | Clinic + reports, multi_location, audit_log, whatsapp_automation |
| Trial (14 days) | free | n/a | n/a | All Complete features |

## Prioritized backlog

### P0 — In progress / next up
- **Phase 3 — Public Online Booking** (`/book/[clinic-slug]`)
  - Availability engine (operating hours, treatment durations, capacity).
  - Patient-facing booking page (no auth) with clinic branding.
  - Booking endpoints (POST create, status lifecycle).
- **Phase 4 — FO Booking Management**
  - Booking list with status flow: Booked → Confirmed → Checked In → Visit.
  - WhatsApp template UI (text composition + copy-to-clipboard + "Mark as sent").
  - Enhanced Owner/FO dashboards (revenue comparison, top treatments, booking stats).

### P1 — Following phases
- **Phase 5 — Super Admin portal `/superadmin`** (env credentials)
  - Clinics list + detail (Activate / Suspend / Extend trial / Override plan).
  - Payment verification queue (review uploaded proofs and activate plan).
  - MRR + total-clinics dashboard.
- **Phase 6 — Plan/feature flag management, announcements**, Multi-currency, scheduled trial-expiry job.

### P2 — Refactor / hardening
- Tighten CORS (explicit origin instead of `*` + credentials).
- Move large mapping/base64 to object storage.
- Strict Pydantic schemas for `/api/admin/settings` sub-sections.
- Soft-delete users to preserve historical references.
- Replace `?auth=token` query param on file URLs with short-lived signed URLs.
- Lifespan context manager replacing deprecated `@on_event`.
- Server-side PDF export.
- Split `AdminPage.jsx` into per-tab files.
- Wire actual payment-proof upload (Emergent Object Storage) on `/billing/checkout`.

## Key API endpoints (SaaS layer)
- `POST /api/auth/register-clinic` — creates clinic + owner, returns token. 14-day trial.
- `GET /api/auth/me` — current user.
- `GET /api/clinics/me` — current clinic + features + readonly flag.
- `PUT /api/clinics/me` — update clinic (owner only).
- `GET /api/plans` — list 3 SaaS plans.
- `GET /api/clinics/by-slug/{slug}` — public, used by booking page.

## Test data
See `/app/memory/test_credentials.md`. SaaS demo clinics:
- Cantik Beauty (Starter) · owner@cantikbeauty.id
- Glow Aesthetic (Clinic) · owner@glowclinic.id
- Lumina Aesthetic (Complete) · owner@luminabali.id
- Rena Skin (Trial, 3 days left) · owner@renaskin.id
- Password for all: `password123`
