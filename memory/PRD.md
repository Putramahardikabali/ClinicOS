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

## Iteration 2 (2026-02)
- **Super Admin Settings Center** at `/admin` with 6 tabs:
  - **Branding**: clinic name, tagline, logo upload to object storage (publicly served), 6 theme colors with live preview via CSS custom properties
  - **Users CRUD**: list/add/edit/delete users with role assignment (super_admin self-deletion blocked)
  - **Doctor Form Builder**: dynamic add/edit/remove of face-assessment sections, sub-questions, and option chips
  - **Therapist Form**: editable contraindication checklist + device list
  - **Treatment / Billing**: editable categories, units, payment methods
  - **Mapping Templates**: per-template SVG editor with live preview (face / body_front / body_back)
- **Camera capture** via `getUserMedia` for before/after photos — front/rear camera switch, capture/retake/confirm flow alongside file picker
- **Mobile/tablet responsive shell**: sidebar collapses to drawer with hamburger top bar at <1024px; all tables wrapped in horizontal scroll containers; reduced padding on small screens
- **Frontend settings context** (`useSettings`) reads from `/api/branding` (public) before login and `/api/settings` (auth) after, applies CSS variables (`--bl-primary`, `--bl-accent`, etc.) globally
- All hardcoded form options (face sections, contraindications, devices, treatment categories, units, payment methods, mapping templates) now come from server settings — instantly editable by Super Admin
- 47/47 backend pytest tests pass; full frontend regression verified

## Prioritized backlog
- **P1**: Tighten CORS (explicit origin instead of `*` + credentials).
- **P1**: Move large mapping images to object storage (currently inline base64 in Mongo).
- **P2**: Add strict Pydantic schemas for `/api/admin/settings` sub-sections (currently `Dict[str, Any]`).
- **P2**: Soft-delete users to preserve historical references on visits/records.
- **P2**: Manager analytics (revenue per category, top doctors, retention).
- **P2**: Photo lightbox + side-by-side before/after comparison view.
- **P2**: Replace `?auth=token` query param on file URLs with short-lived signed URLs.
- **P3**: Lifespan context manager (replacing deprecated `@on_event`).
- **P3**: Server-side PDF export.
- **P3**: Split AdminPage.jsx into per-tab files (currently 461 lines).
