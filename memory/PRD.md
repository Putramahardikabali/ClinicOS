# Body Lab Bali — Aesthetic EMR (Prototype)

## Original problem statement
Secure internal medical record system prototype for an aesthetic clinic ("Body Lab Bali"). 5 roles (Super Admin, Doctor, Therapist, FO/Front Office, Manager). Patient → Visit → Clinical/Therapist record + Treatment items + Photos + Mapping + Billing. Modules: login & role-aware dashboard, patient management, visit management, doctor clinical form, therapist treatment form, treatment/dosage input, before/after photo upload, face/body mapping canvas, FO pending billing, patient history timeline, print/PDF preview, audit log.

## Architecture
- Backend: FastAPI + MongoDB (Motor), JWT auth (PyJWT + bcrypt), Emergent Object Storage for photos
- Frontend: React 19 + React Router + Tailwind + Shadcn/UI + Sonner toasts + Lucide icons
- Design: Organic-Earthy palette (#FDFBF7 / #8A9A86 / #D4A373) with Outfit + DM Sans fonts

## User personas
- **Super Admin** — full system access (override locks, view audit, manage everything).
- **Doctor** — submits face/injectable clinical records (anamnesis, diagnosis, structured face assessment, dosage, signature).
- **Therapist** — submits body/laser/machine treatment records (contraindication checklist, parameters, intensity, duration, signature).
- **FO** — registers patients, creates visits, processes billing, prints records.
- **Manager** — view-only reporting + audit log access.

## Core requirements (static)
- Patient has many Visits; Visit has 1 Clinical Record OR 1 Therapist Record, many Treatment Items, many Photos, many Mappings, 1 Billing.
- Submitted clinical/therapist records are locked (only Super Admin can override).
- FO cannot edit submitted clinical content but can adjust billing.
- All actions audit-logged.

## What's been implemented (2026-02)
- JWT login with 5 seeded demo accounts.
- Role-aware sidebar + protected routes.
- Dashboard with KPIs (total patients/visits/in-progress/pending billing/billed/visits today) + recent visits.
- Patients list + search + create modal + detail page with timeline.
- Visit lifecycle: create → in_progress → submitted (after doctor/therapist submit) → billed (after FO marks paid).
- Doctor clinical form with structured chip-style face assessment (Skin Quality, Forehead/Frown/Neck/Nasolabial Lines static+dynamic, Tear Trough, Temples, Cheeks, Marionette Line, Lips, Chin, Jaw Line) + free-text + dosage + signature pad.
- Therapist treatment form with contraindication checklist (10 options), device dropdown, parameter/intensity/duration, signature pad.
- Treatment items table (15 categories, 8 unit types, qty/price).
- Photo upload via Emergent Object Storage, multi-angle (11 angles), before/after/follow-up types, gallery with filtering.
- Face/body mapping canvas with pen, eraser, marker (with dosage label), 5 colors, size slider, undo/clear, save image+JSON.
- Billing page with itemized invoice, line discounts, overall discount, payment method/status, auto-recompute totals.
- Pending Billing FO queue.
- Patient history timeline (chronological visits with diagnosis preview + photo count + billing status).
- Print/PDF preview page (window.print) with full record.
- Audit log viewer (Manager + Admin).
- 32/32 backend tests pass; frontend flows verified.

## Prioritized backlog
- **P1**: Patch CORS to use explicit origin instead of `*` + `allow_credentials=True`.
- **P1**: Move large mapping images to object storage (currently inline base64 in Mongo).
- **P2**: User management UI for Super Admin (currently seeded only).
- **P2**: Reports/analytics for Manager (revenue per category, doctor performance).
- **P2**: Photo lightbox + side-by-side before/after comparison view.
- **P2**: Replace `?auth=token` query param for files with short-lived signed URLs.
- **P3**: Lifespan context manager (replacing deprecated `@on_event`).
- **P3**: Server-side PDF export (currently uses browser print).
