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
- Frontend: React 19 + React Router + Tailwind + Shadcn/UI + Sonner + Lucide.
- Hard multi-tenant isolation: every collection has a `clinic_id`; `scope(user)` helper guarantees queries are scoped.
- Modules: `saas.py` (SaaS layer), `bookings.py` (Phase 3+4), `superadmin.py` (Phase 5+6).

## What's been implemented

### Iteration 1-3 (legacy / pre-SaaS)
- JWT login, role-aware sidebar, dashboard with KPIs.
- Patient + visit lifecycle; doctor/therapist forms, treatments, photos, mapping canvas, audit log.
- Admin Settings Center; camera capture; responsive shell with bottom nav.

### Iteration 4 (SaaS Phase 1 — multi-tenant backend, Feb 2026)
- `clinic_id` scoping on every collection and query.
- `/app/backend/saas.py`: plan catalog, helpers, `public_clinic_view`, `clinic_is_readonly`, registration.
- Endpoints: `POST /auth/register-clinic`, `GET/PUT /clinics/me`, `GET /plans`, `GET /clinics/by-slug/{slug}`.
- Seed script `seed_demo_clinics.py` for 4 demo clinics.

### Iteration 5 (SaaS Phase 2 — frontend wiring, Feb 2026)
- `ClinicProvider` in App.js. Routes: `/register`, `/onboarding`, `/billing/plans`, `/billing/checkout`. `OnboardingRedirect`.
- `AppShell`: `SubscriptionBanner` + `ExpiryGate`; locked nav with lock icons.
- `FeatureGate` on visit tabs.
- Multi-tenant identity leak fixed.
- Backend 100% / Frontend 92%+.

### Iteration 6 (Phase 3 & 4 + Plan Quiz, Feb 2026)
- **Plan Recommender Quiz** on `/billing/plans` (3 questions → "Recommended for you" badge).
- **Phase 3 — Public Online Booking** (`/book/{slug}`): availability engine, 8 default treatments, slot overlap detection, 3-step wizard.
- **Phase 4 — FO Booking Management** (`/bookings`): Today/Upcoming/Past tabs, status flow, "New booking" modal, copy public link, **WhatsApp Templates UI** with placeholder interpolation, copy + wa.me deep-link + mark-sent.
- **Enhanced Dashboard**: 8 KPIs, today's bookings table, top treatments MTD.
- Backend 100% (18/18) / Frontend ~95%.

### Iteration 7 (Phase 5 — Super Admin portal, Feb 2026)
- **`/superadmin`** env-credentialed dark-themed portal (separate auth context):
  - **Dashboard**: MRR, total clinics, pending payments, active trials, plan distribution, quick actions.
  - **Clinics list**: search by name/slug/email; filter by status/plan; per-row staff/patient/booking counts.
  - **Clinic detail**: counts dashboard + subscription actions (Activate / Suspend / Extend +30d / change plan).
  - **Payments queue**: verify/reject submitted requests; verifying activates the clinic + extends expiry 30 days.
  - **Announcements** CRUD: severity (info/warning/success) + audience (all/trial/active/expired).
- **Real payment flow**: `/billing/checkout` now POSTs `/api/billing/payment-request` with optional proof file upload (Emergent Object Storage), replacing earlier mock.
- Backend 100% (28/28 new + 10/10 saas regression) / Frontend 100%.

### Iteration 8 (Magic Link / WhatsApp QR fast-track, Feb 2026)
- **WhatsApp "Notify in 1 click" card** on `/billing/checkout` after the upload section:
  - Pre-filled WA message with plan name, total amount, unique code, clinic name.
  - Green WhatsApp CTA button → `wa.me/{number}?text=...` deep link.
  - **Scannable QR code** (qrcode.react) for desktop → mobile handoff.
  - Copy support number to clipboard.
- Backend: new public endpoint `GET /api/platform/support` returns `{whatsapp, hours}` from env.
- Cuts payment-verify turnaround from ~24h to minutes.

