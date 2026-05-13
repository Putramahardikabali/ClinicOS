import { useEffect, useState } from "react";
import api, { API_BASE } from "@/lib/api";
import { useSettings, logoUrl } from "@/lib/settings";
import { toast } from "sonner";
import { Settings, Users as UsersIcon, Stethoscope, Heart, Pill, MapPin, Plus, Trash2, Upload, RefreshCw } from "lucide-react";

const TABS = [
  { key: "branding", label: "Branding", icon: Settings },
  { key: "users", label: "Users", icon: UsersIcon },
  { key: "doctor", label: "Doctor Form", icon: Stethoscope },
  { key: "therapist", label: "Therapist Form", icon: Heart },
  { key: "treatment", label: "Treatments", icon: Pill },
  { key: "mapping", label: "Mapping Templates", icon: MapPin },
];

export default function AdminPage() {
  const [tab, setTab] = useState("branding");
  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl">
      <div className="label-eyebrow">System</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Admin Settings</h1>
      <p className="mt-2 text-[#5C6C62]">Manage branding, users, form fields, and mapping templates for the entire clinic.</p>

      <div className="mt-7 border-b border-[#EAE6D7] flex gap-1 overflow-x-auto" data-testid="admin-tabs">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={()=>setTab(t.key)} className={`px-4 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-2 whitespace-nowrap transition ${active ? "text-[#2D3A33]" : "border-transparent text-[#5C6C62] hover:text-[#2D3A33]"}`} style={active ? { borderColor: "var(--bl-primary)" } : { borderColor: "transparent" }} data-testid={`admin-tab-${t.key}`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      <div className="mt-7">
        {tab === "branding" && <BrandingTab />}
        {tab === "users" && <UsersTab />}
        {tab === "doctor" && <DoctorFormTab />}
        {tab === "therapist" && <TherapistFormTab />}
        {tab === "treatment" && <TreatmentTab />}
        {tab === "mapping" && <MappingTab />}
      </div>
    </div>
  );
}

