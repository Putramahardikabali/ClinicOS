import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, Save, ToggleLeft, ToggleRight, Banknote, Phone, Layers, Palette, Upload } from "lucide-react";

const inputCls = "w-full px-3 py-2 rounded-lg outline-none text-sm";
const inputStyle = { background: "#0F1419", border: "1px solid #2A3942", color: "#F5F2EA" };

function genId() { return "b_" + Math.random().toString(36).slice(2, 10); }

function Tabs({ tab, setTab }) {
  const items = [
    { key: "general", label: "General", icon: Phone },
    { key: "branding", label: "Branding", icon: Palette },
    { key: "banks", label: "Bank accounts", icon: Banknote },
    { key: "plans", label: "Plan pricing", icon: Layers },
  ];
  return (
    <div className="mt-4 flex gap-1 p-1 rounded-xl w-fit" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
      {items.map(t => {
        const Icon = t.icon;
        const active = tab === t.key;
        return (
          <button key={t.key} onClick={() => setTab(t.key)} className="px-3 py-1.5 rounded-lg text-sm inline-flex items-center gap-1.5" style={active ? { background: "#1F2D34", color: "#F5F2EA" } : { color: "#8FA89E" }} data-testid={`sa-settings-tab-${t.key}`}>
            <Icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function SaSettingsPage() {
  const [tab, setTab] = useState("general");
  const [s, setS] = useState(null);
  const [plansCatalog, setPlansCatalog] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = () => api.get("/superadmin/platform-settings").then(r => setS(r.data));
  useEffect(() => {
    load();
    api.get("/plans").then(r => setPlansCatalog(r.data || []));
  }, []);

  const save = async (patch) => {
    setBusy(true);
    try {
      const r = await api.put("/superadmin/platform-settings", patch);
      setS(r.data);
      // refresh plans catalog (may include new overrides)
      const p = await api.get("/plans");
      setPlansCatalog(p.data || []);
      toast.success("Saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  if (!s) return <div className="p-10" style={{ color: "#8FA89E" }}>Loading…</div>;

  return (
    <div className="p-6 md:p-10 max-w-5xl" data-testid="sa-settings-page">
      <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Platform configuration</div>
      <h1 className="font-display text-3xl mt-2" style={{ color: "#F5F2EA" }}>Settings</h1>
      <p className="mt-2 text-sm" style={{ color: "#8FA89E" }}>Manage SaaS-wide support, billing accounts, and plan pricing. Changes apply to all clinics immediately.</p>

      <Tabs tab={tab} setTab={setTab} />

      {tab === "general" && <GeneralTab s={s} save={save} busy={busy} />}
      {tab === "branding" && <BrandingTab s={s} save={save} busy={busy} load={load} />}
      {tab === "banks" && <BanksTab s={s} save={save} busy={busy} />}
      {tab === "plans" && <PlansTab plansCatalog={plansCatalog} s={s} save={save} busy={busy} />}
    </div>
  );
}

// ---------------- General ----------------
function GeneralTab({ s, save, busy }) {
  const [form, setForm] = useState({
    platform_name: s.platform_name || "",
    support_whatsapp: s.support_whatsapp || "",
    support_hours: s.support_hours || "",
    support_email: s.support_email || "",
  });
  return (
    <div className="mt-6 p-5 rounded-2xl space-y-4" style={{ background: "#141B22", border: "1px solid #1F2A30" }} data-testid="sa-general-form">
      <Field label="Platform name" value={form.platform_name} onChange={v => setForm({ ...form, platform_name: v })} testid="sa-platform-name" hint="Shown on emails and checkout page." />
      <Field label="Support WhatsApp number" value={form.support_whatsapp} onChange={v => setForm({ ...form, support_whatsapp: v })} testid="sa-support-whatsapp" hint="International format, no +. e.g., 6281234567890" />
      <Field label="Support business hours" value={form.support_hours} onChange={v => setForm({ ...form, support_hours: v })} testid="sa-support-hours" hint="e.g., Mon-Fri 9am-6pm WITA" />
      <Field label="Support email" value={form.support_email} onChange={v => setForm({ ...form, support_email: v })} testid="sa-support-email" />
      <button onClick={() => save(form)} disabled={busy} className="px-4 py-2 rounded-lg text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: "#3F5A52" }} data-testid="sa-general-save">
        <Save className="w-4 h-4" /> Save changes
      </button>
    </div>
  );
}

function BrandingTab({ s, save, busy, load }) {
  const b = s.platform_branding || {};
  const [form, setForm] = useState({
    app_name: b.app_name || "ClinicOS",
    short_name: b.short_name || "ClinicOS",
    description: b.description || "Clinic management system",
    theme_color: b.theme_color || "#3F5A52",
    background_color: b.background_color || "#FDFBF7",
    favicon_url: b.favicon_url || "",
    app_icon_192_url: b.app_icon_192_url || "",
    app_icon_512_url: b.app_icon_512_url || "",
    maskable_icon_url: b.maskable_icon_url || "",
    login_logo_url: b.login_logo_url || "",
    sidebar_logo_url: b.sidebar_logo_url || "",
  });
  const [uploading, setUploading] = useState("");

  const upload = async (assetType, file) => {
    if (!file) return;
    setUploading(assetType);
    try {
      const fd = new FormData();
      fd.append("asset_type", assetType);
      fd.append("file", file);
      const r = await api.post("/superadmin/platform/branding/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((prev) => ({ ...prev, [r.data.field]: r.data.url }));
      await load();
      toast.success("Asset uploaded");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading("");
    }
  };

  return (
    <div className="mt-6 space-y-5" data-testid="sa-branding-tab">
      <div className="p-5 rounded-2xl space-y-4" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Platform app branding</div>
        <Field label="App Name" value={form.app_name} onChange={(v) => setForm({ ...form, app_name: v })} testid="sa-branding-app-name" />
        <Field label="Short Name" value={form.short_name} onChange={(v) => setForm({ ...form, short_name: v })} testid="sa-branding-short-name" />
        <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} testid="sa-branding-description" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Theme Color" value={form.theme_color} onChange={(v) => setForm({ ...form, theme_color: v })} testid="sa-branding-theme-color" />
          <Field label="Background Color" value={form.background_color} onChange={(v) => setForm({ ...form, background_color: v })} testid="sa-branding-bg-color" />
        </div>
        <button onClick={() => save(form)} disabled={busy} className="px-4 py-2 rounded-lg text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: "#3F5A52" }} data-testid="sa-branding-save">
          <Save className="w-4 h-4" /> Save branding
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UploadCard title="Favicon" hint=".ico / .png / .svg" value={form.favicon_url} uploading={uploading === "favicon"} onPick={(f) => upload("favicon", f)} testid="sa-branding-favicon" />
        <UploadCard title="App Icon 192" hint="PNG 192x192" value={form.app_icon_192_url} uploading={uploading === "app_icon_192"} onPick={(f) => upload("app_icon_192", f)} testid="sa-branding-icon-192" />
        <UploadCard title="App Icon 512" hint="PNG 512x512" value={form.app_icon_512_url} uploading={uploading === "app_icon_512"} onPick={(f) => upload("app_icon_512", f)} testid="sa-branding-icon-512" />
        <UploadCard title="Maskable Icon" hint="PNG square" value={form.maskable_icon_url} uploading={uploading === "maskable_icon"} onPick={(f) => upload("maskable_icon", f)} testid="sa-branding-maskable" />
        <UploadCard title="Login Logo" hint="PNG recommended" value={form.login_logo_url} uploading={uploading === "login_logo"} onPick={(f) => upload("login_logo", f)} testid="sa-branding-login-logo" />
        <UploadCard title="Sidebar Logo" hint="PNG recommended" value={form.sidebar_logo_url} uploading={uploading === "sidebar_logo"} onPick={(f) => upload("sidebar_logo", f)} testid="sa-branding-sidebar-logo" />
      </div>
    </div>
  );
}

function UploadCard({ title, hint, value, uploading, onPick, testid }) {
  return (
    <div className="p-4 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }} data-testid={testid}>
      <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>{title}</div>
      <div className="text-xs mt-1" style={{ color: "#8FA89E" }}>{hint}</div>
      <div className="mt-3 rounded-lg p-3 min-h-[90px] flex items-center justify-center" style={{ background: "#0F1419", border: "1px solid #2A3942" }}>
        {value ? <img src={value} alt={title} className="max-h-16 object-contain" /> : <div className="text-xs" style={{ color: "#8FA89E" }}>No asset uploaded</div>}
      </div>
      <label className="mt-3 px-3 py-2 rounded-lg text-sm inline-flex items-center gap-2 cursor-pointer" style={{ background: "#1A242B", color: "#E6E8E6", border: "1px solid #2A3942" }}>
        <Upload className="w-4 h-4" /> {uploading ? "Uploading..." : "Upload"}
        <input type="file" className="hidden" accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml" onChange={(e) => onPick(e.target.files?.[0])} />
      </label>
    </div>
  );
}

function Field({ label, value, onChange, testid, hint, type = "text" }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className={inputCls + " mt-1.5"} style={inputStyle} data-testid={testid} />
      {hint && <div className="text-xs mt-1" style={{ color: "#8FA89E" }}>{hint}</div>}
    </div>
  );
}

// ---------------- Banks ----------------
function BanksTab({ s, save, busy }) {
  const [banks, setBanks] = useState(s.banks || []);
  const setBank = (i, patch) => setBanks(banks.map((b, j) => j === i ? { ...b, ...patch } : b));
  const removeBank = (i) => setBanks(banks.filter((_, j) => j !== i));
  const addBank = () => setBanks([...banks, { id: genId(), bank: "", account_number: "", account_holder: "", active: true, note: "" }]);
  return (
    <div className="mt-6 space-y-4" data-testid="sa-banks-tab">
      <div className="p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Bank accounts</div>
            <p className="text-sm mt-1" style={{ color: "#8FA89E" }}>These appear on the <code>/billing/checkout</code> page for all clinics. Toggle to show/hide individual accounts.</p>
          </div>
          <button onClick={addBank} className="text-sm px-3 py-2 rounded-lg inline-flex items-center gap-1.5" style={{ background: "#1A242B", color: "#E6E8E6", border: "1px solid #2A3942" }} data-testid="sa-add-bank">
            <Plus className="w-3.5 h-3.5" /> Add bank
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {banks.length === 0 && <div className="text-sm" style={{ color: "#8FA89E" }}>No banks yet. Add one to show payment options to clinics.</div>}
          {banks.map((b, i) => (
            <div key={b.id || i} className="p-4 rounded-xl grid grid-cols-1 md:grid-cols-12 gap-3 items-start" style={{ background: "#0F1419", border: "1px solid #1F2A30" }} data-testid={`sa-bank-row-${i}`}>
              <div className="md:col-span-3">
                <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Bank</label>
                <input value={b.bank} onChange={e => setBank(i, { bank: e.target.value })} className={inputCls + " mt-1"} style={inputStyle} placeholder="BCA / Mandiri" data-testid={`sa-bank-name-${i}`} />
              </div>
              <div className="md:col-span-3">
                <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Account number</label>
                <input value={b.account_number} onChange={e => setBank(i, { account_number: e.target.value })} className={inputCls + " mt-1 font-mono"} style={inputStyle} data-testid={`sa-bank-number-${i}`} />
              </div>
              <div className="md:col-span-4">
                <label className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>Holder name</label>
                <input value={b.account_holder} onChange={e => setBank(i, { account_holder: e.target.value })} className={inputCls + " mt-1"} style={inputStyle} data-testid={`sa-bank-holder-${i}`} />
              </div>
              <div className="md:col-span-2 flex items-end gap-2 justify-end">
                <button onClick={() => setBank(i, { active: !b.active })} className="px-2.5 py-2 rounded-lg text-xs inline-flex items-center gap-1.5" style={{ background: b.active ? "#1F3A30" : "#3A1F1F", color: b.active ? "#8AC3A8" : "#D58B6B", border: "1px solid #2A3942" }} data-testid={`sa-bank-toggle-${i}`}>
                  {b.active ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                  {b.active ? "Active" : "Hidden"}
                </button>
                <button onClick={() => removeBank(i)} className="p-2 rounded-lg" style={{ background: "#1A242B", color: "#D58B6B", border: "1px solid #2A3942" }} data-testid={`sa-bank-delete-${i}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <button onClick={() => save({ banks })} disabled={busy} className="mt-5 px-4 py-2 rounded-lg text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: "#3F5A52" }} data-testid="sa-banks-save">
          <Save className="w-4 h-4" /> Save banks
        </button>
      </div>
    </div>
  );
}

// ---------------- Plans ----------------
function PlansTab({ plansCatalog, s, save, busy }) {
  const [overrides, setOverrides] = useState(s.plan_overrides || {});
  const setOv = (key, field, val) => setOverrides({ ...overrides, [key]: { ...(overrides[key] || {}), [field]: val === "" ? null : Number(val) } });

  return (
    <div className="mt-6 space-y-3" data-testid="sa-plans-tab">
      <div className="text-xs" style={{ color: "#8FA89E" }}>Override pricing and limits per plan. Feature flags are code-defined and not editable here.</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plansCatalog.map(p => {
          const ov = overrides[p.key] || {};
          return (
            <div key={p.key} className="p-5 rounded-2xl" style={{ background: "#141B22", border: "1px solid #1F2A30" }} data-testid={`sa-plan-card-${p.key}`}>
              <div className="text-xs uppercase tracking-widest" style={{ color: "#8FA89E" }}>{p.name}</div>
              <div className="font-display text-2xl mt-1" style={{ color: "#F5F2EA" }}>Rp {Number(p.price_idr).toLocaleString("id-ID")}</div>
              <div className="text-xs mt-1" style={{ color: "#8FA89E" }}>{p.max_staff} staff · {p.storage_gb} GB</div>

              <div className="mt-4 space-y-3">
                <Field label="Price (IDR/mo)" value={ov.price_idr ?? ""} onChange={v => setOv(p.key, "price_idr", v)} testid={`sa-plan-price-${p.key}`} type="number" hint={`Default: ${p.price_idr.toLocaleString("id-ID")}`} />
                <Field label="Max staff" value={ov.max_staff ?? ""} onChange={v => setOv(p.key, "max_staff", v)} testid={`sa-plan-staff-${p.key}`} type="number" />
                <Field label="Storage (GB)" value={ov.storage_gb ?? ""} onChange={v => setOv(p.key, "storage_gb", v)} testid={`sa-plan-storage-${p.key}`} type="number" />
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={() => {
        // Strip empty / null overrides for clean storage
        const cleaned = {};
        for (const [k, v] of Object.entries(overrides)) {
          const filtered = Object.fromEntries(Object.entries(v).filter(([_, val]) => val !== null && val !== "" && !Number.isNaN(val)));
          if (Object.keys(filtered).length) cleaned[k] = filtered;
        }
        save({ plan_overrides: cleaned });
      }} disabled={busy} className="mt-2 px-4 py-2 rounded-lg text-white text-sm inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: "#3F5A52" }} data-testid="sa-plans-save">
        <Save className="w-4 h-4" /> Save plan pricing
      </button>
    </div>
  );
}
