import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth, ROLE_LABEL, can } from "@/lib/auth";
import { toast } from "sonner";
import { ArrowLeft, Printer, FileText, Stethoscope, Heart, Pill, Image as ImageIcon, MapPin, CheckCircle2, RotateCcw } from "lucide-react";
import DoctorForm from "@/components/visit/DoctorForm";
import TherapistForm from "@/components/visit/TherapistForm";
import TreatmentItems from "@/components/visit/TreatmentItems";
import Photos from "@/components/visit/Photos";
import MappingCanvas from "@/components/visit/MappingCanvas";

const TAB_DEFS = [
  { key: "overview", label: "Overview", icon: FileText },
  { key: "clinical", label: "Doctor (Clinical)", icon: Stethoscope, restrict: ["super_admin","doctor","fo","manager"] },
  { key: "therapist", label: "Therapist", icon: Heart, restrict: ["super_admin","therapist","fo","manager"] },
  { key: "treatments", label: "Treatments", icon: Pill },
  { key: "photos", label: "Photos", icon: ImageIcon },
  { key: "mapping", label: "Mapping", icon: MapPin },
];

export default function VisitDetailPage() {
  const { vid } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [visit, setVisit] = useState(null);
  const [tab, setTab] = useState("overview");
  const [statusBusy, setStatusBusy] = useState(false);

  const load = () => api.get(`/visits/${vid}`).then(r => setVisit(r.data));
  useEffect(() => { load(); }, [vid]);

  // Default-tab logic (hook always called, even before visit loads)
  useEffect(() => {
    if (!visit) return;
    if (tab !== "overview") return;
    if (user.role === "doctor" && visit.visit_type === "doctor") setTab("clinical");
    else if (user.role === "therapist" && visit.visit_type === "therapist") setTab("therapist");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit?.id]);

  const changeStatus = async (next) => {
    if (next === "completed" && !window.confirm("Close this visit and mark it as completed? Doctor/therapist will no longer be able to edit.")) return;
    setStatusBusy(true);
    try {
      await api.put(`/visits/${vid}/status`, { status: next });
      toast.success(next === "completed" ? "Visit marked as completed" : "Visit reopened");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setStatusBusy(false); }
  };

  if (!visit) return <div className="p-10 text-[#5C6C62]">Loading…</div>;

  const tabs = TAB_DEFS.filter(t => !t.restrict || t.restrict.includes(user.role) || user.role === "super_admin");
  const isCompleted = visit.status === "completed";
  const canClose = can(user, "close_visit");

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto">
      <button onClick={()=>nav(-1)} className="inline-flex items-center gap-2 text-sm text-[#5C6C62] hover:text-[#2D3A33]">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="mt-5 flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">{visit.visit_type} visit</div>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">
            <Link to={`/patients/${visit.patient.id}`} className="hover:opacity-70">{visit.patient.full_name}</Link>
          </h1>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap text-sm text-[#5C6C62]">
            <span>{new Date(visit.visit_date || visit.created_at).toLocaleString()}</span>
            {visit.assigned_user && <span>· {visit.assigned_user.name} ({ROLE_LABEL[visit.assigned_user.role]})</span>}
            <span className={`bl-chip ml-2 ${visit.status === "completed" ? "success" : "info"}`}>{visit.status.replace("_"," ")}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          {canClose && !isCompleted && (
            <button onClick={()=>changeStatus("completed")} disabled={statusBusy} className="bl-btn-primary inline-flex items-center justify-center gap-2 flex-1 sm:flex-none" data-testid="mark-completed-button">
              <CheckCircle2 className="w-4 h-4" /> Mark as completed
            </button>
          )}
          {canClose && isCompleted && (
            <button onClick={()=>changeStatus("in_progress")} disabled={statusBusy} className="bl-btn-ghost inline-flex items-center justify-center gap-2" data-testid="reopen-visit-button">
              <RotateCcw className="w-4 h-4" /> Reopen visit
            </button>
          )}
          <Link to={`/print/visit/${visit.id}`} target="_blank" className="bl-btn-ghost inline-flex items-center justify-center gap-2" data-testid="visit-print-button">
            <Printer className="w-4 h-4" /> Print / PDF
          </Link>
        </div>
      </div>

      {/* Tabs — sticky on mobile, snap scroll */}
      <div className="mt-6 lg:mt-7 sticky top-[56px] lg:top-0 z-20 -mx-4 sm:-mx-6 md:-mx-8 px-4 sm:px-6 md:px-8 bg-[#FDFBF7]">
        <div className="bl-tab-scroller" data-testid="visit-tabs">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={()=>setTab(t.key)}
              className={`px-3 sm:px-4 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-2 whitespace-nowrap transition ${active ? "text-[#2D3A33]" : "border-transparent text-[#5C6C62]"}`}
              style={active ? { borderColor: "var(--bl-primary)" } : { borderColor: "transparent" }}
              data-testid={`tab-${t.key}`}
            >
              <Icon className="w-4 h-4" strokeWidth={1.6} /> {t.label}
            </button>
          );
        })}
        </div>
      </div>

      <div className="mt-7">
        {tab === "overview" && <Overview visit={visit} />}
        {tab === "clinical" && <DoctorForm visit={visit} onSaved={load} />}
        {tab === "therapist" && <TherapistForm visit={visit} onSaved={load} />}
        {tab === "treatments" && <TreatmentItems visit={visit} onSaved={load} />}
        {tab === "photos" && <Photos visit={visit} onSaved={load} />}
        {tab === "mapping" && <MappingCanvas visit={visit} onSaved={load} />}
      </div>
    </div>
  );
}

function Overview({ visit }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bl-card p-5">
        <div className="label-eyebrow mb-3">Patient</div>
        <div className="font-display text-xl text-[#2D3A33]">{visit.patient.full_name}</div>
        <div className="text-sm text-[#5C6C62] mt-1 capitalize">{visit.patient.gender || "—"}{visit.patient.date_of_birth ? ` · DOB ${visit.patient.date_of_birth}` : ""}</div>
        <div className="mt-3 text-sm space-y-1">
          <div><span className="text-[#5C6C62]">Phone:</span> {visit.patient.phone || "—"}</div>
          <div><span className="text-[#5C6C62]">Email:</span> {visit.patient.email || "—"}</div>
          <div><span className="text-[#5C6C62]">Allergies:</span> {visit.patient.allergies || "—"}</div>
        </div>
      </div>

      <div className="bl-card p-5">
        <div className="label-eyebrow mb-3">Visit details</div>
        <div className="text-sm space-y-1.5">
          <div><span className="text-[#5C6C62]">Type:</span> <span className="capitalize">{visit.visit_type}</span></div>
          <div><span className="text-[#5C6C62]">Date:</span> {new Date(visit.visit_date || visit.created_at).toLocaleString()}</div>
          <div><span className="text-[#5C6C62]">Status:</span> <span className="capitalize">{visit.status.replace("_"," ")}</span></div>
          <div><span className="text-[#5C6C62]">Chief complaint:</span> {visit.chief_complaint || "—"}</div>
          <div><span className="text-[#5C6C62]">Treatments:</span> {(visit.treatment_items || []).length} items</div>
          <div><span className="text-[#5C6C62]">Photos:</span> {(visit.photos || []).length}</div>
        </div>
      </div>
    </div>
  );
}