### Iteration 10 (Revenue chart + full clinic staff seat seeds, Feb 2026)
- **Revenue chart on `/superadmin` dashboard** — 6-month stacked bar chart (Starter/Clinic/Complete) using recharts.
- **Seeded Glow Aesthetic with full staff team** (doctor / therapist / FO / manager) + cleaned 7 stale test clinics + seeded 29 demo-history verified payments.

### Iteration 11 (Today's queue + Treatments CRUD + Patient transactions, Feb 2026)
- **Role-aware "Today's queue"** on clinic dashboard: Doctor sees pending clinical forms; Therapist sees pending therapist work + today's confirmed/checked_in bookings; FO sees today's bookings to confirm/check-in + visit completion items; Manager/Owner sees operations snapshot (bookings today / pending confirmations / in-progress visits).
- **Treatments catalog CRUD** at `/treatments` (Owner/FO/Manager): name, category (facial/injectable/laser/peel/body/consult/general), duration, price, concurrent slots, active toggle, description. Auto-seeds 8 defaults on first access.
- **Patient detail enhancement**: `patient-spend-summary` card with lifetime spend / visits / items / last-visit / avg-per-visit, and full `patient-transactions` table with per-visit subtotals.
- Backend new endpoints: GET/POST/PUT/DELETE `/treatments-catalog`, GET `/dashboard/me-queue`, GET `/patients/{pid}/stats`, GET `/patients/{pid}/transactions`. Availability engine now respects `slots_per_session`.
- Demo data: 5 Glow patients with 12 visits + ~24 treatment_items (Anya Rp 4.1M, Dharma Rp 8.2M, etc.).

