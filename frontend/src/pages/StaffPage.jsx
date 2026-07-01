import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import api from "@/lib/api";
import { useAuth, hasPermission, ROLE_LABEL } from "@/lib/auth";
import { toast } from "sonner";
import {
  Users, Calendar, Shield, Plus, Trash2, AlertTriangle,
} from "lucide-react";
import StaffScheduleTab from "@/components/staff/StaffScheduleTab";

const TABS = [
  { key: "directory", label: "Staff Directory", icon: Users, permission: "staff.view" },
  { key: "schedule", label: "Staff Schedule", icon: Calendar, permission: "staff.view" },
  { key: "roles", label: "Roles & Permissions", icon: Shield, permission: "roles.view" },
];

const PERFORMER_TYPES = [
  { value: "", label: "— Not set —" },
  { value: "doctor", label: "Doctor" },
  { value: "therapist", label: "Therapist" },
  { value: "nurse", label: "Nurse" },
  { value: "front_office", label: "Front desk" },
  { value: "manager", label: "Manager" },
  { value: "owner", label: "Owner" },
  { value: "other", label: "Other" },
];

export default function StaffPage() {
  const { user } = useAuth();
  const { section } = useParams();
  const navigate = useNavigate();

  const visibleTabs = TABS.filter((t) => hasPermission(user, t.permission));
  const tab = section || visibleTabs[0]?.key || "directory";

  useEffect(() => {
    if (!section && visibleTabs[0]) {
      navigate(`/staff/${visibleTabs[0].key}`, { replace: true });
    }
  }, [section, visibleTabs, navigate]);

  if (!hasPermission(user, "staff.view") && !hasPermission(user, "roles.view") && !hasPermission(user, "commission.view")) {
    return <Navigate to="/" replace />;
  }

  if (section && !visibleTabs.some((t) => t.key === section)) {
    return <Navigate to={`/staff/${visibleTabs[0]?.key || "directory"}`} replace />;
  }

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl">
      <div className="label-eyebrow">People</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Staff</h1>
      <p className="mt-2 text-[#5C6C62]">Manage staff accounts, schedules, and role permissions.</p>

      <div className="mt-7 border-b border-[#EAE6D7] flex gap-1 overflow-x-auto" data-testid="staff-tabs">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <Link
              key={t.key}
              to={`/staff/${t.key}`}
              className={`px-4 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-2 whitespace-nowrap transition ${active ? "text-[#2D3A33]" : "border-transparent text-[#5C6C62] hover:text-[#2D3A33]"}`}
              style={active ? { borderColor: "var(--bl-primary)" } : { borderColor: "transparent" }}
              data-testid={`staff-tab-${t.key}`}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-7">
        {tab === "directory" && <StaffDirectoryTab />}
        {tab === "schedule" && <StaffScheduleTab />}
        {tab === "roles" && <RolesPermissionsTab />}
      </div>
    </div>
  );
}