/* ---------------- Branding ---------------- */
function BrandingTab() {
  const { settings, branding, refresh } = useSettings();
  const [b, setB] = useState(branding);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setB(branding); }, [branding]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/admin/settings", { branding: b });
      toast.success("Branding updated");
      await refresh();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const onLogo = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    try {
      await api.post("/admin/logo", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Logo uploaded");
      await refresh();
    } catch (err) { toast.error("Upload failed"); }
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
        <div className="font-display text-lg mb-4 text-[#2D3A33]">Theme colors</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { k: "primary_color", label: "Primary" },
            { k: "primary_hover", label: "Primary hover" },
            { k: "accent_color", label: "Accent" },
            { k: "background", label: "Background" },
            { k: "surface", label: "Surface" },
            { k: "text_primary", label: "Text" },
          ].map(c => (
            <div key={c.k}>
              <label className="label-eyebrow block mb-2">{c.label}</label>
              <div className="flex items-center gap-2">
                <input type="color" className="w-12 h-10 rounded-lg border border-[#EAE6D7] cursor-pointer" value={b[c.k] || "#000000"} onChange={(e)=>setB({...b, [c.k]: e.target.value})} />
                <input className="bl-input flex-1 font-mono text-sm" value={b[c.k] || ""} onChange={(e)=>setB({...b, [c.k]: e.target.value})} data-testid={`branding-${c.k}`} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={save} disabled={busy} className="bl-btn-primary" data-testid="branding-save">{busy ? "Saving…" : "Save branding"}</button>
        <button onClick={()=>setB(branding)} className="bl-btn-ghost">Reset</button>
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
      <div className="bl-card overflow-hidden" data-testid="users-table">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#F8F5EC]">
              <tr className="text-left text-xs uppercase tracking-widest text-[#5C6C62]">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t border-[#EAE6D7]">
                  <td className="px-5 py-3 font-medium">{u.name}</td>
                  <td className="px-5 py-3 text-[#5C6C62]">{u.email}</td>
                  <td className="px-5 py-3"><span className="bl-chip capitalize">{u.role.replace("_"," ")}</span></td>
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
                <option value="fo">Front Office</option>
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

  const updateSection = (i, k, v) => setSections(sections.map((s, idx) => idx === i ? { ...s, [k]: v } : s));
  const updateSub = (si, ji, k, v) => setSections(sections.map((s, idx) => idx === si ? { ...s, subs: s.subs.map((sub, jdx) => jdx === ji ? { ...sub, [k]: v } : sub) } : s));
  const updateOpt = (si, ji, options) => updateSub(si, ji, "options", options);

  const addSection = () => setSections([...sections, { key: `section_${Date.now()}`, label: "New section", subs: [{ key: "status", label: "", options: ["Yes", "No"] }] }]);
  const removeSection = (i) => setSections(sections.filter((_, idx) => idx !== i));
  const addSub = (si) => updateSection(si, "subs", [...sections[si].subs, { key: `sub_${Date.now()}`, label: "", options: ["Yes", "No"] }]);
  const removeSub = (si, ji) => updateSection(si, "subs", sections[si].subs.filter((_, idx) => idx !== ji));

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#5C6C62]">Manage face assessment sections shown on the doctor's clinical form. Each section has one or more sub-questions with their own option chips.</p>
      <div className="space-y-4" data-testid="doctor-form-editor">
        {sections.map((sec, i) => (
          <div key={i} className="bl-card p-5">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <input className="bl-input flex-1 min-w-[200px] font-medium" value={sec.label} onChange={(e)=>updateSection(i, "label", e.target.value)} placeholder="Section label" />
              <input className="bl-input w-44 font-mono text-sm" value={sec.key} onChange={(e)=>updateSection(i, "key", e.target.value)} placeholder="key" />
              <button onClick={()=>removeSection(i)} className="text-[#B14A2C]"><Trash2 className="w-4 h-4" /></button>
            </div>
            <div className="space-y-2 pl-3 border-l-2 border-[#EAE6D7]">
              {sec.subs.map((sub, j) => (
                <div key={j} className="flex flex-wrap items-center gap-2">
                  <input className="bl-input w-40 py-1.5" value={sub.label} onChange={(e)=>updateSub(i, j, "label", e.target.value)} placeholder="Sub-label (optional)" />
                  <input className="bl-input w-32 py-1.5 font-mono text-xs" value={sub.key} onChange={(e)=>updateSub(i, j, "key", e.target.value)} placeholder="key" />
                  <input className="bl-input flex-1 py-1.5 min-w-[200px]" value={sub.options.join(", ")} onChange={(e)=>updateOpt(i, j, e.target.value.split(",").map(x=>x.trim()).filter(Boolean))} placeholder="Option1, Option2, Option3" />
                  <button onClick={()=>removeSub(i, j)} className="text-[#B14A2C]"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <button onClick={()=>addSub(i)} className="text-sm text-[#5C6C62] hover:text-[#2D3A33]">+ Add sub-question</button>
            </div>
          </div>
        ))}
        <button onClick={addSection} className="bl-btn-ghost inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Add section</button>
      </div>
      <div className="flex gap-3 pt-3">
        <button onClick={save} disabled={busy} className="bl-btn-primary" data-testid="doctor-form-save">{busy ? "Saving…" : "Save doctor form"}</button>
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
    <div className="space-y-6">
      <ListEditor title="Contraindication checklist" items={contraindications} setItems={setContras} placeholder="e.g. Pregnancy" testid="contra" />
      <ListEditor title="Devices / Machines" items={devices} setItems={setDevices} placeholder="e.g. RF (Radio Frequency)" testid="device" />
      <button onClick={save} className="bl-btn-primary" data-testid="therapist-form-save">Save therapist form</button>
    </div>
  );
}

/* ---------------- Treatment ---------------- */
function TreatmentTab() {
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

  return (
    <div className="space-y-6">
      <ListEditor title="Treatment categories" items={categories} setItems={setCats} placeholder="e.g. Injectable" testid="cat" />
      <ListEditor title="Unit types" items={units} setItems={setUnits} placeholder="e.g. ml" testid="unit" />
      <button onClick={save} className="bl-btn-primary" data-testid="treatment-form-save">Save</button>
    </div>
  );
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
  const removeTpl = (k) => { const next = { ...templates }; delete next[k]; setTemplates(next); };
  const reset = () => { if (window.confirm("Reload templates from server?")) refresh(); };

  const uploadImage = async (key, file) => {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await api.post("/admin/template-image", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setTemplates(prev => ({ ...prev, [key]: { ...prev[key], image_path: r.data.image_path, svg: "" } }));
      toast.success("Image uploaded — remember to save");
    } catch (e) { toast.error(e?.response?.data?.detail || "Upload failed"); }
  };

  const save = async () => {
    try {
      await api.put("/admin/settings", { mapping_templates: templates });
      toast.success("Templates saved");
      await refresh();
    } catch (e) { toast.error("Failed"); }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-[#5C6C62]">Customize the face/body outline templates used in the mapping canvas. Either upload a PNG/JPG/WebP image or paste raw SVG markup. Image takes precedence if both are set.</p>
      <div className="space-y-4" data-testid="mapping-editor">
        {Object.entries(templates).map(([key, tpl]) => (
          <div key={key} className="bl-card p-5">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <input className="bl-input w-44 font-mono text-sm" value={key} disabled />
              <input className="bl-input flex-1 min-w-[200px]" value={tpl.label || ""} onChange={(e)=>updateTpl(key, "label", e.target.value)} placeholder="Display label" />
              <button onClick={()=>removeTpl(key)} className="text-[#B14A2C]" title="Remove template"><Trash2 className="w-4 h-4" /></button>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-3">
              <label className="bl-btn-ghost inline-flex items-center gap-2 cursor-pointer text-sm" data-testid={`tpl-image-upload-${key}`}>
                <Upload className="w-4 h-4" /> {tpl.image_path ? "Replace image" : "Upload PNG / JPG"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e)=>uploadImage(key, e.target.files?.[0])} />
              </label>
              {tpl.image_path && (
                <button onClick={()=>updateTpl(key, "image_path", "")} className="text-sm text-[#B14A2C]">Remove image</button>
              )}
              <span className="text-xs text-[#5C6C62]">{tpl.image_path ? "Using uploaded image" : "Using SVG markup"}</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="label-eyebrow mb-1.5">SVG markup (fallback)</div>
                <textarea className="bl-input min-h-[160px] font-mono text-xs" value={tpl.svg || ""} onChange={(e)=>updateTpl(key, "svg", e.target.value)} placeholder="<svg ...>" disabled={!!tpl.image_path} />
              </div>
              <div>
                <div className="label-eyebrow mb-1.5">Preview</div>
                <div className="bg-[#FBF8EF] rounded-xl border border-[#EAE6D7] flex items-center justify-center p-3 min-h-[160px]">
                  {tpl.image_path ? (
                    <img src={`${API_BASE}/files/${tpl.image_path}`} alt={tpl.label} className="max-h-56 object-contain" />
                  ) : (
                    <div className="max-h-56" dangerouslySetInnerHTML={{ __html: tpl.svg || "" }} />
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <button onClick={addTpl} className="bl-btn-ghost inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Add template</button>
        <button onClick={reset} className="bl-btn-ghost inline-flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Reload from server</button>
        <button onClick={save} className="bl-btn-primary ml-auto" data-testid="mapping-templates-save">Save templates</button>
      </div>
    </div>
  );
}

/* ---------------- Generic List Editor ---------------- */
function ListEditor({ title, items, setItems, placeholder, testid }) {
  const [draft, setDraft] = useState("");
  const add = (e) => {
    e.preventDefault?.();
    if (!draft.trim()) return;
    setItems([...items, draft.trim()]); setDraft("");
  };
  const remove = (i) => setItems(items.filter((_, idx) => idx !== i));
  const move = (i, dir) => {
    const next = [...items];
    const j = i + dir; if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  return (
    <div className="bl-card p-5">
      <div className="font-display text-base text-[#2D3A33] mb-3">{title}</div>
      <div className="space-y-2 mb-4">
        {items.length === 0 && <div className="text-sm text-[#5C6C62]">No items yet</div>}
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2 bg-[#F8F5EC] px-3 py-2 rounded-lg" data-testid={`${testid}-item-${i}`}>
            <span className="flex-1 text-sm">{it}</span>
            <button onClick={()=>move(i, -1)} className="text-xs text-[#5C6C62] px-2">↑</button>
            <button onClick={()=>move(i, 1)} className="text-xs text-[#5C6C62] px-2">↓</button>
            <button onClick={()=>remove(i)} className="text-[#B14A2C]"><Trash2 className="w-3.5 h-3.5" /></button>
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
