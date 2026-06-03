# ClinicOS — 10-Minute Sales Demo Script

**Audience:** Clinic owner or manager  
**Duration:** ~10 minutes  
**Prep:** Demo clinic seeded with staff, treatments, sample patients, one booking today

---

## 0:00 — Hook (1 min)

> "ClinicOS is an all-in-one system for aesthetic clinics: booking, EMR, billing, packages, and commissions — with a public booking page your patients can use tonight."

Show **login** → Owner dashboard with onboarding checklist (if trial).

---

## 0:60 — Booking & front office (2 min)

1. **Bookings** calendar — today's appointments.
2. Create **manual booking**: patient, treatment, performer, time.
3. Show **multi-performer** slot (doctor + therapist) if configured.
4. Mention **overtime booking** for after-hours (FO permission).
5. Copy **WhatsApp reminder** template (manual send — no spam risk).

**Talk track:** "Front office sees everything in one calendar; no double-booking performers."

---

## 2:30 — Clinical visit (2 min)

1. Check in booking → **Visit** opens.
2. **Doctor form** — quick assessment (30 seconds).
3. **Therapist record** — treatment lines, areas.
4. **Photos / mapping** — one before photo or face map tap.
5. **Consent** — show signed or pending state.

**Talk track:** "Clinical data stays structured — not lost in WhatsApp chats."

---

## 4:30 — Invoice & package (2 min)

1. **Invoice** from visit — line items, payment method.
2. Show **patient package**: purchase 10 sessions → redeem 1 on this visit.
3. Optional: receipt print preview.

**Talk track:** "Billing ties to the visit; packages track balance automatically."

---

## 6:30 — Commission & reports (1.5 min)

1. **Staff → Commission** — rule example (% of treatment).
2. **Reports** overview — revenue MTD, top treatments (Complete plan).
3. If Starter plan demo: "Reports unlock on Clinic/Complete."

---

## 8:00 — Public booking (1 min)

1. Open **`/book/{slug}`** on phone or narrow browser.
2. Pick treatment, date, slot → submit.
3. Show booking appear in FO calendar.

**Talk track:** "Patients book 24/7; you control which treatments are online."

---

## 9:00 — Super Admin & commercial (1 min)

*(Switch to platform admin or screenshot)*

1. **Customers pipeline** — trial health score, follow-up date.
2. **Payments queue** — verify bank transfer in one click.
3. Plans: Starter / Clinic / Complete.

**Close:**

> "You start on a 14-day trial with full features. We verify bank transfer manually — no payment gateway lock-in. Ready to spin up your clinic in five minutes?"

---

## Demo checklist (internal)

- [ ] Demo clinic flagged `is_test_clinic`
- [ ] At least 2 performers with schedule
- [ ] 1 package with balance on demo patient
- [ ] Public booking slug works on mobile
- [ ] SA payment approve tested once this week
- [ ] Reset demo data if previous prospect used clinic

## Objection handlers

| Objection | Response |
|-----------|----------|
| "We use WhatsApp only" | WA templates + public booking link; keep WA, add structure |
| "Too expensive" | Starter for small teams; compare to lost no-shows |
| "Staff won't adopt" | Role-based dashboards — each role sees only their queue |
| "Data security?" | Tenant isolation, audit log, no auto-export of PHI |