function StaffDirectoryTab() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "staff.manage");
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [open, setOpen] = useState(null);
  const emptyForm = {
    email: "", name: "", phone: "", job_title: "", role_id: "", password: "",
    performer_type: "", active: true, notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    const [u, r] = await Promise.all([
      api.get("/staff/users"),
      api.get("/staff/roles").catch(() => ({ data: [] })),
    ]);
    setUsers(u.data);
    setRoles(r.data || []);
  };

  useEffect(() => { load(); }, []);

  const startCreate = () => {
    const defaultRole = roles.find((x) => x.role_key === "doctor") || roles[0];
    setForm({ ...emptyForm, role_id: defaultRole?.id || "" });
    setOpen("create");
  };

  const startEdit = (u) => {
    setForm({
      email: u.email,
      name: u.name,
      phone: u.phone || "",
      job_title: u.job_title || "",
      role_id: u.role_id || roles.find((r) => r.role_key === u.role)?.id || "",
      password: "",
      performer_type: u.performer_type || "",
      active: u.active !== false,
      notes: u.notes || "",
    });
    setOpen(u);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    const body = { ...form, role_id: form.role_id || undefined };
    try {
      if (open === "create") {
        await api.post("/staff/users", body);
        toast.success("Staff member created");
      } else {
        await api.put(`/staff/users/${open.id}`, body);
        toast.success("Staff member updated");
      }
      setOpen(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  const del = async (u) => {
    if (!canManage) return;
    if (!window.confirm(`Remove ${u.email}? This cannot be undone.`)) return;
    try {
      await api.delete(`/staff/users/${u.id}`);
      toast.success("Removed");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const roleLabel = (u) => u.role_name || ROLE_LABEL[u.role] || u.role;
  const canOpenProfile = hasPermission(user, "staff.view") || hasPermission(user, "commission.view");
  const canViewStaffCommission =
    hasPermission(user, "commission.view") || hasPermission(user, "commission.manage");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-[#5C6C62]">{users.length} staff member{users.length !== 1 ? "s" : ""}</div>
        {canManage && (
          <button onClick={startCreate} className="bl-btn-primary inline-flex items-center gap-2" data-testid="staff-create-button">
            <Plus className="w-4 h-4" /> Add staff
          </button>
        )}
      </div>
      <div className="bl-card table-card overflow-hidden" data-testid="staff-directory-table">
        <div className="overflow-x-auto">
          <table className="bl-data-table w-full">
            <thead className="bl-data-table-head">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Staff type</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Actions</th>
                {canManage && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="px-5 py-12 text-center text-sm text-[#5C6C62]">
                    No staff members yet. {canManage ? "Add your first team member to get started." : "Ask your manager to add staff."}
                  </td>
                </tr>
              ) : users.map((u) => (
                <tr key={u.id}>
                  <td className="px-5 py-3 font-medium">
                    {canOpenProfile ? (
                      <Link to={`/staff/members/${u.id}`} className="hover:underline text-[#2D3A33]">{u.name}</Link>
                    ) : u.name}
                  </td>
                  <td className="px-5 py-3 text-[#5C6C62]">{u.email}</td>
                  <td className="px-5 py-3"><span className="bl-chip muted">{roleLabel(u)}</span></td>
                  <td className="px-5 py-3 text-sm text-[#5C6C62] capitalize">{(u.performer_type || "—").replace("_", " ")}</td>
                  <td className="px-5 py-3">
                    <span className={`bl-chip ${u.active === false ? "muted opacity-60" : "success"}`}>{u.active === false ? "Inactive" : "Active"}</span>
                  </td>
                  <td className="px-5 py-3 text-sm space-x-3">
                    {canViewStaffCommission && ["doctor", "therapist", "nurse"].includes(u.role) && (
                      <Link to={`/staff/members/${u.id}`} className="text-[#52796F] hover:underline">Commission</Link>
                    )}
                  </td>
                  {canManage && (
                    <td className="px-5 py-3 text-right space-x-3">
                      <button onClick={() => startEdit(u)} className="text-sm text-[#5C6C62] hover:text-[#2D3A33]" data-testid={`staff-edit-${u.id}`}>Edit</button>
                      <button onClick={() => del(u)} className="text-sm text-[#B14A2C]" data-testid={`staff-delete-${u.id}`}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {open && canManage && (
        <div className="fixed inset-0 bg-[#2D3A33]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setOpen(null)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="bl-card max-w-lg w-full p-6 space-y-4 my-8" data-testid="staff-form">
            <h2 className="font-display text-2xl">{open === "create" ? "Add staff" : "Edit staff"}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="label-eyebrow block mb-1">Full name</label>
                <input required className="bl-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label-eyebrow block mb-1">Email</label>
                <input required type="email" className="bl-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Phone</label>
                <input className="bl-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Job title</label>
                <input className="bl-input" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Role</label>
                <select required className="bl-input" value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
                  <option value="">Select role</option>
                  {roles.filter((r) => r.is_active !== false).map((r) => (
                    <option key={r.id} value={r.id}>{r.role_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Staff type</label>
                <select className="bl-input" value={form.performer_type} onChange={(e) => setForm({ ...form, performer_type: e.target.value })}>
                  {PERFORMER_TYPES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <input type="checkbox" id="active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                <label htmlFor="active" className="text-sm text-[#2D3A33]">Active account</label>
              </div>
              <div className="sm:col-span-2">
                <label className="label-eyebrow block mb-1">Notes</label>
                <textarea className="bl-input min-h-[80px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label-eyebrow block mb-1">Password {open !== "create" && "(leave blank to keep)"}</label>
                <input type="password" className="bl-input" required={open === "create"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" className="bl-btn-primary" data-testid="staff-save">Save</button>
              <button type="button" onClick={() => setOpen(null)} className="bl-btn-ghost">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function RolesPermissionsTab() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "roles.manage");
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ role_name: "", description: "", permissions: [], is_active: true });
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const byModule = {};
    for (const p of catalog) {
      const m = p.module || "Other";
      if (!byModule[m]) byModule[m] = [];
      byModule[m].push(p);
    }
    return byModule;
  }, [catalog]);

  const load = async () => {
    const [r, c] = await Promise.all([
      api.get("/staff/roles", { params: { include_inactive: true } }),
      api.get("/staff/permissions/catalog"),
    ]);
    setRoles(r.data);
    setCatalog(c.data?.flat || []);
  };

  useEffect(() => { load(); }, []);

  const startCreate = () => {
    setForm({ role_name: "", description: "", permissions: [], is_active: true });
    setOpen("create");
  };

  const startEdit = (role) => {
    setForm({
      role_name: role.role_name,
      description: role.description || "",
      permissions: [...(role.permissions || [])],
      is_active: role.is_active !== false,
    });
    setOpen(role);
  };

  const togglePerm = (key) => {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((p) => p !== key)
        : [...f.permissions, key],
    }));
  };

  const toggleModule = (moduleName) => {
    const keys = (groups[moduleName] || []).map((p) => p.key);
    const allOn = keys.every((k) => form.permissions.includes(k));
    setForm((f) => ({
      ...f,
      permissions: allOn
        ? f.permissions.filter((p) => !keys.includes(p))
        : [...new Set([...f.permissions, ...keys])],
    }));
  };

  const save = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    try {
      if (open === "create") {
        await api.post("/staff/roles", form);
        toast.success("Role created");
      } else {
        await api.put(`/staff/roles/${open.id}`, form);
        toast.success("Role updated");
      }
      setOpen(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (role) => {
    if (!canManage || role.is_system_role) return;
    if (!window.confirm(`Deactivate role "${role.role_name}"?`)) return;
    try {
      await api.delete(`/staff/roles/${role.id}`);
      toast.success("Role deactivated");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#5C6C62]">Define what each role can access. Assign roles in Staff Directory.</p>
        {canManage && (
          <button onClick={startCreate} className="bl-btn-primary inline-flex items-center gap-2" data-testid="role-create-button">
            <Plus className="w-4 h-4" /> New role
          </button>
        )}
      </div>

      <div className="bl-card table-card overflow-hidden" data-testid="roles-table">
        <table className="bl-data-table w-full">
          <thead className="bl-data-table-head">
            <tr>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Key</th>
              <th className="px-5 py-3">Staff</th>
              <th className="px-5 py-3">Type</th>
              {canManage && <th className="px-5 py-3" />}
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="px-5 py-12 text-center text-sm text-[#5C6C62]">
                  No roles found. System roles are created automatically when your clinic is set up.
                </td>
              </tr>
            ) : roles.map((r) => (
              <tr key={r.id} className={`border-t border-[#EAE6D7] ${r.is_active === false ? "opacity-50" : ""}`}>
                <td className="px-5 py-3 font-medium">{r.role_name}</td>
                <td className="px-5 py-3 font-mono text-xs text-[#5C6C62]">{r.role_key}</td>
                <td className="px-5 py-3 text-sm">{r.user_count ?? 0}</td>
                <td className="px-5 py-3 text-sm">{r.is_system_role ? "System" : "Custom"}</td>
                {canManage && (
                  <td className="px-5 py-3 text-right space-x-3">
                    <button onClick={() => startEdit(r)} className="text-sm text-[#5C6C62] hover:text-[#2D3A33]">Edit</button>
                    {!r.is_system_role && (
                      <button onClick={() => deactivate(r)} className="text-sm text-[#B14A2C]">Deactivate</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && canManage && (
        <div className="fixed inset-0 bg-[#2D3A33]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setOpen(null)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="bl-card max-w-2xl w-full p-6 space-y-4 my-8 max-h-[90vh] overflow-y-auto" data-testid="role-form">
            <h2 className="font-display text-2xl">{open === "create" ? "Create role" : "Edit role"}</h2>
            {open !== "create" && open.is_system_role && (
              <div className="flex gap-2 p-3 rounded-lg bg-[#FBF0E6] text-sm text-[#8B4513]" data-testid="system-role-warning">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                Changing this role affects all users assigned to it.
              </div>
            )}
            <div>
              <label className="label-eyebrow block mb-1">Role name</label>
              <input
                required
                className="bl-input"
                value={form.role_name}
                onChange={(e) => setForm({ ...form, role_name: e.target.value })}
                disabled={open !== "create" && open.is_system_role}
              />
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Description</label>
              <input className="bl-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <div className="label-eyebrow mb-2">Permissions</div>
              <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
                {Object.entries(groups).map(([moduleName, perms]) => {
                  const keys = perms.map((p) => p.key);
                  const allOn = keys.every((k) => form.permissions.includes(k));
                  return (
                    <div key={moduleName} className="border border-[#EAE6D7] rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-medium text-[#2D3A33]">{moduleName}</span>
                        <button type="button" onClick={() => toggleModule(moduleName)} className="text-xs text-[#5C6C62] hover:underline">
                          {allOn ? "Clear all" : "Select all"}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {perms.map((p) => (
                          <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="checkbox" checked={form.permissions.includes(p.key)} onChange={() => togglePerm(p.key)} />
                            <span>{p.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={busy} className="bl-btn-primary" data-testid="role-save">{busy ? "Saving…" : "Save role"}</button>
              <button type="button" onClick={() => setOpen(null)} className="bl-btn-ghost">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
