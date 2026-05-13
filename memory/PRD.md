# ClinicOS — Multi-tenant Aesthetic Clinic SaaS

## Original problem statement
Evolve the existing single-clinic aesthetic EMR ("Body Lab Bali") into **ClinicOS**, a multi-tenant SaaS platform.

**Top-level requirements**
1. Multi-tenant architecture — all data scoped by `clinic_id` (hard isolation).
2. Registration + onboarding flow for new clinics. 14-day free trial with full features.
3. Subscription plans (Starter, Clinic, Complete) with feature gating + manual bank-transfer payment flow.
4. Public Online Booking System (`/book/[clinic-slug]`) + FO Booking Management with WhatsApp reminder templates UI.
5. Enhanced Clinic Dashboards (Owner / FO).
6. Separate Super Admin portal (`/superadmin`) to manage clinics, subscriptions, and payment verifications.

## User personas
- **Clinic Owner** (`super_admin` role inside their clinic) — registers, picks a plan, manages billing.
- **Doctor / Therapist / FO / Manager** — staff seats within a clinic.
- **Platform Super Admin** — env-credentialed `/superadmin` access; manages all clinics.

## Architecture
- Backend: FastAPI + MongoDB (Motor), JWT auth, Emergent Object Storage for images.
- Frontend: React 19 + React Router + Tailwind + Shadcn/UI + Sonner toasts + Lucide.
- Hard multi-tenant isolation: every collection has a `clinic_id` field; `scope(user)` helper guarantees queries are scoped.
- Booking & dashboard logic lives in `/app/backend/bookings.py`, SaaS layer in `/app/backend/saas.py`.

## What's been implemented

### Iteration 1-3 (legacy / pre-SaaS)
- JWT login, role-aware sidebar, dashboard with KPIs.
- Patient + visit lifecycle (in_progress → completed); doctor/therapist forms, treatments, photos, mapping canvas, audit log.
- Admin Settings Center.
- Camera capture for photos; mobile/tablet responsive shell with bottom nav.

### Iteration 4 (SaaS Phase 1 — multi-tenant backend, Feb 2026)
- Added `clinic_id` scoping across every backend collection and query.
- Removed legacy in-clinic patient billing.
- `/app/backend/saas.py`: plan catalog, helpers, `public_clinic_view`, `clinic_is_readonly`, registration.
- Endpoints: `POST /auth/register-clinic`, `GET/PUT /clinics/me`, `GET /plans`, `GET /clinics/by-slug/{slug}`.
- Seed script `seed_demo_clinics.py` for 4 demo clinics.

### Iteration 5 (SaaS Phase 2 — frontend wiring, Feb 2026)
- `ClinicProvider` in App.js. Routes: `/register`, `/onboarding`, `/billing/plans`, `/billing/checkout`. `OnboardingRedirect` guard.
- `AppShell`: globally renders `SubscriptionBanner` + `ExpiryGate`; lock icons on plan-gated nav items.
- `FeatureGate` on visit tabs (Starter locks clinical/therapist/treatments/mapping).
- Multi-tenant identity leak fixed (sidebar reads real clinic name).
- Backend 100% (10/10 SaaS tests + 63/64 full suite); Frontend e2e 92%+.

### Iteration 6 (SaaS Phase 3 & 4 + Plan Quiz, Feb 2026)
- **Plan Recommender Quiz** on `/billing/plans` (3 questions → highlights recommended plan with "Recommended for you" badge).
- **Phase 3 — Public Online Booking** (`/book/{slug}`)
  - `/api/public/clinics/{slug}/treatments` · `/availability?date&duration` · `POST /bookings` (no auth).
  - Availability engine: 30-min slot grid, fallback operating hours per weekday, overlap detection.
  - 8 default treatments with durations + prices. Past-date rejection (400), slot conflict (409).
  - 3-step wizard UI: treatment → date+slot → contact form → confirmation.
