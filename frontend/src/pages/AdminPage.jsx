import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import api, { API_BASE } from "@/lib/api";
import { useSettings, logoUrl } from "@/lib/settings";
import { useClinic, hasFeature } from "@/lib/clinic";
import { useAuth, hasPermission } from "@/lib/auth";
import { toast } from "sonner";
import { Settings, Stethoscope, Heart, Pill, MapPin, Plus, Trash2, Upload, RefreshCw, CalendarClock, Calendar as CalendarIcon, Award, Tag, ChevronDown, ChevronUp, MoreHorizontal, Edit2, CreditCard, MessageSquare, Shield, Percent } from "lucide-react";
import { FeatureRoute } from "@/components/FeatureGate";
import CommissionSettingsPanel from "@/components/commission/CommissionSettingsPanel";
import BrandingThemePreview from "@/components/settings/BrandingThemePreview";
import { applyBrandingTheme, brandingBaseForSave, resolveBrandingTheme } from "@/lib/clinicTheme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TAB_ALIASES = {
  "business-hours": "schedule",
  online_booking_payment: "online-booking-payment",
};

function buildGeneralSettingsTabs(user, clinic) {
  const isOwner = user?.role === "super_admin";
  const tabs = [];
  if (isOwner) {
    tabs.push({ key: "branding", label: "Branding", icon: Settings });
  }
  tabs.push({ key: "schedule", label: "Business Hours", icon: CalendarClock });
  if (hasPermission(user, "commission.manage") && hasFeature(clinic, "commissions")) {
    tabs.push({ key: "commission", label: "Commissions", icon: Percent });
  }
  if (
    isOwner
    && (hasPermission(user, "billing.manage") || hasPermission(user, "settings.manage"))
    && hasFeature(clinic, "online_booking_payment")
  ) {
    tabs.push({ key: "online-booking-payment", label: "Online Payment", icon: CreditCard });
  }
  if (isOwner) {
    tabs.push({ key: "security", label: "Security", icon: Shield });
  }
  return tabs;
}

export default function AdminPage() {
  const { user } = useAuth();
  const { clinic } = useClinic();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOwner = user?.role === "super_admin";
  const TABS = useMemo(() => buildGeneralSettingsTabs(user, clinic), [user, clinic]);
  const tabFromUrl = searchParams.get("tab");
  const resolvedTab = TAB_ALIASES[tabFromUrl] || tabFromUrl;
  const initialTab = TABS.some((t) => t.key === resolvedTab) ? resolvedTab : (TABS[0]?.key || "schedule");
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    if (resolvedTab && TABS.some((t) => t.key === resolvedTab)) {
      setTab(resolvedTab);
    } else if (!TABS.some((t) => t.key === tab)) {
      setTab(TABS[0]?.key || "schedule");
    }
  }, [resolvedTab, TABS, tab]);

  const selectTab = (key) => {
    setTab(key);
    setSearchParams({ tab: key }, { replace: true });
  };

  const canCommission = hasPermission(user, "commission.manage") && hasFeature(clinic, "commissions");
  const canOnlinePayment = isOwner
    && (hasPermission(user, "billing.manage") || hasPermission(user, "settings.manage"))
    && hasFeature(clinic, "online_booking_payment");

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl" data-testid="general-settings-page">
      <div className="label-eyebrow">Settings</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">General Settings</h1>
      <p className="mt-2 text-sm text-[#5C6C62] max-w-2xl">
        Core clinic-wide settings for branding, business hours, commissions, online payments, and security.
      </p>

      <div
        className="mt-7 border-b border-[#EAE6D7] flex gap-1 overflow-x-auto pb-px -mx-1 px-1"
        data-testid="admin-tabs"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              className={`px-3 sm:px-4 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 transition ${active ? "text-[#2D3A33]" : "border-transparent text-[#5C6C62] hover:text-[#2D3A33]"}`}
              style={active ? { borderColor: "var(--bl-primary)" } : { borderColor: "transparent" }}
              data-testid={`admin-tab-${t.key}`}
            >
              <Icon className="w-4 h-4 shrink-0 opacity-80" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="mt-7">
        {tab === "branding" && isOwner && <BrandingTab />}
        {tab === "schedule" && <ScheduleTab />}
        {tab === "commission" && canCommission && (
          <FeatureRoute feature="commissions"><CommissionSettingsPanel /></FeatureRoute>
        )}
        {tab === "online-booking-payment" && canOnlinePayment && (
          <FeatureRoute feature="online_booking_payment"><OnlineBookingPaymentTab /></FeatureRoute>
        )}
        {tab === "security" && isOwner && <SecuritySettingsTab />}
      </div>
    </div>
  );
}

/* ---------------- Shared helpers ---------------- */
function CollapsibleAdvanced({ title = "Advanced", children, testid }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs text-[#5C6C62] hover:text-[#2D3A33] inline-flex items-center gap-1"
        data-testid={testid}
      >
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {title}
      </button>
      {open && <div className="mt-2 pl-1">{children}</div>}
    </div>
  );
}

function OptionChipsEditor({ options = [], onChange, testid }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!options.includes(v)) onChange([...options, v]);
    setDraft("");
  };
  return (
    <div data-testid={testid}>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {options.map((opt) => (
          <span key={opt} className="inline-flex items-center gap-1 bl-chip text-xs py-1 px-2">
            {opt}
            <button
              type="button"
              onClick={() => onChange(options.filter((o) => o !== opt))}
              className="text-[#5C6C62] hover:text-[#B14A2C]"
              aria-label={`Remove ${opt}`}
            >
              ×
            </button>
          </span>
        ))}
        {!options.length && <span className="text-xs text-[#5C6C62]">No options yet</span>}
      </div>
      <div className="flex gap-2">
        <input
          className="bl-input flex-1 text-sm py-1.5"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add option…"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button type="button" onClick={add} className="bl-btn-ghost text-xs px-3">Add</button>
      </div>
    </div>
  );
}