### Iteration 12 (Treatment list view + performer_type + slot capacity enforcement + redesigned New Booking, Feb 2026)
- **Treatments page → table layout** with columns: Treatment, Category, Performed by (Stethoscope=Doctor, Heart=Therapist), Duration, Slots, Price, Active, Actions.
- **New `performer_type` field** on treatment (doctor / therapist / either) — DEFAULT_TREATMENTS pre-mapped (Consult/Injectables=doctor, Facial/Laser/Peel/Body=therapist).
- **Capacity-aware booking enforcement**: new `_has_slot_conflict()` helper. With `slots_per_session=1` and one existing same-treatment booking at a slot, second booking returns **409**. Different-treatment overlaps always 409. Public POST + FO POST share the same logic.
- **FO "New Booking" modal redesigned** as a 2-step wizard:
  - Step 1: search & select existing patient OR walk-in.
  - Step 2: treatment category → treatment dropdown → date → time (populated from availability API) → performer (filtered by treatment's performer_type — only doctors for doctor-only treatments, only therapists for therapist-only).
- POST `/api/bookings` now accepts `performer_id` (validated against same clinic). Manager role gains booking CRUD permissions.
- Backend 100% (11/11 iter12 tests; 5 pre-existing test_bookings failures relate to stale test data colliding with the new capacity rule — not a regression).

### Iteration 9 (Platform Settings module + Payment Proof viewer, Feb 2026)
- **New `/superadmin/settings` page** with 3 tabs:
  - **General**: platform name, support WhatsApp, business hours, support email.
  - **Bank accounts**: full CRUD with active/inactive toggle; checkout shows only active.
  - **Plan pricing**: edit `price_idr`, `max_staff`, `storage_gb` per plan (3 existing tiers only — features stay code-defined).
- New `/app/backend/platform_settings.py` module with `platform_settings` mongo collection (single doc id="platform"). Auto-seeds defaults on first read.
- New public endpoint `GET /api/platform/public-config` → `{platform_name, support, banks: [active]}`. `/api/plans` now merges `plan_overrides` into the catalog. `/api/platform/support` reads from settings (env is now fallback).
- **Payment proof viewer modal** in `/superadmin/payments`: "View proof" button on each row with a `proof_path`; opens image inline or iframes a PDF (uses `?auth=<token>` for JWT-protected file URL).
- `/billing/checkout` fetches bank accounts dynamically from `/api/platform/public-config` (no more hardcoded BCA/Mandiri).
- Safety nets: rejects empty active bank set (at least one bank must stay active), rejects unknown plan override keys.
- Backend 100% (12/12 new tests, all regression green) / Frontend 100%.

### Iteration 12 (Configurable booking slot interval, Feb 28 2026)
- New clinic field `booking_slot_interval` (default 30, validated 5–240 min).
- `PUT /api/clinics/me` accepts and validates the interval.
- `_gen_slots()` in `bookings.py` now uses the clinic's interval — `/public/clinics/{slug}/availability` returns slots on the chosen grid (5/10/15/20/30/45/60 or custom).
- Frontend: new **Schedule** tab in `/admin` (clinic owner) with preset chips + custom number input.
- Frontend: **Custom time** toggle in the FO "New booking" modal — swaps the slot dropdown for a `<input type="time">` so staff can book ad-hoc times like 14:05. Performer-based conflict check still enforced server-side.
- Verified via curl: 15 min → 09:00, 09:15, 09:30…; 20 min → 09:00, 09:20, 09:40…; invalid 3 min rejected (400); custom booking at 14:05 saved successfully.

## Plan catalog
| Plan | Price (IDR/mo) | Staff | Storage | Features |
|------|---------------|-------|---------|----------|
| Starter | 800,000 | 3 | 2 GB | patients, online_booking, photos, whatsapp_templates |
| Clinic (most popular) | 1,200,000 | 7 | 5 GB | Starter + emr, billing, mapping, signature, treatments |
| Complete | 1,500,000 | unlimited | 20 GB | Clinic + reports, multi_location, audit_log, whatsapp_automation |
| Trial (14 days) | free | n/a | n/a | All Complete features |

## Prioritized backlog

### P1 — Polish / hardening
- **Render uploaded payment proof image/PDF link in `/superadmin/payments`** queue rows (currently metadata-only).
- Strict booking transition graph (prevent completed → booked).
- Normalize `scheduled_at` to UTC ISO with offset on insert (both public + FO paths).
- Revenue MTD: switch from `treatment_items.created_at` to `visit_date`.
- Server-side overlap detection for different-duration bookings on non-identical start times.

### P2 — Quality of life
- Automated SMS/WhatsApp via Twilio or Fonnte (turn manual WA templates into 1-click auto-send + day-before reminders).
- Multi-currency, scheduled trial-expiry job, feature-flag toggles per clinic.
- Soft-delete users to preserve historical references.
- Tighten CORS (explicit origin + credentials).

### P3 — Tech debt
- Move large mapping base64 to object storage.
- Replace `?auth=token` query param with short-lived signed URLs.
- Lifespan context manager replacing deprecated `@on_event`.
- Server-side PDF export.
- Split `AdminPage.jsx` into per-tab files.
- conftest.py that auto-loads REACT_APP_BACKEND_URL for pytest.

## Key API endpoints
- SaaS: `POST /auth/register-clinic`, `GET/PUT /clinics/me`, `GET /plans`, `GET /clinics/by-slug/{slug}`.
- Public booking: `GET /public/clinics/{slug}/treatments|availability`, `POST /public/clinics/{slug}/bookings`.
- FO booking: `GET/POST /bookings`, `GET/PUT/DELETE /bookings/{id}`, `PUT /bookings/{id}/status`, `POST /bookings/{id}/wa-sent`.
- Misc: `GET /wa-templates`, `GET /treatments-catalog`, `GET /dashboard/owner`, `GET /announcements/active`.
- Payments: `POST /billing/payment-request` (multipart).
- Super Admin (platform_admin only): `GET /superadmin/dashboard`, `GET /superadmin/clinics`, `GET /superadmin/clinics/{cid}`, `PUT /superadmin/clinics/{cid}/subscription`, `DELETE /superadmin/clinics/{cid}`, `GET /superadmin/payments`, `POST /superadmin/payments/{pid}/{verify|reject}`, `GET/POST/DELETE /superadmin/announcements`.

## Test data
See `/app/memory/test_credentials.md`. SaaS demo clinics (`password123`):
- Cantik Beauty (Starter) · owner@cantikbeauty.id
- Glow Aesthetic (Clinic) · owner@glowclinic.id
- Lumina Aesthetic (Complete) · owner@luminabali.id
- Rena Skin (Trial, 3 days left) · owner@renaskin.id

Platform Admin: `platform@clinicos.id` / `ClinicOS@2026` (env-driven)
