import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, can } from "@/lib/auth";
import { toast } from "sonner";
import { Plus, X, Download, Upload, FileSpreadsheet, ChevronLeft, ChevronRight, HelpCircle, MoreHorizontal } from "lucide-react";
import { SearchFieldBar } from "@/components/ui/SearchInput";
import LoyaltyBadge from "@/components/patient/LoyaltyBadge";
import { API_BASE } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_SIZE = 20;

async function downloadFile(path, filename) {
  const token = localStorage.getItem("bl_token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function patientDisplayName(p) {
  return (p?.full_name || `${p?.first_name || ""} ${p?.last_name || ""}`.trim()) || "Unknown";
}

const EXCEL_IMPORT_HELP =
  "Import and export use the Excel layout (FirstName, LastName, Phone, UserCode, etc.). Download the template first. Clinical fields (medical history, allergies, consent) are managed in the app after import.";

function ExcelImportExportHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="p-2 rounded-lg text-[#5C6C62] hover:bg-[#F3F1EB] hover:text-[#2D3A33]"
        aria-label="Excel import and export help"
        aria-expanded={open}
        data-testid="patients-excel-help"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            aria-label="Close help"
            onClick={() => setOpen(false)}
          />
          <div
            role="tooltip"
            className="absolute right-0 top-full mt-2 z-20 w-72 bl-card p-3 text-xs text-[#5C6C62] shadow-lg leading-relaxed"
            data-testid="patients-excel-help-tooltip"
          >
            {EXCEL_IMPORT_HELP}
          </div>
        </>
      )}
    </div>
  );
}