function moveArrayItem(arr, i, dir) {
  const next = [...arr];
  const j = i + dir;
  if (j < 0 || j >= next.length) return arr;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function confirmAction(message, action) {
  if (window.confirm(message)) action();
}

/* ---------------- Branding ---------------- */
function normalizeBookingSlug(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function BrandingTab() {
  const { settings, branding, refresh } = useSettings();
  const { clinic, refresh: refreshClinic } = useClinic();
  const [b, setB] = useState(branding);
  const [bookingSlug, setBookingSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => { setB(branding); }, [branding]);
  useEffect(() => {
    if (clinic?.slug) setBookingSlug(clinic.slug);
  }, [clinic?.slug]);

  const resolvedTheme = useMemo(() => resolveBrandingTheme(b), [b]);

  useEffect(() => {
    applyBrandingTheme(b);
  }, [b]);

  const slugPreview = normalizeBookingSlug(bookingSlug) || "your-clinic";
  const publicBookingUrl = `${window.location.origin}/book/${slugPreview}`;

  const baseColorFields = [
    { k: "primary_color", label: "Primary", hint: "Buttons, active nav, tabs, links, focus" },
    { k: "accent_color", label: "Accent", hint: "Tagline, badges, decorative highlights" },
    { k: "background", label: "Background", hint: "Page background" },
    { k: "surface", label: "Surface", hint: "Cards, modals, panels" },
    { k: "text_primary", label: "Text", hint: "Primary readable text" },
  ];

  const sidebarColorFields = [
    { k: "sidebar_background", label: "Sidebar Background", hint: "Main navigation sidebar background" },
    { k: "sidebar_active", label: "Sidebar Active", hint: "Active item and expanded Settings background" },
  ];

  const derivedPreview = [
    { k: "primary_hover", label: "Primary hover" },
    { k: "primary_soft", label: "Primary soft" },
    { k: "primary_contrast", label: "Primary contrast" },
    { k: "border_color", label: "Border" },
    { k: "muted_text", label: "Muted text" },
    { k: "link_color", label: "Link" },
    { k: "sidebar_text", label: "Sidebar text" },
    { k: "sidebar_muted_text", label: "Sidebar muted" },
    { k: "sidebar_active_text", label: "Sidebar active text" },
    { k: "sidebar_border", label: "Sidebar border" },
    { k: "sidebar_hover", label: "Sidebar hover" },
    { k: "action_secondary_bg", label: "Secondary action bg" },
  ];

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/admin/settings", { branding: brandingBaseForSave(b), booking_slug: bookingSlug });
      toast.success("Branding updated");
      await refresh();
      await refreshClinic();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const reset = () => {
    setB(branding);
    setBookingSlug(clinic?.slug || "");
  };

  const onLogo = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    try {
      await api.post("/admin/logo", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Logo uploaded");
      await refresh();
    } catch (err) { toast.error(err?.response?.data?.detail || "Logo upload failed"); }
    e.target.value = "";
  };

  if (!settings) return <div className="text-[#5C6C62]">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl" data-testid="branding-form">
      <div className="bl-card p-5">
        <div className="font-display text-lg mb-4 text-[#2D3A33]">Clinic identity</div>
        <div className="space-y-4">
          <div>
            <label className="label-eyebrow block mb-2">Clinic name</label>
            <input className="bl-input" value={b.clinic_name || ""} onChange={(e)=>setB({...b, clinic_name: e.target.value})} data-testid="branding-clinic-name" />
          </div>
          <div>
            <label className="label-eyebrow block mb-2">Tagline</label>
            <input className="bl-input" value={b.tagline || ""} onChange={(e)=>setB({...b, tagline: e.target.value})} data-testid="branding-tagline" />
            <p className="text-xs text-[#5C6C62] mt-2">Shown in the staff sidebar and on your public appointment page.</p>
          </div>
          <div>
            <label className="label-eyebrow block mb-2">Public appointment URL</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[#5C6C62] shrink-0">/book/</span>
              <input
                className="bl-input flex-1 font-mono text-sm"
                value={bookingSlug}
                onChange={(e) => setBookingSlug(normalizeBookingSlug(e.target.value))}
                placeholder="your-clinic"
                data-testid="branding-booking-slug"
              />
            </div>
            <p className="text-xs text-[#5C6C62] mt-2 break-all">
              Patients book at <span className="font-mono text-[#2D3A33]">{publicBookingUrl}</span>. Lowercase letters, numbers, and hyphens only. Old links stop working after you change this.
            </p>
          </div>
          <div>
            <label className="label-eyebrow block mb-2">Logo</label>
            <div className="flex items-center gap-4">
              {b.logo_path ? (
                <img src={logoUrl(b.logo_path)} alt="logo" className="w-16 h-16 rounded-xl object-cover border border-[#EAE6D7]" />
              ) : (
                <div className="w-16 h-16 rounded-xl border border-dashed border-[#EAE6D7] flex items-center justify-center text-[#5C6C62] text-xs">No logo</div>
              )}
              <label className="bl-btn-ghost inline-flex items-center gap-2 cursor-pointer" data-testid="branding-logo-upload">
                <Upload className="w-4 h-4" /> Upload logo
                <input type="file" accept="image/*" onChange={onLogo} className="hidden" />
              </label>
              {b.logo_path && (
                <button onClick={()=>setB({...b, logo_path: ""})} className="text-sm text-[#B14A2C]">Remove</button>
              )}
            </div>
            <p className="text-xs text-[#5C6C62] mt-2">PNG, JPG, WebP, or SVG. Logo is shown on login + sidebar.</p>
          </div>
        </div>
      </div>

      <div className="bl-card p-5">
        <div className="font-display text-lg mb-1 text-[var(--bl-text)]">Theme colors</div>
        <p className="text-sm text-[var(--bl-muted-text)] mb-4">
          Set a small group of colors — related UI elements update automatically. Status colors (success, warning, appointments) stay fixed.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {baseColorFields.map((c) => (
            <div key={c.k}>
              <label className="label-eyebrow block mb-2">{c.label}</label>
              <div className="flex items-center gap-2">
                <input type="color" className="w-12 h-10 rounded-lg border border-[var(--bl-border)] cursor-pointer" value={resolvedTheme[c.k] || "#000000"} onChange={(e) => setB({ ...b, [c.k]: e.target.value })} />
                <input className="bl-input flex-1 font-mono text-sm" value={b[c.k] || resolvedTheme[c.k] || ""} onChange={(e) => setB({ ...b, [c.k]: e.target.value })} data-testid={`branding-${c.k}`} />
              </div>
              <p className="text-[11px] text-[var(--bl-muted-text)] mt-1.5">{c.hint}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-5 border-t border-[var(--bl-border)]">
          <div className="font-display text-base mb-1 text-[var(--bl-text)]">Sidebar</div>
          <p className="text-sm text-[var(--bl-muted-text)] mb-4">Controls the main navigation sidebar colors.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sidebarColorFields.map((c) => (
              <div key={c.k}>
                <label className="label-eyebrow block mb-2">{c.label}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    className="w-12 h-10 rounded-lg border border-[var(--bl-border)] cursor-pointer"
                    value={c.k === "sidebar_background" ? resolvedTheme.sidebar_bg : resolvedTheme.sidebar_active_resolved}
                    onChange={(e) => setB({ ...b, [c.k]: e.target.value })}
                  />
                  <input
                    className="bl-input flex-1 font-mono text-sm"
                    value={b[c.k] || ""}
                    placeholder={c.k === "sidebar_background" ? resolvedTheme.sidebar_bg : resolvedTheme.sidebar_active_resolved}
                    onChange={(e) => setB({ ...b, [c.k]: e.target.value })}
                    data-testid={`branding-${c.k}`}
                  />
                </div>
                <p className="text-[11px] text-[var(--bl-muted-text)] mt-1.5">{c.hint}</p>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="mt-4 text-sm text-[var(--bl-link)] hover:underline inline-flex items-center gap-1"
          onClick={() => setShowAdvanced((v) => !v)}
          data-testid="branding-advanced-toggle"
        >
          {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          Advanced theme colors (auto-generated)
        </button>

        {showAdvanced && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl border border-[var(--bl-border)] bg-[var(--bl-background)]" data-testid="branding-derived-colors">
            {derivedPreview.map((c) => (
              <div key={c.k} className="flex items-center gap-2 text-sm">
                <span className="w-8 h-8 rounded-lg border border-[var(--bl-border)] shrink-0" style={{ background: resolvedTheme[c.k] }} />
                <div>
                  <div className="text-[var(--bl-text)]">{c.label}</div>
                  <div className="font-mono text-xs text-[var(--bl-muted-text)]">{resolvedTheme[c.k]}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <BrandingThemePreview branding={b} />

      <div className="flex gap-3">
        <button onClick={save} disabled={busy} className="bl-btn-primary" data-testid="branding-save">{busy ? "Saving…" : "Save branding"}</button>
        <button onClick={reset} className="bl-btn-ghost">Reset</button>
      </div>
    </div>
  );
}

/* ---------------- Users ---------------- */
function UsersTab() {
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(null); // null | 'create' | userObj
  const [form, setForm] = useState({ email: "", name: "", role: "doctor", password: "" });

  const load = async () => {
    const r = await api.get("/users");
    setUsers(r.data);
  };
  useEffect(() => { load(); }, []);

  const startCreate = () => { setForm({ email: "", name: "", role: "doctor", password: "" }); setOpen("create"); };
  const startEdit = (u) => { setForm({ email: u.email, name: u.name, role: u.role, password: "" }); setOpen(u); };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (open === "create") {
        await api.post("/admin/users", form);
        toast.success("User created");
      } else {
        await api.put(`/admin/users/${open.id}`, form);
        toast.success("User updated");
      }
      setOpen(null);
      await load();
    } catch (err) { toast.error(err?.response?.data?.detail || "Failed"); }
  };

  const del = async (u) => {
    if (!window.confirm(`Delete ${u.email}?`)) return;
    try { await api.delete(`/admin/users/${u.id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-[#5C6C62]">{users.length} user{users.length !== 1 ? "s" : ""}</div>
        <button onClick={startCreate} className="bl-btn-primary inline-flex items-center gap-2" data-testid="user-create-button">
          <Plus className="w-4 h-4" /> Add user
        </button>
      </div>
      <div className="bl-card table-card overflow-hidden" data-testid="users-table">
        <div className="overflow-x-auto">
          <table className="bl-data-table w-full">
            <thead className="bl-data-table-head">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td className="px-5 py-3 font-medium">{u.name}</td>
                  <td className="px-5 py-3 text-[#5C6C62]">{u.email}</td>
                  <td className="px-5 py-3"><span className="bl-chip muted capitalize">{u.role.replace("_"," ")}</span></td>
                  <td className="px-5 py-3 text-right space-x-3">
                    <button onClick={()=>startEdit(u)} className="text-sm text-[#5C6C62] hover:text-[#2D3A33]" data-testid={`user-edit-${u.id}`}>Edit</button>
                    <button onClick={()=>del(u)} className="text-sm text-[#B14A2C]" data-testid={`user-delete-${u.id}`}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 bg-[#2D3A33]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={()=>setOpen(null)}>
          <form onClick={(e)=>e.stopPropagation()} onSubmit={save} className="bl-card max-w-md w-full p-6 space-y-4" data-testid="user-form">
            <h2 className="font-display text-2xl">{open === "create" ? "Add user" : "Edit user"}</h2>
            <div>
              <label className="label-eyebrow block mb-1">Full name</label>
              <input required className="bl-input" value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} />
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Email</label>
              <input required type="email" className="bl-input" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})} />
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Role</label>
              <select className="bl-input" value={form.role} onChange={(e)=>setForm({...form,role:e.target.value})}>
                <option value="super_admin">Super Admin</option>
                <option value="doctor">Doctor</option>
                <option value="therapist">Therapist</option>
                <option value="fo">Front desk</option>
                <option value="manager">Manager</option>
              </select>
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Password {open !== "create" && "(leave blank to keep)"}</label>
              <input type="password" className="bl-input" required={open === "create"} value={form.password} onChange={(e)=>setForm({...form,password:e.target.value})} />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" className="bl-btn-primary" data-testid="user-save">Save</button>
              <button type="button" onClick={()=>setOpen(null)} className="bl-btn-ghost">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/* ---------------- Doctor Form ---------------- */
function DoctorFormTab() {
  const { settings, refresh } = useSettings();
  const [sections, setSections] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSections(settings?.form_config?.face_sections || []); }, [settings?.form_config?.face_sections]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/admin/settings", { form_config: { ...settings.form_config, face_sections: sections } });
      toast.success("Doctor form saved");
      await refresh();
    } catch (e) { toast.error("Failed"); }
    finally { setBusy(false); }
  };

  const updateSection = (i, patch) => setSections(sections.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const updateSub = (si, ji, patch) => setSections(sections.map((s, idx) => idx === si
    ? { ...s, subs: s.subs.map((sub, jdx) => jdx === ji ? { ...sub, ...patch } : sub) }
    : s));

  const addSection = () => setSections([...sections, { key: `section_${Date.now()}`, label: "New section", subs: [{ key: `sub_${Date.now()}`, label: "New question", options: ["Yes", "No"] }] }]);
  const removeSection = (i) => confirmAction("Remove this section and all its questions?", () => setSections(sections.filter((_, idx) => idx !== i)));
  const addSub = (si) => updateSection(si, { subs: [...sections[si].subs, { key: `sub_${Date.now()}`, label: "New question", options: ["Yes", "No"] }] });
  const removeSub = (si, ji) => confirmAction("Remove this sub-question?", () => updateSection(si, { subs: sections[si].subs.filter((_, idx) => idx !== ji) }));

  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-sm text-[#5C6C62]">
        Build the doctor&apos;s face assessment form. Each section groups related questions shown as selectable chips during visits.
      </p>
      <div className="space-y-4" data-testid="doctor-form-editor">
        {sections.map((sec, i) => (
          <div key={i} className="bl-card p-5 space-y-4">
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex-1 min-w-[200px]">
                <label className="label-eyebrow block mb-1.5">Section title</label>
                <input className="bl-input font-medium" value={sec.label} onChange={(e) => updateSection(i, { label: e.target.value })} placeholder="e.g. Skin quality" />
              </div>
              <div className="flex items-end gap-1 pt-5">
                <button type="button" onClick={() => setSections(moveArrayItem(sections, i, -1))} className="text-xs text-[#5C6C62] px-2 py-1.5 rounded hover:bg-[#F3F1EB]" title="Move up">↑</button>
                <button type="button" onClick={() => setSections(moveArrayItem(sections, i, 1))} className="text-xs text-[#5C6C62] px-2 py-1.5 rounded hover:bg-[#F3F1EB]" title="Move down">↓</button>
                <button type="button" onClick={() => removeSection(i)} className="text-[#B14A2C] p-1.5 hover:bg-[#FAE5DC] rounded-lg" title="Delete section"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            <CollapsibleAdvanced title="Advanced — section key" testid={`doctor-section-adv-${i}`}>
              <label className="label-eyebrow block mb-1.5">Section key</label>
              <input className="bl-input font-mono text-sm max-w-xs" value={sec.key} onChange={(e) => updateSection(i, { key: e.target.value })} placeholder="section_key" />
              <p className="text-xs text-[#5C6C62] mt-1">Used internally to store answers. Change only if you know existing session record data should migrate.</p>
            </CollapsibleAdvanced>

            <div className="space-y-3 pt-2 border-t border-[#EAE6D7]">
              <div className="label-eyebrow text-[#5C6C62]">Sub-questions</div>
              {sec.subs.map((sub, j) => (
                <div key={j} className="rounded-xl border border-[#EAE6D7] bg-[#FDFBF7] p-4 space-y-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="flex-1 min-w-[180px]">
                      <label className="label-eyebrow block mb-1.5">Question label</label>
                      <input className="bl-input text-sm" value={sub.label} onChange={(e) => updateSub(i, j, { label: e.target.value })} placeholder="e.g. Thickness" />
                    </div>
                    <div className="flex items-end gap-1 pt-5">
                      <button type="button" onClick={() => updateSection(i, { subs: moveArrayItem(sec.subs, j, -1) })} className="text-xs text-[#5C6C62] px-2 py-1.5 rounded hover:bg-[#F3F1EB]">↑</button>
                      <button type="button" onClick={() => updateSection(i, { subs: moveArrayItem(sec.subs, j, 1) })} className="text-xs text-[#5C6C62] px-2 py-1.5 rounded hover:bg-[#F3F1EB]">↓</button>
                      <button type="button" onClick={() => removeSub(i, j)} className="text-[#B14A2C] p-1.5 hover:bg-[#FAE5DC] rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  <div>
                    <label className="label-eyebrow block mb-1.5">Answer options</label>
                    <OptionChipsEditor options={sub.options || []} onChange={(opts) => updateSub(i, j, { options: opts })} testid={`doctor-sub-options-${i}-${j}`} />
                  </div>
                  <CollapsibleAdvanced title="Advanced — question key" testid={`doctor-sub-adv-${i}-${j}`}>
                    <input className="bl-input font-mono text-sm max-w-xs" value={sub.key} onChange={(e) => updateSub(i, j, { key: e.target.value })} placeholder="question_key" />
                  </CollapsibleAdvanced>
                </div>
              ))}
              <button type="button" onClick={() => addSub(i)} className="text-sm text-[#5C6C62] hover:text-[#2D3A33] inline-flex items-center gap-1">
                <Plus className="w-4 h-4" /> Add sub-question
              </button>
            </div>
          </div>
        ))}
        <button type="button" onClick={addSection} className="bl-btn-ghost inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Add section</button>
      </div>
      <div className="flex justify-end sticky bottom-4 pt-2">
        <button onClick={save} disabled={busy} className="bl-btn-primary shadow-lg disabled:opacity-50" data-testid="doctor-form-save">{busy ? "Saving…" : "Save doctor form"}</button>
      </div>
    </div>
  );
}

/* ---------------- Therapist Form ---------------- */
function TherapistFormTab() {
  const { settings, refresh } = useSettings();
  const [contraindications, setContras] = useState([]);
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    if (!settings?.form_config) return;
    setContras(settings.form_config.contraindications || []);
    setDevices(settings.form_config.devices || []);
  }, [settings?.form_config]);

  const save = async () => {
    try {
      await api.put("/admin/settings", { form_config: { ...settings.form_config, contraindications, devices } });
      toast.success("Therapist form saved");
      await refresh();
    } catch (e) { toast.error("Failed"); }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <p className="text-sm text-[#5C6C62]">
        Configure checklist items and devices shown on the therapist treatment notes form during treatment sessions.
      </p>
      <ListEditor title="Contraindication checklist" items={contraindications} setItems={setContras} placeholder="e.g. Pregnancy" testid="contra" confirmRemove editable />
      <ListEditor title="Devices / Machines" items={devices} setItems={setDevices} placeholder="e.g. RF (Radio Frequency)" testid="device" confirmRemove editable />
      <div className="flex justify-end sticky bottom-4">
        <button onClick={save} className="bl-btn-primary shadow-lg" data-testid="therapist-form-save">Save therapist form</button>
      </div>
    </div>
  );
}

/* ---------------- Treatment ---------------- */
function TreatmentTab({ section = "both" }) {
  const { settings, refresh } = useSettings();
  const [categories, setCats] = useState([]);
  const [units, setUnits] = useState([]);

  useEffect(() => {
    if (!settings?.form_config) return;
    setCats(settings.form_config.treatment_categories || []);
    setUnits(settings.form_config.treatment_units || []);
  }, [settings?.form_config]);

  const save = async () => {
    try {
      await api.put("/admin/settings", { form_config: { ...settings.form_config, treatment_categories: categories, treatment_units: units } });
      toast.success("Saved");
      await refresh();
    } catch (e) { toast.error("Failed"); }
  };

  const showCategories = section === "both" || section === "categories";
  const showUnits = section === "both" || section === "units";

  return (
    <div className="space-y-6 max-w-3xl">
      {section === "both" && (
        <p className="text-sm text-[#5C6C62]">
          Manage reusable catalog options used across treatments, packages, and session records.
        </p>
      )}
      {showCategories && (
        <ListEditor title="Treatment categories" items={categories} setItems={setCats} placeholder="e.g. Injectable" testid="cat" confirmRemove />
      )}
      {showUnits && (
        <ListEditor title="Unit types" items={units} setItems={setUnits} placeholder="e.g. ml" testid="unit" confirmRemove />
      )}
      <div className="flex justify-end sticky bottom-4">
        <button onClick={save} className="bl-btn-primary shadow-lg" data-testid="treatment-form-save">Save catalog settings</button>
      </div>
    </div>
  );
}

function TreatmentCategoriesTab() {
  return <TreatmentTab section="categories" />;
}

function UnitTypesTab() {
  return <TreatmentTab section="units" />;
}

/* ---------------- Mapping templates ---------------- */
function MappingTab() {
  const { settings, refresh } = useSettings();
  const [templates, setTemplates] = useState({});

  useEffect(() => { setTemplates(settings?.mapping_templates || {}); }, [settings?.mapping_templates]);

  const updateTpl = (k, field, v) => setTemplates({ ...templates, [k]: { ...templates[k], [field]: v } });
  const addTpl = () => {
    const k = window.prompt("Template key (e.g. 'side_view')"); if (!k) return;
    setTemplates({ ...templates, [k]: { label: k, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"></svg>' } });
  };
  const removeTpl = (k) => confirmAction(`Remove mapping template "${templates[k]?.label || k}"?`, () => {
    const next = { ...templates };
    delete next[k];
    setTemplates(next);
  });
  const reset = () => { if (window.confirm("Reload templates from server?")) refresh(); };

  const uploadImage = async (key, file) => {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await api.post("/admin/template-image", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setTemplates(prev => ({ ...prev, [key]: { ...prev[key], image_path: r.data.image_path, svg: "" } }));
      toast.success("Image uploaded — remember to save");
    } catch (e) { toast.error(e?.response?.data?.detail || "Template image upload failed"); }
  };

  const save = async () => {
    try {
      await api.put("/admin/settings", { mapping_templates: templates });
      toast.success("Templates saved");
      await refresh();
    } catch (e) { toast.error("Failed"); }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <p className="text-sm text-[#5C6C62]">
        Upload a template image for the mapping canvas. SVG fallback is optional.
      </p>
      <div className="space-y-4" data-testid="mapping-editor">
        {Object.entries(templates).map(([key, tpl]) => (
          <div key={key} className="bl-card p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="font-display text-base text-[#2D3A33]">{tpl.label || key}</div>
                <div className="text-xs font-mono text-[#5C6C62]">{key}</div>
              </div>
              <button type="button" onClick={() => removeTpl(key)} className="text-[#B14A2C] p-1.5 hover:bg-[#FAE5DC] rounded-lg" title="Remove template"><Trash2 className="w-4 h-4" /></button>
            </div>

            <div>
              <label className="label-eyebrow block mb-1.5">Display name</label>
              <input className="bl-input max-w-md" value={tpl.label || ""} onChange={(e) => updateTpl(key, "label", e.target.value)} placeholder="Display label" />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="bl-btn-ghost inline-flex items-center gap-2 cursor-pointer text-sm" data-testid={`tpl-image-upload-${key}`}>
                <Upload className="w-4 h-4" /> {tpl.image_path ? "Replace image" : "Upload PNG / JPG / WebP"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => uploadImage(key, e.target.files?.[0])} />
              </label>
              {tpl.image_path && (
                <button type="button" onClick={() => updateTpl(key, "image_path", "")} className="text-sm text-[#B14A2C]">Remove image</button>
              )}
            </div>

            <div>
              <div className="label-eyebrow mb-1.5">Preview</div>
              <div className="bg-[#FBF8EF] rounded-xl border border-[#EAE6D7] flex items-center justify-center p-4 min-h-[180px]">
                {tpl.image_path ? (
                  <img src={`${API_BASE}/files/${tpl.image_path}`} alt={tpl.label} className="max-h-56 object-contain" />
                ) : tpl.svg ? (
                  <div className="max-h-56" dangerouslySetInnerHTML={{ __html: tpl.svg }} />
                ) : (
                  <span className="text-sm text-[#5C6C62]">No template preview yet.</span>
                )}
              </div>
            </div>

            <CollapsibleAdvanced title="Advanced SVG fallback" testid={`mapping-svg-adv-${key}`}>
              <textarea
                className="bl-input min-h-[140px] font-mono text-xs w-full"
                value={tpl.svg || ""}
                onChange={(e) => updateTpl(key, "svg", e.target.value)}
                placeholder="<svg ...>"
                disabled={!!tpl.image_path}
              />
              {tpl.image_path && <p className="text-xs text-[#5C6C62] mt-1">Uploaded image takes precedence over SVG.</p>}
            </CollapsibleAdvanced>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 sticky bottom-4 bg-[#FDFBF7]/90 backdrop-blur py-2">
        <button type="button" onClick={addTpl} className="bl-btn-ghost inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Add template</button>
        <button type="button" onClick={reset} className="bl-btn-ghost inline-flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Reload from server</button>
        <button type="button" onClick={save} className="bl-btn-primary ml-auto shadow-lg" data-testid="mapping-templates-save">Save mapping templates</button>
      </div>
    </div>
  );
}

/* ---------------- Generic List Editor ---------------- */
function ListEditor({ title, items, setItems, placeholder, testid, confirmRemove = false, editable = false }) {
  const [draft, setDraft] = useState("");
  const [editingIdx, setEditingIdx] = useState(null);
  const [editValue, setEditValue] = useState("");

  const add = (e) => {
    e.preventDefault?.();
    if (!draft.trim()) return;
    setItems([...items, draft.trim()]); setDraft("");
  };

  const startEdit = (i) => {
    setEditingIdx(i);
    setEditValue(items[i]);
  };

  const cancelEdit = () => {
    setEditingIdx(null);
    setEditValue("");
  };

  const commitEdit = () => {
    if (editingIdx === null) return;
    const v = editValue.trim();
    if (!v) {
      toast.error("Item cannot be empty");
      return;
    }
    setItems(items.map((it, idx) => (idx === editingIdx ? v : it)));
    cancelEdit();
  };

  const remove = (i) => {
    const doRemove = () => {
      setItems(items.filter((_, idx) => idx !== i));
      if (editingIdx === i) cancelEdit();
    };
    if (confirmRemove) confirmAction(`Remove "${items[i]}"?`, doRemove);
    else doRemove();
  };

  const move = (i, dir) => {
    const next = [...items];
    const j = i + dir; if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
    if (editingIdx === i) setEditingIdx(j);
    else if (editingIdx === j) setEditingIdx(i);
  };

  return (
    <div className="bl-card p-5">
      <div className="font-display text-base text-[#2D3A33] mb-3">{title}</div>
      <div className="space-y-2 mb-4">
        {items.length === 0 && <div className="text-sm text-[#5C6C62]">No items yet</div>}
        {items.map((it, i) => (
          <div key={`${testid}-${i}-${it}`} className="flex items-center gap-2 bg-[#F8F5EC] px-3 py-2 rounded-lg" data-testid={`${testid}-item-${i}`}>
            {editable && editingIdx === i ? (
              <>
                <input
                  className="bl-input flex-1 text-sm py-1.5"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                    if (e.key === "Escape") cancelEdit();
                  }}
                  autoFocus
                  data-testid={`${testid}-edit-input-${i}`}
                />
                <button type="button" onClick={commitEdit} className="text-xs text-[#52796F] px-2 font-medium">Save</button>
                <button type="button" onClick={cancelEdit} className="text-xs text-[#5C6C62] px-2">Cancel</button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm">{it}</span>
                {editable && (
                  <button type="button" onClick={() => startEdit(i)} className="text-[#5C6C62] hover:text-[#2D3A33] p-1" title="Edit" data-testid={`${testid}-edit-${i}`}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button type="button" onClick={() => move(i, -1)} className="text-xs text-[#5C6C62] px-2" title="Move up">↑</button>
                <button type="button" onClick={() => move(i, 1)} className="text-xs text-[#5C6C62] px-2" title="Move down">↓</button>
                <button type="button" onClick={() => remove(i)} className="text-[#B14A2C] p-1" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
              </>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={add} className="flex gap-2">
        <input className="bl-input flex-1" value={draft} onChange={(e)=>setDraft(e.target.value)} placeholder={placeholder} data-testid={`${testid}-input`} />
        <button type="submit" className="bl-btn-ghost inline-flex items-center gap-2" data-testid={`${testid}-add`}><Plus className="w-4 h-4" /> Add</button>
      </form>
    </div>
  );
}

/* ---------------- Schedule (booking slot interval) ---------------- */

const SLOT_PRESETS = [5, 10, 15, 20, 30, 45, 60];
const DAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

function ScheduleTab() {
  const { clinic, refresh } = useClinic();
  const [interval, setInterval] = useState(30);
  const [hours, setHours] = useState({});
  const [closedDates, setClosedDates] = useState([]);
  const [newDate, setNewDate] = useState("");
  const [newReason, setNewReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clinic) return;
    if (clinic.booking_slot_interval) setInterval(clinic.booking_slot_interval);
    setHours(clinic.operating_hours || {});
    setClosedDates(clinic.closed_dates || []);
  }, [clinic?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!clinic) return <div className="text-[#5C6C62]">Loading…</div>;

  const isCustom = !SLOT_PRESETS.includes(Number(interval));

  const setDayField = (day, field, value) => {
    setHours(h => ({ ...h, [day]: { ...(h[day] || {}), [field]: value } }));
  };
  const toggleDayClosed = (day) => {
    const cur = hours[day];
    if (cur && cur.open) {
      setHours(h => ({ ...h, [day]: { open: "", close: "" } }));
    } else {
      setHours(h => ({ ...h, [day]: { open: "09:00", close: "20:00" } }));
    }
  };
  const addClosedDate = () => {
    if (!newDate) return;
    if (closedDates.some(d => d.date === newDate)) {
      toast.error("Date already in list");
      return;
    }
    setClosedDates([...closedDates, { date: newDate, reason: newReason }].sort((a, b) => a.date.localeCompare(b.date)));
    setNewDate(""); setNewReason("");
  };
  const removeClosedDate = (d) => setClosedDates(closedDates.filter(x => x.date !== d));

  const save = async () => {
    const n = Number(interval);
    if (!Number.isFinite(n) || n < 5 || n > 240) {
      toast.error("Interval must be between 5 and 240 minutes");
      return;
    }
    // Validate hours
    for (const day of DAYS) {
      const h = hours[day.key];
      if (h && h.open && h.close && h.open >= h.close) {
        toast.error(`${day.label}: opening time must be before closing time`);
        return;
      }
    }
    setBusy(true);
    try {
      await api.put("/clinics/me", {
        booking_slot_interval: n,
        operating_hours: hours,
        closed_dates: closedDates,
      });
      toast.success("Schedule saved");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to update");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6 max-w-3xl" data-testid="schedule-form">
      <div className="bl-card p-5 bg-[#FDFBF7]">
        <div className="font-display text-lg text-[#2D3A33]">Clinic operating hours</div>
        <p className="text-sm text-[#5C6C62] mt-2">
          Set your public appointment hours and clinic-wide closed dates.
        </p>
        <p className="text-xs text-[#5C6C62] mt-2">
          Staff schedules are managed from Staff. These hours only control clinic availability and public appointment windows.
        </p>
      </div>

      {/* --- Slot interval --- */}
      <div className="bl-card p-5">
        <div className="font-display text-lg mb-1 text-[#2D3A33]">Appointment slot interval</div>
        <p className="text-sm text-[#5C6C62] mb-4">
          Time grid shown on the public appointment page and the front desk &quot;New appointment&quot; modal.
          Front desk can still pick any non-standard time via the &quot;Custom time&quot; toggle.
        </p>

        <div className="flex flex-wrap gap-2" data-testid="slot-interval-presets">
          {SLOT_PRESETS.map(n => {
            const active = Number(interval) === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => setInterval(n)}
                className="px-4 py-2 rounded-xl border text-sm font-medium transition"
                style={active
                  ? { borderColor: "var(--bl-primary)", background: "var(--bl-primary-soft)", color: "var(--bl-text)" }
                  : { borderColor: "var(--bl-border)", color: "var(--bl-muted-text)", background: "white" }}
                data-testid={`slot-interval-${n}`}
              >
                {n} min
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          <label className="label-eyebrow block mb-2">Custom interval (minutes)</label>
          <input
            type="number"
            min={5}
            max={240}
            step={1}
            className="bl-input max-w-[180px]"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            data-testid="slot-interval-custom"
          />
          <p className="text-xs text-[#5C6C62] mt-1">
            {isCustom ? "Using a custom interval — between 5 and 240 minutes." : "Tip: enter any number from 5–240 if a preset doesn't fit."}
          </p>
        </div>
      </div>

      {/* --- Operating hours --- */}
      <div className="bl-card p-5" data-testid="operating-hours-card">
        <div className="font-display text-lg mb-1 text-[#2D3A33]">Operating hours</div>
        <p className="text-sm text-[#5C6C62] mb-4">
          Weekly opening and closing times. Toggle off to mark a day as fully closed.
        </p>
        <div className="space-y-2.5">
          {DAYS.map(d => {
            const h = hours[d.key] || { open: "", close: "" };
            const isClosed = !h.open || !h.close;
            return (
              <div key={d.key} className="flex flex-wrap items-center gap-3 py-1" data-testid={`hours-row-${d.key}`}>
                <div className="w-28 text-sm font-medium text-[#2D3A33]">{d.label}</div>
                <button
                  type="button"
                  onClick={() => toggleDayClosed(d.key)}
                  className="text-xs px-3 py-1.5 rounded-lg border font-medium"
                  style={isClosed
                    ? { borderColor: "#EAE6D7", background: "#F3F1EB", color: "#A89F8B" }
                    : { borderColor: "var(--bl-primary)", background: "var(--bl-primary-soft)", color: "var(--bl-text)" }}
                  data-testid={`hours-toggle-${d.key}`}
                >
                  {isClosed ? "Closed" : "Open"}
                </button>
                {!isClosed && (
                  <>
                    <input
                      type="time"
                      className="bl-input max-w-[120px]"
                      value={h.open}
                      onChange={(e) => setDayField(d.key, "open", e.target.value)}
                      data-testid={`hours-open-${d.key}`}
                    />
                    <span className="text-[#A89F8B]">–</span>
                    <input
                      type="time"
                      className="bl-input max-w-[120px]"
                      value={h.close}
                      onChange={(e) => setDayField(d.key, "close", e.target.value)}
                      data-testid={`hours-close-${d.key}`}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* --- Closed dates --- */}
      <div className="bl-card p-5" data-testid="closed-dates-card">
        <div className="font-display text-lg mb-1 text-[#2D3A33]">Closed dates</div>
        <p className="text-sm text-[#5C6C62] mb-4">
          Block appointments on specific dates — holidays, staff trainings, renovations, etc.
        </p>

        {closedDates.length > 0 && (
          <div className="space-y-2 mb-4" data-testid="closed-dates-list">
            {closedDates.map(cd => (
              <div key={cd.date} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-[#EAE6D7] bg-[#FDFBF7]" data-testid={`closed-${cd.date}`}>
                <div className="flex-1">
                  <div className="font-mono text-sm text-[#2D3A33]">{cd.date}</div>
                  {cd.reason && <div className="text-xs text-[#5C6C62] mt-0.5">{cd.reason}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => removeClosedDate(cd.date)}
                  className="text-xs text-[#B14A2C] hover:underline"
                  data-testid={`closed-remove-${cd.date}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[150px]">
            <label className="label-eyebrow block mb-1.5">Date</label>
            <input
              type="date"
              className="bl-input"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              data-testid="closed-new-date"
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="label-eyebrow block mb-1.5">Reason (optional)</label>
            <input
              className="bl-input"
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              placeholder="e.g. Public holiday, staff training…"
              data-testid="closed-new-reason"
            />
          </div>
          <button
            type="button"
            onClick={addClosedDate}
            disabled={!newDate}
            className="bl-btn-ghost text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
            data-testid="closed-add"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>

      {/* --- Save --- */}
      <div className="flex justify-end sticky bottom-4">
        <button onClick={save} disabled={busy} className="bl-btn-primary disabled:opacity-50 shadow-lg" data-testid="schedule-save">
          {busy ? "Saving…" : "Save schedule"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Staff Schedule (per-staff hours + days off) ---------------- */
function StaffScheduleTab() {
  const [staff, setStaff] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [sched, setSched] = useState({ working_hours: {}, days_off: [] });
  const [newOff, setNewOff] = useState({ date: "", reason: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/users").then(r => {
      const list = (r.data || []).filter(u => u.role === "doctor" || u.role === "therapist");
      setStaff(list);
      if (list[0]) setSelectedId(list[0].id);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    api.get(`/users/${selectedId}/schedule`).then(r => {
      setSched({ working_hours: r.data.working_hours || {}, days_off: r.data.days_off || [] });
    });
  }, [selectedId]);

  const setDayField = (day, field, value) => {
    setSched(s => ({ ...s, working_hours: { ...s.working_hours, [day]: { ...(s.working_hours[day] || {}), [field]: value } } }));
  };
  const toggleDay = (day) => {
    const cur = sched.working_hours[day];
    if (cur && cur.open) {
      setSched(s => ({ ...s, working_hours: { ...s.working_hours, [day]: { open: "", close: "" } } }));
    } else {
      setSched(s => ({ ...s, working_hours: { ...s.working_hours, [day]: { open: "09:00", close: "13:00" } } }));
    }
  };
  const addOff = () => {
    if (!newOff.date) return;
    if (sched.days_off.some(x => x.date === newOff.date)) { toast.error("Date already in list"); return; }
    setSched(s => ({ ...s, days_off: [...s.days_off, { date: newOff.date, reason: newOff.reason }].sort((a, b) => a.date.localeCompare(b.date)) }));
    setNewOff({ date: "", reason: "" });
  };
  const removeOff = (d) => setSched(s => ({ ...s, days_off: s.days_off.filter(x => x.date !== d) }));

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/users/${selectedId}/schedule`, sched);
      toast.success("Staff schedule saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally { setBusy(false); }
  };

  if (loading) return <div className="text-[#5C6C62]">Loading…</div>;
  if (staff.length === 0) return <div className="text-[#5C6C62]" data-testid="no-staff">No doctors or therapists configured yet. Add them under Users (owner only).</div>;

  return (
    <div className="max-w-3xl space-y-6" data-testid="staff-schedule-form">
      <div className="bl-card p-5">
        <div className="font-display text-lg mb-1 text-[#2D3A33]">Select staff member</div>
        <p className="text-sm text-[#5C6C62] mb-4">Each doctor or therapist can have personal working hours and days off. Leave a day blank to inherit clinic hours.</p>
        <select className="bl-input max-w-md" value={selectedId} onChange={e => setSelectedId(e.target.value)} data-testid="staff-select">
          {staff.map(s => (
            <option key={s.id} value={s.id}>{s.name} · {s.role}</option>
          ))}
        </select>
      </div>

      <div className="bl-card p-5" data-testid="staff-hours-card">
        <div className="font-display text-lg mb-1 text-[#2D3A33]">Weekly working hours</div>
        <p className="text-sm text-[#5C6C62] mb-4">Empty = inherits clinic hours.</p>
        <div className="space-y-2.5">
          {DAYS.map(d => {
            const h = sched.working_hours[d.key] || { open: "", close: "" };
            const isClosed = !h.open || !h.close;
            return (
              <div key={d.key} className="flex flex-wrap items-center gap-3 py-1" data-testid={`staff-hours-row-${d.key}`}>
                <div className="w-28 text-sm font-medium text-[#2D3A33]">{d.label}</div>
                <button
                  type="button"
                  onClick={() => toggleDay(d.key)}
                  className="text-xs px-3 py-1.5 rounded-lg border font-medium"
                  style={isClosed
                    ? { borderColor: "#EAE6D7", background: "#F3F1EB", color: "#A89F8B" }
                    : { borderColor: "var(--bl-primary)", background: "var(--bl-primary-soft)", color: "var(--bl-text)" }}
                  data-testid={`staff-hours-toggle-${d.key}`}
                >
                  {isClosed ? "Inherit / Off" : "Working"}
                </button>
                {!isClosed && (
                  <>
                    <input type="time" className="bl-input max-w-[120px]" value={h.open} onChange={(e) => setDayField(d.key, "open", e.target.value)} data-testid={`staff-hours-open-${d.key}`} />
                    <span className="text-[#A89F8B]">–</span>
                    <input type="time" className="bl-input max-w-[120px]" value={h.close} onChange={(e) => setDayField(d.key, "close", e.target.value)} data-testid={`staff-hours-close-${d.key}`} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bl-card p-5" data-testid="staff-days-off-card">
        <div className="font-display text-lg mb-1 text-[#2D3A33]">Days off / vacation</div>
        <p className="text-sm text-[#5C6C62] mb-4">This staff member is unavailable on these dates.</p>
        {sched.days_off.length > 0 && (
          <div className="space-y-2 mb-4">
            {sched.days_off.map(o => (
              <div key={o.date} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-[#EAE6D7] bg-[#FDFBF7]" data-testid={`day-off-${o.date}`}>
                <div className="flex-1">
                  <div className="font-mono text-sm text-[#2D3A33]">{o.date}</div>
                  {o.reason && <div className="text-xs text-[#5C6C62] mt-0.5">{o.reason}</div>}
                </div>
                <button type="button" onClick={() => removeOff(o.date)} className="text-xs text-[#B14A2C] hover:underline" data-testid={`day-off-remove-${o.date}`}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[150px]">
            <label className="label-eyebrow block mb-1.5">Date</label>
            <input type="date" className="bl-input" value={newOff.date} onChange={(e) => setNewOff({ ...newOff, date: e.target.value })} data-testid="day-off-new-date" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="label-eyebrow block mb-1.5">Reason (optional)</label>
            <input className="bl-input" value={newOff.reason} onChange={(e) => setNewOff({ ...newOff, reason: e.target.value })} placeholder="e.g. Vacation, training…" data-testid="day-off-new-reason" />
          </div>
          <button type="button" onClick={addOff} disabled={!newOff.date} className="bl-btn-ghost text-sm disabled:opacity-50 inline-flex items-center gap-1.5" data-testid="day-off-add">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>

      <div className="flex justify-end sticky bottom-4">
        <button onClick={save} disabled={busy} className="bl-btn-primary disabled:opacity-50 shadow-lg" data-testid="staff-schedule-save">
          {busy ? "Saving…" : "Save staff schedule"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Loyalty Tiers ---------------- */
const TIER_COLOR_PRESETS = ["#9CA3AF", "#F59E0B", "#7C3AED", "#06B6D4", "#10B981", "#EF4444", "#EC4899"];

const fmtIDRShort = (n) => {
  const v = Number(n || 0);
  if (v >= 1_000_000) return "Rp " + (v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1) + "M";
  if (v >= 1_000) return "Rp " + (v / 1_000).toFixed(0) + "K";
  return "Rp " + v.toLocaleString("id-ID");
};

function LoyaltyTab() {
  const { clinic, refresh } = useClinic();
  const [tiers, setTiers] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (clinic?.loyalty_tiers) setTiers([...clinic.loyalty_tiers]);
  }, [clinic?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!clinic) return <div className="text-[#5C6C62]">Loading…</div>;

  const update = (idx, field, value) => {
    setTiers(t => t.map((x, i) => i === idx ? { ...x, [field]: value } : x));
  };
  const add = () => setTiers(t => [...t, { name: "New tier", min_spend_idr: 0, benefit: "", color: TIER_COLOR_PRESETS[t.length % TIER_COLOR_PRESETS.length] }]);
  const remove = (idx) => confirmAction(`Remove tier "${tiers[idx]?.name}"?`, () => setTiers(t => t.filter((_, i) => i !== idx)));

  const save = async () => {
    for (const t of tiers) {
      if (!(t.name || "").trim()) { toast.error("All tiers need a name"); return; }
      const n = Number(t.min_spend_idr);
      if (!Number.isFinite(n) || n < 0) { toast.error(`${t.name}: minimum spend must be ≥ 0`); return; }
    }
    setBusy(true);
    try {
      await api.put("/clinics/me", { loyalty_tiers: tiers.map(t => ({ ...t, min_spend_idr: Number(t.min_spend_idr) })) });
      toast.success("Loyalty tiers saved");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  const sortedPreview = [...tiers].sort((a, b) => Number(a.min_spend_idr) - Number(b.min_spend_idr));

  return (
    <div className="max-w-3xl space-y-6" data-testid="loyalty-form">
      <div className="bl-card p-5">
        <div className="font-display text-lg mb-1 text-[#2D3A33]">Loyalty tiers</div>
        <p className="text-sm text-[#5C6C62] mb-1">
          Tiers are awarded automatically based on a patient&apos;s lifetime spend. A patient receives the highest tier they qualify for.
        </p>
        <p className="text-xs text-[#5C6C62] mb-4">
          Patient tiers are calculated automatically from paid lifetime spend.
        </p>

        <div className="space-y-4" data-testid="tier-list">
          {tiers.length === 0 && <div className="text-sm text-[#5C6C62]">No tiers yet. Add one to get started.</div>}
          {tiers.map((t, idx) => (
            <div key={idx} className="rounded-xl border p-4 space-y-3" style={{ borderColor: t.color || "#EAE6D7", background: `${t.color || "#EAE6D7"}0A` }} data-testid={`tier-card-${idx}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="color"
                    className="w-10 h-10 rounded-lg border border-[#EAE6D7] cursor-pointer flex-shrink-0"
                    value={t.color || "#9CA3AF"}
                    onChange={(e) => update(idx, "color", e.target.value)}
                    data-testid={`tier-color-${idx}`}
                  />
                  <input
                    className="bl-input flex-1 font-display text-lg"
                    value={t.name}
                    placeholder="Tier name (e.g. Silver)"
                    onChange={(e) => update(idx, "name", e.target.value)}
                    data-testid={`tier-name-${idx}`}
                  />
                </div>
                <button type="button" onClick={() => remove(idx)} className="text-[#B14A2C] p-2 hover:bg-[#FDF3F0] rounded-lg" data-testid={`tier-remove-${idx}`}><Trash2 className="w-4 h-4" /></button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Minimum lifetime spend (IDR)</label>
                  <input
                    type="number"
                    min={0}
                    step={100000}
                    className="bl-input"
                    value={t.min_spend_idr}
                    onChange={(e) => update(idx, "min_spend_idr", e.target.value)}
                    data-testid={`tier-spend-${idx}`}
                  />
                  <div className="text-xs text-[#5C6C62] mt-1">{fmtIDRShort(t.min_spend_idr)}</div>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Benefit description</label>
                  <input
                    className="bl-input"
                    value={t.benefit || ""}
                    placeholder="e.g. 10% off + birthday gift"
                    onChange={(e) => update(idx, "benefit", e.target.value)}
                    data-testid={`tier-benefit-${idx}`}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <button type="button" onClick={add} className="mt-4 bl-btn-ghost text-sm inline-flex items-center gap-1.5" data-testid="tier-add"><Plus className="w-4 h-4" /> Add tier</button>
      </div>

      {sortedPreview.length > 0 && (
        <div className="bl-card p-5 bg-[#FDFBF7]">
          <div className="font-display text-base text-[#2D3A33] mb-3">Preview (sorted by threshold)</div>
          <div className="flex flex-wrap gap-2">
            {sortedPreview.map((t, i) => (
              <div key={i} className="rounded-full px-3 py-1.5 text-xs font-medium" style={{ background: `${t.color}22`, color: t.color, border: `1px solid ${t.color}` }}>
                {t.name} <span className="opacity-70">≥ {fmtIDRShort(t.min_spend_idr)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end sticky bottom-4">
        <button onClick={save} disabled={busy} className="bl-btn-primary disabled:opacity-50 shadow-lg" data-testid="loyalty-save">
          {busy ? "Saving…" : "Save loyalty tiers"}
        </button>
      </div>
    </div>
  );
}

function CampaignsTab() {
  const emptyForm = () => ({
    name: "",
    code: "",
    description: "",
    discount_type: "percent",
    discount_value: 10,
    max_discount_idr: "",
    min_invoice_amount_idr: 0,
    active: true,
    start_date: "",
    end_date: "",
    max_uses_total: "",
    applies_to: "all",
  });

  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const load = () => api.get("/campaigns").then(r => setRows(r.data || []));
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm());
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setForm({
      name: c.name || "",
      code: c.code || "",
      description: c.description || "",
      discount_type: c.discount_type || "percent",
      discount_value: c.discount_value ?? 10,
      max_discount_idr: c.max_discount_idr ?? "",
      min_invoice_amount_idr: c.min_invoice_amount_idr ?? c.min_subtotal_idr ?? 0,
      active: c.active !== false,
      start_date: (c.start_date || c.valid_from || "").slice(0, 10),
      end_date: (c.end_date || c.valid_until || "").slice(0, 10),
      max_uses_total: c.max_uses_total ?? c.max_uses ?? "",
      applies_to: c.applies_to || "all",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const payloadFromForm = () => ({
    name: form.name.trim(),
    code: form.code.trim().toUpperCase() || null,
    description: form.description.trim(),
    discount_type: form.discount_type,
    discount_value: Number(form.discount_value) || 0,
    max_discount_idr: form.max_discount_idr === "" ? null : Number(form.max_discount_idr),
    min_invoice_amount_idr: Number(form.min_invoice_amount_idr) || 0,
    active: form.active,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    max_uses_total: form.max_uses_total === "" ? null : Number(form.max_uses_total),
    applies_to: form.applies_to,
  });

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Campaign name is required"); return; }
    setBusy(true);
    try {
      const body = payloadFromForm();
      if (editingId) {
        await api.put(`/campaigns/${editingId}`, body);
        toast.success("Campaign updated");
      } else {
        await api.post("/campaigns", body);
        toast.success("Campaign created");
      }
      resetForm();
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save campaign");
    } finally { setBusy(false); }
  };

  const toggleActive = async (c) => {
    await api.put(`/campaigns/${c.id}`, { active: !c.active });
    load();
  };

  const remove = async (c) => {
    await api.delete(`/campaigns/${c.id}`);
    toast.success("Campaign deleted");
    setDeleteConfirmId(null);
    if (editingId === c.id) resetForm();
    load();
  };

  const formatDateRange = (c) => {
    const from = (c.start_date || c.valid_from || "").slice(0, 10) || null;
    const until = (c.end_date || c.valid_until || "").slice(0, 10) || null;
    if (from && until) return `${from} → ${until}`;
    if (from) return `From ${from}`;
    if (until) return `Until ${until}`;
    return "No date limit";
  };

  return (
    <div className="max-w-3xl space-y-6" data-testid="campaigns-tab">
      <div className="bl-card p-5">
        <div className="font-display text-lg text-[#2D3A33]">{editingId ? "Edit campaign" : "New campaign"}</div>
        <p className="text-sm text-[#5C6C62] mt-1 mb-4">
          Create promotion campaigns applied at invoice time. Staff select active campaigns when billing — not during booking.
        </p>
        <form onSubmit={save} className="space-y-3" data-testid="campaign-create-form">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label-eyebrow block mb-1.5">Campaign name</label>
              <input className="bl-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="June Body Treatment Happy Hours" data-testid="campaign-name-input" />
            </div>
            <div>
              <label className="label-eyebrow block mb-1.5">Internal code (optional)</label>
              <input className="bl-input font-mono uppercase" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="JUNE_BODY_HH" data-testid="campaign-code-input" />
            </div>
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Description</label>
            <textarea className="bl-input min-h-[60px]" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional details for staff" data-testid="campaign-description-input" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label-eyebrow block mb-1.5">Discount type</label>
              <select className="bl-input" value={form.discount_type} onChange={e => setForm({ ...form, discount_type: e.target.value })} data-testid="campaign-type-select">
                <option value="percent">Percentage (%)</option>
                <option value="fixed">Fixed amount (IDR)</option>
              </select>
            </div>
            <div>
              <label className="label-eyebrow block mb-1.5">Discount value</label>
              <input type="number" min="0" className="bl-input" value={form.discount_value} onChange={e => setForm({ ...form, discount_value: Number(e.target.value) })} required data-testid="campaign-value-input" />
            </div>
            <div>
              <label className="label-eyebrow block mb-1.5">Max discount (IDR)</label>
              <input type="number" min="0" className="bl-input" value={form.max_discount_idr} onChange={e => setForm({ ...form, max_discount_idr: e.target.value })} placeholder="Optional" data-testid="campaign-max-discount-input" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label-eyebrow block mb-1.5">Min. invoice amount (IDR)</label>
              <input type="number" min="0" className="bl-input" value={form.min_invoice_amount_idr} onChange={e => setForm({ ...form, min_invoice_amount_idr: Number(e.target.value) })} data-testid="campaign-min-invoice-input" />
            </div>
            <div>
              <label className="label-eyebrow block mb-1.5">Max uses (total)</label>
              <input type="number" min="1" className="bl-input" value={form.max_uses_total} onChange={e => setForm({ ...form, max_uses_total: e.target.value })} placeholder="Unlimited" data-testid="campaign-max-uses-input" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label-eyebrow block mb-1.5">Start date</label>
              <input type="date" className="bl-input" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} data-testid="campaign-start-date" />
            </div>
            <div>
              <label className="label-eyebrow block mb-1.5">End date</label>
              <input type="date" className="bl-input" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} data-testid="campaign-end-date" />
            </div>
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Applies to</label>
            <select className="bl-input" value={form.applies_to} onChange={e => setForm({ ...form, applies_to: e.target.value })} data-testid="campaign-applies-to">
              <option value="all">All treatments & packages</option>
              <option value="treatments">Selected treatments (configure in advanced)</option>
              <option value="categories">Selected categories (configure in advanced)</option>
              <option value="packages">Selected packages (configure in advanced)</option>
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-[#2D3A33] cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} data-testid="campaign-active-toggle" />
            Active — eligible for invoice selection when within date range
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={busy} className="bl-btn-primary" data-testid="campaign-create-submit">
              {busy ? "Saving…" : editingId ? "Save campaign" : "Add campaign"}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="bl-btn-ghost">Cancel edit</button>
            )}
          </div>
        </form>
      </div>

      <div className="bl-card table-card overflow-hidden">
        <table className="bl-data-table w-full">
          <thead className="bl-data-table-head">
            <tr>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Valid dates</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Uses</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[#5C6C62]">No campaigns yet.</td></tr>
            )}
            {rows.map(c => (
              <tr key={c.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{c.name}</div>
                  {c.code && <div className="text-xs font-mono text-[#5C6C62]">{c.code}</div>}
                </td>
                <td className="px-4 py-3 text-sm">
                  {c.discount_type === "percent" ? `${c.discount_value}%` : fmtIDRShort(c.discount_value)}
                </td>
                <td className="px-4 py-3 text-xs text-[#5C6C62] whitespace-nowrap">{formatDateRange(c)}</td>
                <td className="px-4 py-3 text-xs capitalize text-[#5C6C62]">{c.status || (c.active ? "active" : "inactive")}</td>
                <td className="px-4 py-3 text-sm text-[#5C6C62]">{c.uses_count || 0}{c.max_uses_total != null ? ` / ${c.max_uses_total}` : ""}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button type="button" onClick={() => toggleActive(c)} className={`bl-chip ${c.active ? "success" : ""}`} data-testid={`campaign-toggle-${c.id}`}>
                      {c.active ? "Active" : "Inactive"}
                    </button>
                    <button type="button" onClick={() => startEdit(c)} className="text-xs px-2 py-1 rounded hover:bg-[#F3F1EB] inline-flex items-center gap-1" data-testid={`campaign-edit-${c.id}`}>
                      <Edit2 className="w-3.5 h-3.5" /> Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CouponsTab = CampaignsTab;

function SecuritySettingsTab() {
  const [require2fa, setRequire2fa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get("/settings/security")
      .then((r) => {
        setRequire2fa(!!r.data?.require_2fa_for_owner_manager);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put("/admin/settings/security", { require_2fa_for_owner_manager: require2fa });
      toast.success("Security settings saved");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <p className="text-sm text-[#5C6C62]">Loading…</p>;

  return (
    <form onSubmit={save} className="max-w-xl space-y-4" data-testid="security-settings-tab">
      <p className="text-sm text-[#5C6C62]">
        Optional policy for Owner and Manager accounts. When enabled, they must set up two-factor authentication before they can sign in.
      </p>
      <label className="flex items-start gap-3 bl-card p-4 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1"
          checked={require2fa}
          onChange={(e) => setRequire2fa(e.target.checked)}
          data-testid="security-require-2fa-owner-manager"
        />
        <span>
          <span className="font-medium text-[#2D3A33] block">Require 2FA for Owner and Manager</span>
          <span className="text-sm text-[#5C6C62]">
            Staff in other roles are not affected. Individual users can still enable 2FA voluntarily from Account settings → Security.
          </span>
        </span>
      </label>
      <button type="submit" className="bl-btn-primary" disabled={busy} data-testid="security-settings-save">
        {busy ? "Saving…" : "Save security settings"}
      </button>
    </form>
  );
}

function InventorySettingsTab() {
  const [allowNegative, setAllowNegative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get("/settings/inventory")
      .then((r) => {
        setAllowNegative(!!r.data?.allow_negative_stock);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put("/admin/settings/inventory", { allow_negative_stock: allowNegative });
      toast.success("Inventory settings saved");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <p className="text-sm text-[#5C6C62]">Loading…</p>;

  return (
    <form onSubmit={save} className="max-w-xl space-y-4" data-testid="inventory-settings-tab">
      <p className="text-sm text-[#5C6C62]">
        Control how treatment product usage affects internal inventory stock when clinical staff record usage on visits.
      </p>
      <label className="flex items-start gap-3 bl-card p-4 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1"
          checked={allowNegative}
          onChange={(e) => setAllowNegative(e.target.checked)}
          data-testid="inventory-allow-negative-stock"
        />
        <span>
          <span className="font-medium text-[#2D3A33] block">Allow negative stock</span>
          <span className="text-sm text-[#5C6C62]">
            When enabled, product usage can deduct below zero (with a warning). When disabled, usage that exceeds available stock is blocked.
          </span>
        </span>
      </label>
      <button type="submit" className="bl-btn-primary" disabled={busy} data-testid="inventory-settings-save">
        {busy ? "Saving…" : "Save inventory settings"}
      </button>
    </form>
  );
}

function OnlineBookingPaymentTab() {
  const [form, setForm] = useState({
    enable_online_booking_payment: false,
    payment_requirement: "none",
    deposit_type: "fixed",
    deposit_value: 0,
    payment_provider: "none",
    provider_mode: "sandbox",
    payment_expiry_minutes: 30,
    booking_confirmation_rule: "confirm_after_payment",
    midtrans_server_key: "",
    midtrans_client_key: "",
    xendit_api_key: "",
  });
  const [hasCredentials, setHasCredentials] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get("/settings/online-booking-payment")
      .then(r => {
        const d = r.data;
        setForm(f => ({
          ...f,
          enable_online_booking_payment: !!d.enable_online_booking_payment,
          payment_requirement: d.payment_requirement || "none",
          deposit_type: d.deposit_type || "fixed",
          deposit_value: d.deposit_value ?? 0,
          payment_provider: d.payment_provider || "none",
          provider_mode: d.provider_mode || "sandbox",
          payment_expiry_minutes: d.payment_expiry_minutes ?? 30,
          booking_confirmation_rule: d.booking_confirmation_rule || "confirm_after_payment",
        }));
        setHasCredentials(!!d.has_credentials);
      })
      .catch(() => toast.error("Could not load payment settings"))
      .finally(() => setLoaded(true));
  }, []);

  const paymentEnabled = form.enable_online_booking_payment && ["full_payment", "deposit"].includes(form.payment_requirement);

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        enable_online_booking_payment: form.enable_online_booking_payment,
        payment_requirement: form.payment_requirement,
        deposit_type: form.deposit_type,
        deposit_value: Number(form.deposit_value) || 0,
        payment_provider: form.payment_provider,
        provider_mode: form.provider_mode,
        payment_expiry_minutes: Number(form.payment_expiry_minutes) || 30,
        booking_confirmation_rule: form.booking_confirmation_rule,
      };
      if (form.midtrans_server_key) body.midtrans_server_key = form.midtrans_server_key;
      if (form.midtrans_client_key) body.midtrans_client_key = form.midtrans_client_key;
      if (form.xendit_api_key) body.xendit_api_key = form.xendit_api_key;
      const r = await api.put("/settings/online-booking-payment", body);
      setHasCredentials(!!r.data.has_credentials);
      setForm(f => ({ ...f, midtrans_server_key: "", midtrans_client_key: "", xendit_api_key: "" }));
      toast.success("Online appointment payment settings saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      await api.post("/settings/online-booking-payment/test-connection");
      toast.success("Connection test passed");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  if (!loaded) return <div className="text-[#5C6C62]">Loading…</div>;

  return (
    <div className="max-w-3xl space-y-6" data-testid="online-booking-payment-form">
      <div className="bl-card p-5 space-y-5">
        <div>
          <div className="font-display text-lg text-[#2D3A33]">Online appointment payment</div>
          <p className="text-sm text-[#5C6C62] mt-1">
            Require payment during public online appointment. Payments go directly to your gateway account — ClinicOS does not hold funds.
          </p>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.enable_online_booking_payment}
            onChange={e => setForm({ ...form, enable_online_booking_payment: e.target.checked })}
            data-testid="obp-enable"
          />
          <span className="text-sm text-[#2D3A33]">Enable online appointment payment</span>
        </label>

        {form.enable_online_booking_payment && (
          <>
            <div>
              <label className="label-eyebrow block mb-1.5">Payment requirement</label>
              <select
                className="bl-input"
                value={form.payment_requirement}
                onChange={e => setForm({ ...form, payment_requirement: e.target.value })}
                data-testid="obp-requirement"
              >
                <option value="none">None</option>
                <option value="full_payment">Full payment</option>
                <option value="deposit">Deposit</option>
              </select>
            </div>

            {form.payment_requirement === "deposit" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Deposit type</label>
                  <select
                    className="bl-input"
                    value={form.deposit_type}
                    onChange={e => setForm({ ...form, deposit_type: e.target.value })}
                  >
                    <option value="fixed">Fixed amount (IDR)</option>
                    <option value="percentage">Percentage of total</option>
                  </select>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Deposit value</label>
                  <input
                    type="number"
                    min={0}
                    className="bl-input"
                    value={form.deposit_value}
                    onChange={e => setForm({ ...form, deposit_value: e.target.value })}
                    data-testid="obp-deposit-value"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label-eyebrow block mb-1.5">Payment provider</label>
                <select
                  className="bl-input"
                  value={form.payment_provider}
                  onChange={e => setForm({ ...form, payment_provider: e.target.value })}
                  data-testid="obp-provider"
                >
                  <option value="none">None</option>
                  <option value="midtrans">Midtrans</option>
                  <option value="xendit">Xendit</option>
                </select>
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Provider mode</label>
                <select
                  className="bl-input"
                  value={form.provider_mode}
                  onChange={e => setForm({ ...form, provider_mode: e.target.value })}
                >
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </select>
              </div>
            </div>

            {form.payment_provider === "midtrans" && (
              <div className="space-y-3 rounded-xl border border-[#EAE6D7] p-4">
                <p className="text-xs text-[#5C6C62]">Midtrans credentials {hasCredentials ? "(saved — leave blank to keep)" : ""}</p>
                <input
                  className="bl-input"
                  type="password"
                  placeholder="Server key"
                  value={form.midtrans_server_key}
                  onChange={e => setForm({ ...form, midtrans_server_key: e.target.value })}
                  data-testid="obp-midtrans-server-key"
                />
                <input
                  className="bl-input"
                  type="password"
                  placeholder="Client key (optional, stored securely)"
                  value={form.midtrans_client_key}
                  onChange={e => setForm({ ...form, midtrans_client_key: e.target.value })}
                />
              </div>
            )}

            {form.payment_provider === "xendit" && (
              <div className="space-y-3 rounded-xl border border-[#EAE6D7] p-4">
                <p className="text-xs text-[#5C6C62]">Xendit credentials {hasCredentials ? "(saved — leave blank to keep)" : ""}</p>
                <input
                  className="bl-input"
                  type="password"
                  placeholder="API key"
                  value={form.xendit_api_key}
                  onChange={e => setForm({ ...form, xendit_api_key: e.target.value })}
                  data-testid="obp-xendit-key"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label-eyebrow block mb-1.5">Payment expiry (minutes)</label>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  className="bl-input"
                  value={form.payment_expiry_minutes}
                  onChange={e => setForm({ ...form, payment_expiry_minutes: e.target.value })}
                />
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Appointment confirmation</label>
                <select
                  className="bl-input"
                  value={form.booking_confirmation_rule}
                  onChange={e => setForm({ ...form, booking_confirmation_rule: e.target.value })}
                >
                  <option value="confirm_after_payment">Confirm after payment</option>
                  <option value="allow_pending_payment">Allow pending payment</option>
                </select>
              </div>
            </div>
          </>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" onClick={save} disabled={busy} className="bl-btn-primary" data-testid="obp-save">
            {busy ? "Saving…" : "Save settings"}
          </button>
          {paymentEnabled && form.payment_provider !== "none" && (
            <button
              type="button"
              onClick={testConnection}
              disabled={testing || (!hasCredentials && !form.midtrans_server_key && !form.xendit_api_key)}
              className="bl-btn-secondary inline-flex items-center gap-2"
              data-testid="obp-test-connection"
            >
              <RefreshCw className={`w-4 h-4 ${testing ? "animate-spin" : ""}`} />
              Test connection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const MESSAGING_TAGS = [
  "clinic_name", "patient_name", "patient_phone", "appointment_date", "appointment_time",
  "treatment_name", "performer_name", "booking_status", "booking_link", "payment_link",
  "consent_link", "clinic_phone", "clinic_address",
  "amount_paid", "invoice_number", "gift_card_code", "gift_card_value", "package_name", "sessions_remaining",
];

const TEMPLATE_TYPES = [
  { value: "booking_confirmation", label: "Appointment confirmation" },
  { value: "booking_reminder", label: "Appointment reminder" },
  { value: "booking_rescheduled", label: "Appointment rescheduled" },
  { value: "booking_cancelled", label: "Appointment cancelled" },
  { value: "payment_link", label: "Payment link" },
  { value: "payment_received", label: "Payment received" },
  { value: "consent_link", label: "Consent link" },
  { value: "gift_card_issued", label: "Gift card issued" },
  { value: "package_balance_reminder", label: "Package balance reminder" },
  { value: "follow_up", label: "Follow up" },
  { value: "birthday", label: "Birthday" },
  { value: "custom", label: "Custom" },
];

const MESSAGING_STATUS_LABEL = {
  disabled: "Disabled",
  not_connected: "Not connected",
  connected: "Connected",
  error: "Error",
};

function MessagingSettingsTab() {
  const [form, setForm] = useState({
    enable_messaging: false,
    provider: "whatsapp_cloud_api",
    sender_name: "",
    sender_phone_number: "",
    webhook_url: "",
    access_token: "",
    phone_number_id: "",
    api_key: "",
    api_base_url: "",
    vendor_uid: "",
    send_message_path: "/api/{vendor_uid}/contact/send-message",
    send_template_path: "/api/{vendor_uid}/contact/send-template-message",
    whatsjet_payload_style: "standard",
    whatsjet_test_path: "/api/{vendor_uid}/contact/contacts",
    webhook_secret: "",
    account_sid: "",
    auth_token: "",
    from_number: "",
  });
  const [hasCredentials, setHasCredentials] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("disabled");
  const [automationActive, setAutomationActive] = useState(false);
  const [lastError, setLastError] = useState("");
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get("/settings/messaging")
      .then(r => {
        const d = r.data;
        setForm(f => ({
          ...f,
          enable_messaging: !!d.enable_messaging,
          provider: d.provider && d.provider !== "none" ? d.provider : "whatsapp_cloud_api",
          sender_name: d.sender_name || "",
          sender_phone_number: d.sender_phone_number || "",
          webhook_url: d.webhook_url || "",
          api_base_url: d.whatsjet_api_base_url || "",
          vendor_uid: d.whatsjet_vendor_uid || "",
          send_message_path: d.whatsjet_send_path || "/api/{vendor_uid}/contact/send-message",
          send_template_path: d.whatsjet_send_template_path || "/api/{vendor_uid}/contact/send-template-message",
          whatsjet_payload_style: d.whatsjet_payload_style || "standard",
          whatsjet_test_path: d.whatsjet_test_path || "/api/{vendor_uid}/contact/contacts",
        }));
        setHasWebhookSecret(!!d.has_whatsjet_webhook_secret);
        setHasCredentials(!!d.has_credentials);
        setConnectionStatus(d.connection_status || "disabled");
        setAutomationActive(!!d.automation_active);
        setLastError(d.last_connection_error || "");
      })
      .catch(() => toast.error("Could not load messaging settings"))
      .finally(() => setLoaded(true));
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        enable_messaging: form.enable_messaging,
        provider: form.provider,
        sender_name: form.sender_name,
        sender_phone_number: form.sender_phone_number,
        webhook_url: form.webhook_url,
      };
      if (form.access_token) body.access_token = form.access_token;
      if (form.phone_number_id) body.phone_number_id = form.phone_number_id;
      if (form.api_key) body.api_key = form.api_key;
      if (form.api_base_url) body.api_base_url = form.api_base_url;
      if (form.vendor_uid) body.vendor_uid = form.vendor_uid;
      if (form.send_message_path) body.send_message_path = form.send_message_path;
      if (form.send_template_path) body.send_template_path = form.send_template_path;
      if (form.whatsjet_payload_style) body.whatsjet_payload_style = form.whatsjet_payload_style;
      if (form.whatsjet_test_path) body.whatsjet_test_path = form.whatsjet_test_path;
      if (form.webhook_secret) body.webhook_secret = form.webhook_secret;
      if (form.provider === "whatsjet" && form.access_token) body.access_token = form.access_token;
      if (form.account_sid) body.account_sid = form.account_sid;
      if (form.auth_token) body.auth_token = form.auth_token;
      if (form.from_number) body.from_number = form.from_number;
      const r = await api.put("/settings/messaging", body);
      setHasCredentials(!!r.data.has_credentials);
      setConnectionStatus(r.data.connection_status || "disabled");
      setAutomationActive(!!r.data.automation_active);
      setLastError(r.data.last_connection_error || "");
      setForm(f => ({ ...f, access_token: "", phone_number_id: "", api_key: "", auth_token: "", account_sid: "", webhook_secret: "" }));
      setHasWebhookSecret(!!r.data.has_whatsjet_webhook_secret);
      toast.success("Messaging settings saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const testSend = async () => {
    if (!testPhone.trim()) {
      toast.error("Enter a test phone number");
      return;
    }
    setTestSending(true);
    try {
      const r = await api.post("/settings/messaging/test-send", {
        phone: testPhone.trim(),
        message: "ClinicOS WhatsApp test — please ignore.",
      });
      toast.success(r.data?.status === "sent" ? "Test message sent" : `Test finished: ${r.data?.status || "ok"}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Test send failed");
    } finally {
      setTestSending(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const tr = await api.post("/settings/messaging/test-connection");
      setConnectionStatus(tr.data?.connection_status || "connected");
      setAutomationActive(!!tr.data?.automation_active);
      setLastError("");
      toast.success("Connection test passed — automation is active");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  if (!loaded) return <div className="text-[#5C6C62]">Loading…</div>;

  const statusChip =
    connectionStatus === "connected" ? "success"
      : connectionStatus === "error" ? "neutral"
        : connectionStatus === "not_connected" ? "warning"
          : "info";

  return (
    <div className="max-w-3xl space-y-6" data-testid="messaging-settings-form">
      <div className="bl-card p-5 space-y-5">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="font-display text-lg text-[#2D3A33]">WhatsApp automation</div>
            <span className={`bl-chip ${statusChip}`} data-testid="messaging-connection-status">
              {MESSAGING_STATUS_LABEL[connectionStatus] || connectionStatus}
            </span>
          </div>
          <p className="text-sm text-[#5C6C62] mt-2">
            Automated WhatsApp messages require a WhatsApp API provider. Clinics using only the WhatsApp Business app cannot send automated messages from ClinicOS.
            You can still open WhatsApp manually from patient or appointment pages.
          </p>
          {!automationActive && (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3" data-testid="messaging-not-connected-hint">
              {form.enable_messaging
                ? "Automation is not active yet — save API credentials and run Test connection."
                : "Enable automation below and connect an API provider. Manual copy / Open WhatsApp does not require this."}
              {lastError && form.enable_messaging ? ` (${lastError})` : ""}
            </p>
          )}
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.enable_messaging}
            onChange={e => setForm({ ...form, enable_messaging: e.target.checked })}
            data-testid="messaging-enable"
          />
          <span className="text-sm text-[#2D3A33]">Enable automated WhatsApp messaging</span>
        </label>

        {form.enable_messaging && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label-eyebrow block mb-1.5">API provider</label>
                <select className="bl-input" value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })} data-testid="messaging-provider">
                  <option value="whatsapp_cloud_api">Meta WhatsApp Cloud API</option>
                  <option value="whatsjet">WhatsJet / Custom API</option>
                  <option value="twilio">BSP provider (Twilio)</option>
                </select>
                <p className="text-xs text-[#5C6C62] mt-1">Manual fallback only — no automation. Use appointment/patient pages to copy or open WhatsApp.</p>
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Sender name (optional)</label>
                <input className="bl-input" value={form.sender_name} onChange={e => setForm({ ...form, sender_name: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label-eyebrow block mb-1.5">Sender phone / Phone number ID</label>
                <input className="bl-input" value={form.sender_phone_number} onChange={e => setForm({ ...form, sender_phone_number: e.target.value })} placeholder="628… or Meta phone_number_id" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">API base URL (optional)</label>
                <input className="bl-input" value={form.webhook_url} onChange={e => setForm({ ...form, webhook_url: e.target.value })} placeholder="https://graph.facebook.com or WhatsJet base" />
              </div>
            </div>

            {form.provider === "whatsapp_cloud_api" && (
              <div className="space-y-3 rounded-xl border border-[#EAE6D7] p-4">
                <p className="text-xs text-[#5C6C62] font-medium">Meta WhatsApp Cloud API setup</p>
                <ul className="text-xs text-[#5C6C62] list-disc pl-4 space-y-1">
                  <li>Requires WhatsApp Business Platform (WABA) and a registered business number.</li>
                  <li>Requires Phone Number ID and a permanent access token from Meta.</li>
                  <li>Automated outbound messages outside the customer service window need Meta-approved message templates (map in Message Templates).</li>
                </ul>
                <p className="text-xs text-[#5C6C62] pt-1">{hasCredentials ? "Credentials saved — leave blank to keep." : ""}</p>
                <input className="bl-input" type="password" placeholder="Access token" value={form.access_token} onChange={e => setForm({ ...form, access_token: e.target.value })} data-testid="messaging-access-token" />
                <input className="bl-input" type="password" placeholder="Phone number ID" value={form.phone_number_id} onChange={e => setForm({ ...form, phone_number_id: e.target.value })} data-testid="messaging-phone-id" />
              </div>
            )}
            {form.provider === "whatsjet" && (
              <div className="space-y-3 rounded-xl border border-[#EAE6D7] p-4" data-testid="whatsjet-settings">
                <p className="text-xs text-[#5C6C62] font-medium">WhatsJet Account Access API</p>
                <p className="text-xs text-[#5C6C62]">
                  Configure from your WhatsJet vendor panel: API Base URL, Vendor UID, and API Access Token.
                  Use the send path from WhatsJet docs (default matches common Account Access API).
                </p>
                <input
                  className="bl-input"
                  placeholder="API Base URL (e.g. https://wa.bodylabbali.com)"
                  value={form.api_base_url}
                  onChange={e => setForm({ ...form, api_base_url: e.target.value })}
                  data-testid="whatsjet-api-base"
                />
                <input
                  className="bl-input"
                  placeholder="Vendor UID"
                  value={form.vendor_uid}
                  onChange={e => setForm({ ...form, vendor_uid: e.target.value })}
                  data-testid="whatsjet-vendor-uid"
                />
                <input
                  className="bl-input"
                  type="password"
                  placeholder={hasCredentials ? "API Access Token (leave blank to keep)" : "API Access Token"}
                  value={form.access_token || form.api_key}
                  onChange={e => setForm({ ...form, access_token: e.target.value, api_key: e.target.value })}
                  data-testid="whatsjet-access-token"
                />
                <input
                  className="bl-input font-mono text-sm"
                  placeholder="Send message path"
                  value={form.send_message_path}
                  onChange={e => setForm({ ...form, send_message_path: e.target.value })}
                  data-testid="whatsjet-send-path"
                />
                <input
                  className="bl-input font-mono text-sm"
                  placeholder="Send template path"
                  value={form.send_template_path}
                  onChange={e => setForm({ ...form, send_template_path: e.target.value })}
                  data-testid="whatsjet-send-template-path"
                />
                <select
                  className="bl-input"
                  value={form.whatsjet_payload_style}
                  onChange={e => setForm({ ...form, whatsjet_payload_style: e.target.value })}
                  data-testid="whatsjet-payload-style"
                >
                  <option value="standard">Payload: template_language + variables</option>
                  <option value="language_code">Payload: language_code + variables</option>
                  <option value="components">Payload: components array</option>
                </select>
                <input
                  className="bl-input font-mono text-sm"
                  placeholder="Test connection path (optional; leave default or empty)"
                  value={form.whatsjet_test_path}
                  onChange={e => setForm({ ...form, whatsjet_test_path: e.target.value })}
                />
                <input
                  className="bl-input"
                  type="password"
                  placeholder={hasWebhookSecret ? "Webhook secret (leave blank to keep)" : "Webhook secret (optional)"}
                  value={form.webhook_secret}
                  onChange={e => setForm({ ...form, webhook_secret: e.target.value })}
                  data-testid="whatsjet-webhook-secret"
                />
                <p className="text-xs text-[#5C6C62]">
                  Webhook URL for WhatsJet: <span className="font-mono">{typeof window !== "undefined" ? `${window.location.origin.replace(/:\d+$/, "")}/api/messaging/webhook/whatsjet?clinic_id=YOUR_CLINIC` : "/api/messaging/webhook/whatsjet"}</span>
                  {" "}(set clinic_id in query; send X-Webhook-Secret header).
                </p>
                <div className="flex flex-wrap gap-2 items-end pt-1">
                  <div className="flex-1 min-w-[140px]">
                    <label className="label-eyebrow block mb-1">Test phone</label>
                    <input className="bl-input" placeholder="628123456789" value={testPhone} onChange={e => setTestPhone(e.target.value)} data-testid="whatsjet-test-phone" />
                  </div>
                  <button type="button" onClick={testSend} disabled={testSending || !automationActive} className="bl-btn-secondary text-sm" data-testid="whatsjet-test-send">
                    {testSending ? "Sending…" : "Send test message"}
                  </button>
                </div>
              </div>
            )}
            {form.provider === "twilio" && (
              <div className="space-y-3 rounded-xl border border-[#EAE6D7] p-4">
                <input className="bl-input" type="password" placeholder="Account SID" value={form.account_sid} onChange={e => setForm({ ...form, account_sid: e.target.value })} />
                <input className="bl-input" type="password" placeholder="Auth token" value={form.auth_token} onChange={e => setForm({ ...form, auth_token: e.target.value })} />
                <input className="bl-input" placeholder="From number (whatsapp:+…)" value={form.from_number} onChange={e => setForm({ ...form, from_number: e.target.value })} />
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" onClick={save} disabled={busy} className="bl-btn-primary" data-testid="messaging-save">Save settings</button>
          {form.enable_messaging && (
            <button type="button" onClick={testConnection} disabled={testing} className="bl-btn-secondary inline-flex items-center gap-2" data-testid="messaging-test">
              <RefreshCw className={`w-4 h-4 ${testing ? "animate-spin" : ""}`} /> Test connection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessagingLogsTab() {
  const [logs, setLogs] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get("/messaging/logs", { params: { limit: 100 } })
      .then(r => setLogs(r.data.items || []))
      .catch(() => toast.error("Could not load message log"))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <div className="text-[#5C6C62]">Loading…</div>;

  return (
    <div className="max-w-4xl space-y-6" data-testid="messaging-logs-tab">
      <div className="bl-card overflow-hidden">
        <div className="px-4 py-3 border-b border-[#EAE6D7] font-display">Message log</div>
        <div className="max-h-[32rem] overflow-y-auto">
          {logs.length === 0 && <p className="px-4 py-6 text-sm text-[#5C6C62] text-center">No messages yet.</p>}
          {logs.map(l => (
            <div key={l.id} className="px-4 py-2 border-t border-[#EAE6D7] text-xs">
              <span className="font-medium capitalize">{l.status}</span>
              <span className="text-[#5C6C62]"> · {l.template_type || "—"} · {l.recipient}</span>
              {l.error_message && <span className="text-[#B14A2C]"> · {l.error_message}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MessagingTemplatesTab({ showLogs = true }) {
  const empty = {
    template_name: "",
    template_type: "booking_confirmation",
    channel: "whatsapp",
    message_body: "",
    provider_template_name: "",
    provider_template_id: "",
    language: "id",
    whatsjet_variable_mapping: [],
    active: true,
    timing_rule: "immediately",
    timing_custom_minutes: 0,
  };
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [automationActive, setAutomationActive] = useState(false);
  const [messagingProvider, setMessagingProvider] = useState("");

  const load = () => {
    api.get("/settings/messaging").then(r => {
      setMessagingProvider(r.data.provider || "");
    }).catch(() => {});
    api.get("/messaging/templates").then(r => {
      setItems(r.data.items || []);
      setAutomationActive(!!r.data.automation_active);
    }).catch(() => toast.error("Could not load templates"));
    api.get("/messaging/logs", { params: { limit: 50 } }).then(r => setLogs(r.data.items || [])).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.template_name.trim() || !form.message_body.trim()) {
      toast.error("Name and message body required");
      return;
    }
    setBusy(true);
    try {
      const payload = { ...form, active: automationActive ? form.active : false };
      if (editingId) {
        await api.put(`/messaging/templates/${editingId}`, payload);
        toast.success("Template updated");
      } else {
        await api.post("/messaging/templates", payload);
        toast.success("Template created");
      }
      setForm(empty);
      setEditingId(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (t) => {
    setEditingId(t.id);
    setForm({
      ...t,
      timing_custom_minutes: t.timing_custom_minutes || 0,
      whatsjet_variable_mapping: t.whatsjet_variable_mapping || [],
    });
  };

  const variableMappingStr = Array.isArray(form.whatsjet_variable_mapping)
    ? form.whatsjet_variable_mapping.join(", ")
    : (form.whatsjet_variable_mapping || "");

  const setVariableMappingStr = (raw) => {
    const keys = raw.split(",").map(s => s.trim()).filter(Boolean);
    setForm({ ...form, whatsjet_variable_mapping: keys });
  };

  const remove = (t) => {
    confirmAction(`Delete template "${t.template_name}"?`, async () => {
      await api.delete(`/messaging/templates/${t.id}`);
      load();
    });
  };

  return (
    <div className="max-w-4xl space-y-6" data-testid="messaging-templates-form">
      <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3" data-testid="messaging-templates-warning">
        Legacy ClinicOS templates are optional. For WhatsJet automation, enter approved WhatsApp template names directly in Automation Rules — ClinicOS does not submit templates to Meta/WhatsJet.
      </p>
      <div className="bl-card p-5 space-y-4">
        <div className="font-display text-lg text-[#2D3A33]">{editingId ? "Edit template" : "New template"}</div>
        <p className="text-xs text-[#5C6C62]">Use tags: {MESSAGING_TAGS.map(t => `{{${t}}}`).join(", ")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className="bl-input" placeholder="Template name" value={form.template_name} onChange={e => setForm({ ...form, template_name: e.target.value })} data-testid="tpl-name" />
          <select className="bl-input" value={form.template_type} onChange={e => setForm({ ...form, template_type: e.target.value })}>
            {TEMPLATE_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="bl-input" value={form.timing_rule} onChange={e => setForm({ ...form, timing_rule: e.target.value })}>
            <option value="immediately">Immediately</option>
            <option value="24_hours_before">24 hours before</option>
            <option value="3_hours_before">3 hours before</option>
            <option value="custom">Custom minutes before</option>
          </select>
          {form.timing_rule === "custom" && (
            <input type="number" className="bl-input" min={0} value={form.timing_custom_minutes} onChange={e => setForm({ ...form, timing_custom_minutes: e.target.value })} placeholder="Minutes before appointment" />
          )}
          <input className="bl-input" placeholder="Provider template name (WhatsApp approved)" value={form.provider_template_name} onChange={e => setForm({ ...form, provider_template_name: e.target.value })} />
          <input className="bl-input" placeholder="Provider template ID" value={form.provider_template_id} onChange={e => setForm({ ...form, provider_template_id: e.target.value })} />
          {messagingProvider === "whatsjet" && (
            <>
              <input className="bl-input" placeholder="Language code (e.g. id, en)" value={form.language} onChange={e => setForm({ ...form, language: e.target.value })} data-testid="whatsjet-tpl-language" />
              <input
                className="bl-input font-mono text-sm"
                placeholder="Variable mapping (comma-separated tags, e.g. patient_name, appointment_date)"
                value={variableMappingStr}
                onChange={e => setVariableMappingStr(e.target.value)}
                data-testid="whatsjet-variable-mapping"
              />
              <p className="text-xs text-[#5C6C62] sm:col-span-2">
                When WhatsJet template name is set, ClinicOS sends via the template API using these tags in order.
                Leave empty to send the rendered message body as plain text instead.
              </p>
            </>
          )}
        </div>
        <textarea className="bl-input min-h-[100px]" placeholder="Message body" value={form.message_body} onChange={e => setForm({ ...form, message_body: e.target.value })} data-testid="tpl-body" />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.active}
            disabled={!automationActive}
            onChange={e => setForm({ ...form, active: e.target.checked })}
            data-testid="tpl-active-automation"
          />
          Active for automation
        </label>
        {!automationActive && (
          <p className="text-xs text-[#5C6C62]">Connect an API provider to enable automatic sends for this template.</p>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={save} disabled={busy} className="bl-btn-primary">{busy ? "Saving…" : editingId ? "Update" : "Add template"}</button>
          {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(empty); }} className="bl-btn-ghost">Cancel</button>}
        </div>
      </div>

      <div className="bl-card overflow-hidden">
        <table className="bl-data-table w-full text-sm">
          <thead className="bl-data-table-head">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Timing</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map(t => (
              <tr key={t.id} className="border-t border-[#EAE6D7]">
                <td className="px-4 py-3 font-medium">{t.template_name}</td>
                <td className="px-4 py-3 text-[#5C6C62]">{t.template_type?.replace(/_/g, " ")}</td>
                <td className="px-4 py-3 text-[#5C6C62]">{t.timing_rule?.replace(/_/g, " ")}</td>
                <td className="px-4 py-3">{t.active ? "Yes" : "No"}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button type="button" onClick={() => startEdit(t)} className="text-xs underline">Edit</button>
                  <button type="button" onClick={() => remove(t)} className="text-xs text-[#B14A2C]">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showLogs && (
      <div className="bl-card overflow-hidden">
        <div className="px-4 py-3 border-b border-[#EAE6D7] font-display">Recent message log</div>
        <div className="max-h-64 overflow-y-auto">
          {logs.length === 0 && <p className="px-4 py-6 text-sm text-[#5C6C62] text-center">No messages yet.</p>}
          {logs.slice(0, 30).map(l => (
            <div key={l.id} className="px-4 py-2 border-t border-[#EAE6D7] text-xs">
              <span className="font-medium capitalize">{l.status}</span>
              <span className="text-[#5C6C62]"> · {l.template_type || "—"} · {l.recipient}</span>
              {l.error_message && <span className="text-[#B14A2C]"> · {l.error_message}</span>}
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}

const AUTOMATION_TRIGGERS = [
  { value: "booking_created", label: "Appointment created" },
  { value: "booking_rescheduled", label: "Appointment rescheduled" },
  { value: "booking_confirmed", label: "Appointment confirmed" },
  { value: "booking_cancelled", label: "Appointment cancelled" },
  { value: "before_appointment", label: "Appointment reminder" },
  { value: "consent_required_missing", label: "Consent form request" },
  { value: "visit_completed", label: "Visit completed / aftercare follow-up" },
  { value: "package_balance_low", label: "Package/session remaining reminder" },
  { value: "package_expiry_reminder", label: "Package expiry reminder" },
  { value: "invoice_paid", label: "Invoice paid" },
  { value: "gift_card_issued", label: "Gift card issued" },
];

const AUTOMATION_DYNAMIC_TAGS = [
  "patient_name", "clinic_name", "patient_phone", "appointment_date", "appointment_time",
  "treatment_name", "performer_name", "consent_link", "payment_amount", "payment_link",
  "gift_card_code", "package_balance", "package_name", "invoice_number", "wallet_balance",
];

function MessagingAutomationTab() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "messaging.automation.manage") || user?.role === "super_admin" || user?.role === "manager";
  const empty = {
    name: "",
    trigger_type: "before_appointment",
    timing_type: "before_event",
    timing_value: 1,
    timing_unit: "days",
    whatsjet_template_name: "",
    language_code: "id",
    variable_mapping: ["patient_name", "clinic_name", "appointment_date"],
    preview_text: "",
    enabled: false,
    conditions: { send_once_per_booking: true, require_phone: true },
  };
  const [rules, setRules] = useState([]);
  const [runs, setRuns] = useState([]);
  const [provider, setProvider] = useState("");
  const [automationSendingEnabled, setAutomationSendingEnabled] = useState(false);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testBookingId, setTestBookingId] = useState("");

  const load = () => {
    api.get("/messaging/automation/rules").then(r => {
      setRules(r.data.items || []);
      setProvider(r.data.provider || "");
    }).catch(() => toast.error("Could not load automation rules"));
    api.get("/messaging/automation/runs", { params: { limit: 30 } }).then(r => setRuns(r.data.items || [])).catch(() => {});
    api.get("/settings/messaging").then(r => {
      setAutomationSendingEnabled(!!r.data.whatsgo_automation_sending_enabled);
    }).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const setVariableAt = (index, tag) => {
    const mapping = [...(form.variable_mapping || [])];
    while (mapping.length <= index) mapping.push("");
    mapping[index] = tag;
    setForm({ ...form, variable_mapping: mapping.filter((_, i) => i < 5 || mapping[i]) });
  };

  const addVariableSlot = () => {
    const mapping = [...(form.variable_mapping || []), ""];
    setForm({ ...form, variable_mapping: mapping.slice(0, 8) });
  };

  const save = async () => {
    if (!canManage) return;
    if (!form.name.trim() || !form.whatsjet_template_name.trim()) {
      toast.error("Rule name and Whatsgo template name required");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        ...form,
        timing_value: Number(form.timing_value) || 0,
        variable_mapping: (form.variable_mapping || []).filter(Boolean),
      };
      if (form.timing_type === "immediately") payload.timing_value = 0;
      if (editingId) {
        await api.put(`/messaging/automation/rules/${editingId}`, payload);
        toast.success("Rule updated");
      } else {
        await api.post("/messaging/automation/rules", payload);
        toast.success("Rule created");
      }
      setForm(empty);
      setEditingId(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save rule");
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (rule) => {
    if (!canManage) return;
    try {
      await api.patch(`/messaging/automation/rules/${rule.id}/enabled?enabled=${!rule.enabled}`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to update rule");
    }
  };

  const remove = (rule) => {
    if (!canManage) return;
    confirmAction(`Delete automation rule "${rule.name}"?`, async () => {
      await api.delete(`/messaging/automation/rules/${rule.id}`);
      load();
    });
  };

  const testRule = async (rule) => {
    if (!canManage) return;
    try {
      const body = { trigger_type: rule.trigger_type };
      if (testBookingId.trim()) body.booking_id = testBookingId.trim();
      const r = await api.post(`/messaging/automation/rules/${rule.id}/test`, body);
      toast.success(`Test run finished (${(r.data.recent_runs || []).length} recent runs)`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Test failed");
    }
  };

  const runDue = async () => {
    if (!canManage) return;
    try {
      const r = await api.post("/messaging/automation/run-due");
      toast.success(`Processed ${r.data.processed || 0} due automation(s)`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Run failed");
    }
  };

  const startEdit = (rule) => {
    setEditingId(rule.id);
    setForm({
      ...empty,
      ...rule,
      whatsjet_template_name: rule.whatsjet_template_name || rule.provider_template_name || "",
      variable_mapping: rule.variable_mapping || rule.whatsjet_variable_mapping || empty.variable_mapping,
      conditions: rule.conditions || empty.conditions,
    });
  };

  const showReminderWarning = form.trigger_type === "before_appointment";
  const variableSlots = form.variable_mapping?.length ? form.variable_mapping : [""];

  return (
    <div className="max-w-4xl space-y-6" data-testid="messaging-automation-form">
      <div className="bl-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-display text-lg text-[#2D3A33]">Automations</div>
            <p className="text-sm text-[#5C6C62] mt-1">
              Map ClinicOS events to approved Whatsgo templates. Templates are managed in Whatsgo — sync them on the Templates tab.
            </p>
          </div>
          {canManage && (
            <button type="button" onClick={runDue} className="bl-btn-secondary text-sm" data-testid="automation-run-due">
              Run due automations
            </button>
          )}
        </div>

        {canManage && provider === "whatsgo" && (
          <div className="rounded-xl border border-[#EAE6D7] bg-[#F8F5EC] p-4 space-y-3" data-testid="whatsgo-automation-master">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={automationSendingEnabled}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  try {
                    await api.put("/settings/messaging", {
                      enable_messaging: true,
                      provider: "whatsgo",
                      whatsgo_automation_sending_enabled: enabled,
                    });
                    setAutomationSendingEnabled(enabled);
                    toast.success(enabled ? "Automatic Whatsgo sending enabled" : "Automatic Whatsgo sending disabled");
                  } catch (err) {
                    toast.error(err?.response?.data?.detail || "Could not update automation setting");
                  }
                }}
                data-testid="whatsgo-automation-sending-enabled"
              />
              <span className="text-sm text-[#2D3A33]">
                Enable automatic Whatsgo message sending
                <span className="block text-xs text-[#5C6C62] mt-1">
                  Rules stay disabled until you turn them on individually. Keep this off until connection, sync, and test send are verified.
                </span>
              </span>
            </label>
          </div>
        )}

        {canManage && (
          <>
            <div className="font-display text-base text-[#2D3A33] pt-2">{editingId ? "Edit rule" : "New rule"}</div>
            <p className="text-xs text-[#5C6C62] bg-[#F8F5EC] border border-[#EAE6D7] rounded-lg px-3 py-2">
              Create and approve WhatsApp templates in Whatsgo first, then sync and select the template name here.
              ClinicOS sends via Whatsgo — it does not submit templates for Meta approval.
            </p>
            {showReminderWarning && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid="automation-reminder-warning">
                Scheduled reminders require an approved WhatsApp template outside the 24-hour customer service window.
                {!form.whatsjet_template_name && " Enter the approved template name below."}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className="bl-input" placeholder="Rule name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="automation-rule-name" />
              <select className="bl-input" value={form.trigger_type} onChange={e => setForm({ ...form, trigger_type: e.target.value })} data-testid="automation-trigger">
                {AUTOMATION_TRIGGERS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select className="bl-input" value={form.timing_type} onChange={e => setForm({ ...form, timing_type: e.target.value })}>
                <option value="immediately">Immediately</option>
                <option value="before_event">Before event</option>
                <option value="after_event">After event</option>
              </select>
              {form.timing_type !== "immediately" && (
                <>
                  <input type="number" min={0} className="bl-input" placeholder="Timing value" value={form.timing_value} onChange={e => setForm({ ...form, timing_value: e.target.value })} data-testid="automation-timing-value" />
                  <select className="bl-input" value={form.timing_unit} onChange={e => setForm({ ...form, timing_unit: e.target.value })} data-testid="automation-timing-unit">
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </>
              )}
              <input
                className="bl-input sm:col-span-2 font-mono text-sm"
                placeholder="Whatsgo approved template name"
                value={form.whatsjet_template_name}
                onChange={e => setForm({ ...form, whatsjet_template_name: e.target.value })}
                data-testid="automation-whatsjet-template"
              />
              <input className="bl-input" placeholder="Language code (e.g. id, en)" value={form.language_code} onChange={e => setForm({ ...form, language_code: e.target.value })} data-testid="automation-language" />
            </div>

            <div className="space-y-2 rounded-xl border border-[#EAE6D7] p-4">
              <p className="text-xs font-medium text-[#2D3A33]">Template variables (order matters)</p>
              <p className="text-xs text-[#5C6C62]">Map each Whatsgo template variable to a dynamic tag from your appointment/patient context.</p>
              {variableSlots.map((tag, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[#5C6C62] w-20 shrink-0">Variable {i + 1}</span>
                  <select
                    className="bl-input flex-1 min-w-[160px]"
                    value={tag}
                    onChange={e => setVariableAt(i, e.target.value)}
                    data-testid={`automation-var-${i + 1}`}
                  >
                    <option value="">— Select tag —</option>
                    {AUTOMATION_DYNAMIC_TAGS.map(t => (
                      <option key={t} value={t}>{`{{${t}}}`}</option>
                    ))}
                  </select>
                </div>
              ))}
              {variableSlots.length < 8 && (
                <button type="button" onClick={addVariableSlot} className="text-xs underline text-[#5C6C62]">+ Add variable</button>
              )}
            </div>

            <textarea
              className="bl-input min-h-[80px] text-sm"
              placeholder="Preview text (optional — for display/testing only, not sent to WhatsJet)"
              value={form.preview_text}
              onChange={e => setForm({ ...form, preview_text: e.target.value })}
              data-testid="automation-preview-text"
            />

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />
              Enabled
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={busy} className="bl-btn-primary" data-testid="automation-save">{busy ? "Saving…" : editingId ? "Update rule" : "Add rule"}</button>
              {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(empty); }} className="bl-btn-ghost">Cancel</button>}
            </div>
            <div className="pt-2 border-t border-[#EAE6D7]">
              <label className="label-eyebrow block mb-1">Test with appointment ID (optional)</label>
              <input className="bl-input max-w-md" placeholder="Appointment UUID for test send" value={testBookingId} onChange={e => setTestBookingId(e.target.value)} />
            </div>
          </>
        )}
      </div>

      <div className="bl-card overflow-hidden">
        <table className="bl-data-table w-full text-sm">
          <thead className="bl-data-table-head">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Trigger</th>
              <th className="px-4 py-3">WhatsJet template</th>
              <th className="px-4 py-3">Timing</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id} className="border-t border-[#EAE6D7]">
                <td className="px-4 py-3 font-medium">{r.name}</td>
                <td className="px-4 py-3 text-[#5C6C62]">{r.trigger_type?.replace(/_/g, " ")}</td>
                <td className="px-4 py-3 font-mono text-xs text-[#5C6C62]">{r.whatsjet_template_name || r.provider_template_name || "—"}</td>
                <td className="px-4 py-3 text-[#5C6C62]">
                  {r.timing_type === "immediately" ? "Immediately" : `${r.timing_value} ${r.timing_unit} ${r.timing_type === "before_event" ? "before" : "after"}`}
                </td>
                <td className="px-4 py-3">{r.enabled ? "Yes" : "No"}</td>
                <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                  {canManage && <button type="button" onClick={() => toggleEnabled(r)} className="text-xs underline">{r.enabled ? "Disable" : "Enable"}</button>}
                  {canManage && <button type="button" onClick={() => startEdit(r)} className="text-xs underline">Edit</button>}
                  {canManage && <button type="button" onClick={() => testRule(r)} className="text-xs underline" data-testid={`automation-test-${r.id}`}>Test</button>}
                  {canManage && <button type="button" onClick={() => remove(r)} className="text-xs text-[#B14A2C]">Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rules.length === 0 && <p className="px-4 py-6 text-sm text-[#5C6C62] text-center">No automation rules yet. Add a rule with your approved WhatsJet template name.</p>}
      </div>

      <div className="bl-card overflow-hidden">
        <div className="px-4 py-3 border-b border-[#EAE6D7] font-display">Recent automation runs</div>
        <div className="max-h-64 overflow-y-auto">
          {runs.length === 0 && <p className="px-4 py-6 text-sm text-[#5C6C62] text-center">No runs yet.</p>}
          {runs.slice(0, 30).map(run => (
            <div key={run.id} className="px-4 py-2 border-t border-[#EAE6D7] text-xs">
              <span className="font-medium capitalize">{run.status}</span>
              <span className="text-[#5C6C62]"> · {run.reference_type} · {run.reference_id?.slice(0, 8)}</span>
              {run.skip_reason && <span className="text-amber-800"> · {run.skip_reason}</span>}
              {run.error_message && <span className="text-[#B14A2C]"> · {run.error_message}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export {
  BrandingTab,
  ScheduleTab,
  SecuritySettingsTab,
  CouponsTab,
  CampaignsTab,
  LoyaltyTab,
  DoctorFormTab,
  TherapistFormTab,
  TreatmentTab,
  TreatmentCategoriesTab,
  UnitTypesTab,
  InventorySettingsTab,
  MappingTab,
  OnlineBookingPaymentTab,
  MessagingSettingsTab,
  MessagingTemplatesTab,
  MessagingLogsTab,
  MessagingAutomationTab,
};
