# ClinicOS Internal SOPs

Simple workflows for each role. Assumes Body Lab–style aesthetic clinic; adapt names as needed.

---

## Front Office (FO) — daily workflow

**Start of day**
1. Log in → Dashboard shows today’s bookings queue.
2. Open **Bookings** → confirm pending appointments (status: booked → confirmed).
3. Check WhatsApp reminder templates; copy/send manually if needed.
4. Review **Patients** for new registrations or incomplete profiles.

**During clinic hours**
1. Check in arrivals: booking → **Checked in** → creates/opens visit.
2. Assign performers for multi-staff appointments if not pre-assigned.
3. Handle walk-ins: **Bookings → New booking** (use overtime if outside hours, if permitted).
4. Collect consent on tablet/link before treatment when required.

**End of day**
1. Mark no-shows or cancellations with reason.
2. Open visits awaiting payment → **Invoices** → create/receipt.
3. Reconcile package redemptions with therapist notes.
4. Hand off incomplete visits to clinical team in person or via internal note.

**Do not**
- Change subscription or staff roles (Owner/Manager only).
- Edit clinical notes (Doctor/Therapist/Nurse).

---

## Doctor — daily workflow

1. Log in → Dashboard shows **patients awaiting clinical notes**.
2. Open assigned visit from queue or **Visits** list.
3. Complete **Doctor clinical form** (history, assessment, plan).
4. Add **treatment lines** if performing or co-signing.
5. Review consent status before signing off.
6. Mark clinical section complete; notify FO if billing needed.

**Permissions:** Own schedule, assigned patients/visits, clinical records. No billing reports or staff admin.

---

## Therapist — daily workflow

1. Log in → Dashboard shows **treatments to perform**.
2. Open visit → **Therapist record** (areas, products, settings).
3. Add **before/after photos** and **mapping** when applicable.
4. Record **performer notes** for handoff.
5. Redeem **patient packages** when session uses prepaid balance.
6. Complete visit; FO creates invoice if payment due.

---

## Nurse — daily workflow

Same clinical path as Therapist for assigned visits. Often supports mapping, photos, and vitals. Uses **Visits → own assignments** and schedule view.

---

## Manager — setup & operations workflow

**Initial setup (first 2 weeks)**
1. Complete onboarding checklist on dashboard (logo, hours, staff, treatments, public booking).
2. **Admin → Branding** — logo, colors, clinic name.
3. **Admin → Schedule** — operating hours and staff weekly schedules.
4. **Treatments & Packages** — catalog, online booking flags, pricing.
5. **Staff → Directory** — invite FO, clinical roles; verify roles & permissions.
6. **Staff → Schedule** — assign performers to shifts.
7. **Consent templates** — link to treatments requiring consent.
8. Test **public booking** URL `/book/{slug}` on mobile.

**Ongoing**
1. Review **Reports** (if on Clinic/Complete plan).
2. Monitor **Audit log** for sensitive changes.
3. Approve commission rules with Owner.
4. Handle escalations from FO; do not impersonate unless trained.

---

## Owner — billing workflow

1. **Billing → Plans** — choose plan and billing cycle.
2. **Checkout** — bank transfer instructions + unique payment code.
3. Upload payment proof; status shows **submitted**.
4. Wait for platform verification (Super Admin).
5. Optional: submit **plan change request** instead of immediate checkout for downgrades/upgrades requiring review.
6. Monitor usage warnings (staff/storage) on dashboard banners.
7. **Help & Support** for diagnostics to send to platform team.

**Owner-only**
- Subscription changes via SA if self-serve fails.
- Staff limit increases require plan upgrade.
- Archive/cancel clinic via Super Admin (not self-service).

---

## Super Admin — payment verification workflow

1. Log in at `/superadmin`.
2. **Notifications** — watch for `payment_proof_submitted`.
3. Open **Payments** queue → filter `submitted`.
4. Open clinic detail → verify amount, plan, cycle, proof image.
5. **Approve** → subscription activated; clinic notified in-app.
6. **Reject** → enter reason; clinic can resubmit.
7. Log follow-up in **Customers → Pipeline** if trial ending soon.
8. Use **Message templates** to copy WhatsApp follow-up (manual send only).

**Also monitor**
- **Customers → Commercial KPIs** — trials ending, churn risk.
- **Platform ops** — health, errors, backups.
- **Audit log** — impersonation, exports, permanent deletes.

---

## Escalation

| Issue | Action |
|-------|--------|
| Payment not verified > 24h | SA priority queue |
| Trial expired, clinic locked | SA extend trial or approve payment |
| Data export request | SA export support data (not full PHI dump) |
| Suspected breach | Force logout all users (clinic detail → danger zone) |