function PatientRowActions({ patient, canEdit, canDelete, onDelete }) {
  return (
    <div className="inline-flex items-center justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="p-1.5 rounded-lg border border-[#EAE6D7] hover:bg-[#F3F1EB] text-[#5C6C62]"
            aria-label="More patient actions"
            data-testid={`patient-row-menu-${patient.id}`}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[11rem] bg-white border-[#EAE6D7] shadow-lg">
          {canEdit && (
            <DropdownMenuItem asChild className="cursor-pointer focus:bg-[#F8F5EC]">
              <Link
                to={`/patients/${patient.id}`}
                onClick={(e) => e.stopPropagation()}
                data-testid={`patient-edit-${patient.id}`}
              >
                Edit patient
              </Link>
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onDelete(patient);
              }}
              className="cursor-pointer text-[#B14A2C] focus:bg-[#FAE5DC] focus:text-[#B14A2C]"
              data-testid={`patient-delete-${patient.id}`}
            >
              Delete patient…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function PaginationBar({ page, pages, total, pageSize, onPage, loading }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3" data-testid="patients-pagination">
      <div className="text-sm text-[#5C6C62]">
        Showing {from}–{to} of {total.toLocaleString()} patient{total === 1 ? "" : "s"}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={loading || page <= 1}
          className="bl-btn-ghost inline-flex items-center gap-1 text-sm disabled:opacity-40"
          data-testid="patients-prev-page"
        >
          <ChevronLeft className="w-4 h-4" /> Previous
        </button>
        <span className="text-sm text-[#2D3A33] px-2 tabular-nums" data-testid="patients-page-indicator">
          Page {page} of {pages}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={loading || page >= pages}
          className="bl-btn-ghost inline-flex items-center gap-1 text-sm disabled:opacity-40"
          data-testid="patients-next-page"
        >
          Next <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function PatientsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [form, setForm] = useState({ full_name:"", gender:"female", date_of_birth:"", phone:"", email:"", address:"", medical_history:"", allergies:"", notes:"" });
  const [busy, setBusy] = useState(false);
  const canExport = can(user, "export_patients");
  const canImport = can(user, "create_patient");
  const canCreate = can(user, "create_patient");
  const canDelete = can(user, "delete_patient");
  const canEditPatient = can(user, "edit_patient");

  const openPatient = (patientId) => navigate(`/patients/${patientId}`);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback((qq, pg) => {
    setLoading(true);
    const params = { page: pg, page_size: PAGE_SIZE };
    if (qq) params.q = qq;
    return api.get("/patients", { params })
      .then(r => {
        const data = r.data || {};
        setItems(data.items || []);
        setTotal(data.total ?? 0);
        setPages(data.pages ?? 1);
        setPage(data.page ?? pg);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
        setPages(1);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(q, page);
  }, [q, page, load]);

  const handleExport = async () => {
    try {
      await downloadFile("/patients/export?format=xlsx", "patients.xlsx");
      toast.success("Patients exported");
    } catch (e) {
      toast.error(e.message || "Export failed");
    }
  };

  const handleTemplate = async () => {
    try {
      await downloadFile("/patients/import-template?format=xlsx", "patients-import-template.xlsx");
      toast.success("Template downloaded");
    } catch (e) {
      toast.error(e.message || "Download failed");
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/patients/import", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const { created, updated, errors, total: imported } = r.data || {};
      const errCount = (errors || []).length;
      if (errCount) {
        toast.warning(`Imported ${imported} rows: ${created} new, ${updated} updated, ${errCount} issue(s)`);
      } else {
        toast.success(`Imported ${imported} rows: ${created} new, ${updated} updated`);
      }
      setPage(1);
      load(q, 1);
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Import failed");
    } finally {
      setImportBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/patients", form);
      toast.success("Patient created");
      setOpen(false);
      setForm({ full_name:"", gender:"female", date_of_birth:"", phone:"", email:"", address:"", medical_history:"", allergies:"", notes:"" });
      setPage(1);
      load(q, 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to create");
    } finally { setBusy(false); }
  };

  const removePatient = async (p) => {
    const name = patientDisplayName(p);
    const warn =
      `Permanently delete "${name}"?\n\n` +
      "This removes the patient record and cannot be undone. " +
      "Patients with visits or bookings cannot be deleted — remove those first.\n\n" +
      "Archive is not available yet; deletion is permanent.";
    if (!window.confirm(warn)) return;
    if (!window.confirm(`Final confirmation: delete "${name}" permanently?`)) return;
    try {
      await api.delete(`/patients/${p.id}`);
      toast.success("Patient deleted");
      const nextPage = items.length === 1 && page > 1 ? page - 1 : page;
      if (nextPage !== page) setPage(nextPage);
      else load(q, page);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to delete patient");
    }
  };

  const emptyMessage = q
    ? "No patients match your search."
    : "No patients yet";

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="patients-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">Patient registry</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Patients</h1>
          <p className="mt-2 text-[#5C6C62] max-w-xl">
            Manage patient profiles, contact details, visit history, and clinical information.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(canExport || canImport) && <ExcelImportExportHelp />}
          {canExport && (
            <button type="button" onClick={handleExport} className="bl-btn-ghost inline-flex items-center gap-2 text-sm" data-testid="export-patients-button">
              <Download className="w-4 h-4" /> Export Excel
            </button>
          )}
          {canImport && (
            <>
              <button type="button" onClick={handleTemplate} className="bl-btn-ghost inline-flex items-center gap-2 text-sm" data-testid="patients-template-button">
                <FileSpreadsheet className="w-4 h-4" /> Template
              </button>
              <label className={`bl-btn-ghost inline-flex items-center gap-2 text-sm cursor-pointer ${importBusy ? "opacity-50 pointer-events-none" : ""}`} data-testid="import-patients-button">
                <Upload className="w-4 h-4" /> {importBusy ? "Importing…" : "Import Excel"}
                <input type="file" accept=".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden" onChange={handleImport} disabled={importBusy} />
              </label>
            </>
          )}
          {canCreate && (
            <button onClick={() => setOpen(true)} className="bl-btn-primary inline-flex items-center gap-2" data-testid="new-patient-button">
              <Plus className="w-4 h-4" /> New patient
            </button>
          )}
        </div>
      </div>

      <SearchFieldBar
        className="mt-6 bl-card p-4"
        placeholder="Search all patients by name, phone, email, user code…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        data-testid="patients-search-input"
        trailing={loading ? <span className="text-xs text-[#5C6C62] shrink-0">Searching…</span> : null}
      />

      {/* Mobile: card list */}
      <div className="mt-6 space-y-3 lg:hidden" data-testid="patients-cards">
        {!loading && items.length === 0 && <div className="bl-card p-8 text-center text-[#5C6C62]">{emptyMessage}</div>}
        {items.map((p) => (
          <div key={p.id} className="bl-card p-4 flex items-center gap-3" data-testid={`patient-card-${p.id}`}>
            <Link to={`/patients/${p.id}`} className="flex items-center gap-3 flex-1 min-w-0 active:bg-[#FBF8EF] -m-2 p-2 rounded-xl" data-testid={`patient-open-${p.id}`}>
              <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0" style={{ background: "var(--bl-primary)" }}>
                {patientDisplayName(p).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[#2D3A33] truncate">{patientDisplayName(p)}</div>
                <div className="mt-1">
                  <LoyaltyBadge tier={p.loyalty_tier} emptyLabel="No tier" />
                </div>
                <div className="text-xs text-[#5C6C62] truncate mt-1">
                  {p.user_code && <span className="font-mono mr-1">{p.user_code}</span>}
                  <span className="capitalize">{p.gender || "—"}</span> · {p.phone || "no phone"}
                </div>
              </div>
              <div className="text-[#5C6C62]">›</div>
            </Link>
            <PatientRowActions
              patient={p}
              canEdit={canEditPatient}
              canDelete={canDelete}
              onDelete={removePatient}
            />
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="mt-6 bl-card overflow-hidden hidden lg:block" data-testid="patients-table">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[920px]">
          <thead className="bg-[#F8F5EC]">
            <tr className="text-left text-xs uppercase tracking-widest text-[#5C6C62]">
              <th className="px-5 py-3">Code</th>
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3 w-[8.5rem]">Loyalty</th>
              <th className="px-5 py-3">Gender</th>
              <th className="px-5 py-3">Phone</th>
              <th className="px-5 py-3">Last Visit</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="text-center py-12 text-[#5C6C62]">Loading patients…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={8} className="text-center py-12 text-[#5C6C62]">{emptyMessage}</td></tr>
            )}
            {!loading && items.map((p) => (
              <tr
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => openPatient(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openPatient(p.id);
                  }
                }}
                className="border-t border-[#EAE6D7] hover:bg-[#FBF8EF] cursor-pointer transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--bl-primary)]"
                data-testid={`patient-row-${p.id}`}
                aria-label={`View profile for ${patientDisplayName(p)}`}
              >
                <td className="px-5 py-4 align-middle text-xs font-mono text-[#5C6C62]">{p.user_code || "—"}</td>
                <td className="px-5 py-4 align-middle font-medium text-[#2D3A33]">{patientDisplayName(p)}</td>
                <td className="px-5 py-4 align-middle">
                  <LoyaltyBadge tier={p.loyalty_tier} emptyLabel="No tier" />
                </td>
                <td className="px-5 py-4 align-middle text-[#5C6C62] capitalize">{p.gender || "—"}</td>
                <td className="px-5 py-4 align-middle text-[#5C6C62]">{p.phone || "—"}</td>
                <td className="px-5 py-4 align-middle text-sm text-[#5C6C62]">{p.last_visit ? new Date(p.last_visit).toLocaleDateString() : "—"}</td>
                <td className="px-5 py-4 align-middle text-[#5C6C62]">{p.email || "—"}</td>
                <td
                  className="px-5 py-4 align-middle text-right whitespace-nowrap"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <PatientRowActions
                    patient={p}
                    canEdit={canEditPatient}
                    canDelete={canDelete}
                    onDelete={removePatient}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <PaginationBar
        page={page}
        pages={pages}
        total={total}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        loading={loading}
      />

      {open && (
        <div className="fixed inset-0 bg-[#2D3A33]/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setOpen(false)}>
          <div className="bl-card max-w-2xl w-full p-7 max-h-[90vh] overflow-y-auto" onClick={(e)=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl text-[#2D3A33]">New patient</h2>
              <button onClick={()=>setOpen(false)} className="p-2 rounded-lg hover:bg-[#F3F1EB]"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={submit} className="mt-6 space-y-4" data-testid="new-patient-form">
              <div>
                <label className="label-eyebrow block mb-1">Full name</label>
                <input className="bl-input" required value={form.full_name} onChange={e=>setForm({...form, full_name:e.target.value})} data-testid="patient-name-input" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-eyebrow block mb-1">Gender</label>
                  <select className="bl-input" value={form.gender} onChange={e=>setForm({...form,gender:e.target.value})}>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1">Date of birth</label>
                  <input type="date" className="bl-input" value={form.date_of_birth} onChange={e=>setForm({...form,date_of_birth:e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-eyebrow block mb-1">Phone</label>
                  <input className="bl-input" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1">Email</label>
                  <input className="bl-input" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} />
                </div>
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Address</label>
                <input className="bl-input" value={form.address} onChange={e=>setForm({...form,address:e.target.value})} />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Medical history</label>
                <textarea className="bl-input min-h-[80px]" value={form.medical_history} onChange={e=>setForm({...form,medical_history:e.target.value})} />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Allergies</label>
                <input className="bl-input" value={form.allergies} onChange={e=>setForm({...form,allergies:e.target.value})} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="bl-btn-primary" disabled={busy} data-testid="patient-create-submit">{busy ? "Saving…" : "Create patient"}</button>
                <button type="button" onClick={()=>setOpen(false)} className="bl-btn-ghost">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