- **Phase 4 — FO Booking Management** (`/bookings`)
  - List with Today/Upcoming/Past scope tabs + status filter.
  - Status flow: booked → confirmed → checked_in → completed (also cancelled / no_show).
  - "New booking" modal (manual FO entry), "Copy booking link" + "View public page" CTAs.
  - **WhatsApp Template UI**: 3 default templates (confirmation, reminder, follow-up) with `{patient_name}` / `{treatment}` / `{date}` / `{time}` / `{clinic_name}` interpolation. Copy + Open WhatsApp (wa.me deep link) + Mark as sent (writes wa_history with audit trail).
- **Enhanced Dashboard**
  - `/api/dashboard/owner` returns: bookings_today, upcoming_bookings, pending_confirm, revenue_mtd, revenue_prev_month, revenue_delta_pct, top_treatments[], total_patients, visits_today, total_visits, in_progress.
  - UI: 8 KPI cards, today's bookings table, top treatments (MTD) panel, public-link card.
- Bookings collection scoped by `clinic_id` with indexes on `(clinic_id, scheduled_at)` and `(clinic_id, status)`.
- Backend 100% (18/18 new booking tests); Frontend 95%+ (only LOW cosmetic: date strip shows 12 visible of 14 due to overflow).

## Plan catalog
| Plan | Price (IDR/mo) | Staff | Storage | Features |
|------|---------------|-------|---------|----------|
| Starter | 800,000 | 3 | 2 GB | patients, online_booking, photos, whatsapp_templates |
| Clinic (most popular) | 1,200,000 | 7 | 5 GB | Starter + emr, billing, mapping, signature, treatments |
| Complete | 1,500,000 | unlimited | 20 GB | Clinic + reports, multi_location, audit_log, whatsapp_automation |
| Trial (14 days) | free | n/a | n/a | All Complete features |

## Prioritized backlog

### P0 — Next up
- **Phase 5 — Super Admin portal `/superadmin`** (env credentials)
  - Clinics list + detail (Activate / Suspend / Extend trial / Override plan).
  - Payment verification queue (review uploaded proofs and activate plan).
  - MRR + total-clinics dashboard.
- **Phase 6** — feature flag management, announcements, multi-currency, scheduled trial-expiry job.

### P1 — Important enhancements
- Wire actual payment-proof upload to Object Storage (currently MOCKED on `/billing/checkout`).
- Strict booking status transition graph (prevent completed → booked).
- Normalize `scheduled_at` to UTC ISO with offset on insert (both public + FO paths) to prevent day-bucket drift.
- Revenue aggregation: switch from `treatment_items.created_at` to `visit_date` for accuracy.
- Server-side conflict detection for overlapping different-duration bookings on non-identical start times.

### P2 — Refactor / hardening
- Tighten CORS (explicit origin instead of `*` + credentials).
- Move large mapping base64 to object storage.
- Soft-delete users to preserve historical references.
- Replace `?auth=token` query param with short-lived signed URLs.
- Lifespan context manager replacing deprecated `@on_event`.
- Server-side PDF export.
- Split `AdminPage.jsx` into per-tab files.

## Key API endpoints
- SaaS: `POST /auth/register-clinic`, `GET/PUT /clinics/me`, `GET /plans`, `GET /clinics/by-slug/{slug}`.
- Public booking: `GET /public/clinics/{slug}/treatments`, `GET /public/clinics/{slug}/availability`, `POST /public/clinics/{slug}/bookings`.
- FO booking: `GET/POST /bookings`, `GET/PUT/DELETE /bookings/{id}`, `PUT /bookings/{id}/status`, `POST /bookings/{id}/wa-sent`.
- Misc: `GET /wa-templates`, `GET /treatments-catalog`, `GET /dashboard/owner`.

## Test data
See `/app/memory/test_credentials.md`. SaaS demo clinics (`password123`):
- Cantik Beauty (Starter) · owner@cantikbeauty.id
- Glow Aesthetic (Clinic) · owner@glowclinic.id
- Lumina Aesthetic (Complete) · owner@luminabali.id
- Rena Skin (Trial, 3 days left) · owner@renaskin.id

Public booking demo: https://aesthetic-records.preview.emergentagent.com/book/cantikbeauty
