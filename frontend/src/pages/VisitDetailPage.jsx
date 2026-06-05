import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import { useAuth, ROLE_LABEL, hasPermission } from "@/lib/auth";
import { formatBillingLabel, primaryAndAdditionalPerformers, visitNoteTabRoles } from "@/lib/visitUi";
import {
  getVisibleWorkflowSteps,
  buildWorkflowStepStatuses,
  clinicalNotesStepLabel,
  primaryVisitNoteRole,
} from "@/lib/visitWorkflow";
import VisitWorkflowStepper from "@/components/visit/VisitWorkflowStepper";
import VisitWorkflowActionBar from "@/components/visit/VisitWorkflowActionBar";
import VisitStepOverview from "@/components/visit/steps/VisitStepOverview";
import VisitStepFinalReview from "@/components/visit/steps/VisitStepFinalReview";
import { ArrowLeft, Printer } from "lucide-react";
import DoctorForm from "@/components/visit/DoctorForm";
import TherapistForm from "@/components/visit/TherapistForm";
import TreatmentItems from "@/components/visit/TreatmentItems";
import Photos from "@/components/visit/Photos";
import MappingCanvas from "@/components/visit/MappingCanvas";
import VisitConsentPanel from "@/components/consent/VisitConsentPanel";
import ConsentStatusBadge, { consentSummary } from "@/components/consent/ConsentStatusBadge";
import FeatureGate from "@/components/FeatureGate";
import { useClinic } from "@/lib/clinic";

function initialStepForUser(user, visit, steps) {
  if (!user || !visit || !steps.length) return steps[0]?.id || "overview";
  const visitRoles = visitNoteTabRoles(visit);
  if (user.role === "doctor" && visitRoles.has("doctor") && steps.some((s) => s.id === "clinical_notes")) {
    return "clinical_notes";
  }
  if (user.role === "therapist" && visitRoles.has("therapist") && steps.some((s) => s.id === "clinical_notes")) {
    return "clinical_notes";
  }
  if (user.role === "nurse" && visitRoles.has("nurse") && steps.some((s) => s.id === "clinical_notes")) {
    return "clinical_notes";
  }
  return steps[0]?.id || "overview";
}

export default function VisitDetailPage() {
  const { vid } = useParams();
  const [searchParams] = useSearchParams();
  const stepFromUrl = searchParams.get("step") || searchParams.get("tab");
  const { user } = useAuth();
  const { clinic } = useClinic();
  const nav = useNavigate();
  const [visit, setVisit] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [workflowStep, setWorkflowStep] = useState("overview");
  const [barBusy, setBarBusy] = useState(false);

  const doctorRef = useRef(null);
  const therapistRef = useRef(null);
  const finalReviewRef = useRef(null);

  const canCollect = ["super_admin", "fo", "manager"].includes(user?.role);
  const isClinicalStaff = ["doctor", "therapist", "nurse"].includes(user?.role);
  const canViewBilling = Boolean(
    user && (
      !isClinicalStaff
      || hasPermission(user, "billing.view")
      || ["super_admin", "fo", "manager"].includes(user?.role)
    ),
  );
  const [invoiceSummary, setInvoiceSummary] = useState(null);

  const load = useCallback(() => {
    setLoadError(null);
    return api.get(`/visits/${vid}`)
      .then((r) => setVisit(r.data))
      .catch((e) => {
        setVisit(null);
        setLoadError(e?.response?.data?.detail || "Could not load this treatment session");
      });
  }, [vid]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!visit?.id || !canViewBilling) {
      setInvoiceSummary(null);
      return;
    }
    api.get(`/invoices/visit/${visit.id}`)
      .then((r) => setInvoiceSummary(r.data))
      .catch(() => setInvoiceSummary(null));
  }, [visit?.id, canViewBilling]);

  const workflowSteps = useMemo(
    () => (visit && user && clinic ? getVisibleWorkflowSteps(user, visit, clinic) : []),
    [visit, user, clinic],
  );

  const stepStatuses = useMemo(
    () => buildWorkflowStepStatuses(workflowSteps, visit, clinic, invoiceSummary),
    [workflowSteps, visit, clinic, invoiceSummary],
  );

  const primaryNoteRole = useMemo(
    () => (visit ? primaryVisitNoteRole(visit) : null),
    [visit],
  );

  const canViewPrimaryNotes = useMemo(() => {
    if (!primaryNoteRole || !user) return false;
    if (user.role === "super_admin" || user.role === "fo" || user.role === "manager") return true;
    return user.role === primaryNoteRole;
  }, [primaryNoteRole, user]);

  const showDoctorNotes = primaryNoteRole === "doctor" && canViewPrimaryNotes;
  const showTherapistNotes = primaryNoteRole === "therapist" && canViewPrimaryNotes;
  const showNurseNotes = primaryNoteRole === "nurse" && canViewPrimaryNotes;
  const therapistNoteRole = primaryNoteRole === "nurse" ? "nurse" : "therapist";

  useEffect(() => {
    if (stepFromUrl === "payment") {
      nav(`/invoices/visit/${vid}`, { replace: true });
      return;
    }
    if (!workflowSteps.length) return;
    const legacyMap = {
      overview: "overview",
      clinical: "clinical_notes",
      therapist: "clinical_notes",
      nurse: "clinical_notes",
      treatments: "treatments",
      consent: "consent",
      photos: "photos_before",
      mapping: "mapping",
    };
    if (stepFromUrl) {
      const mapped = legacyMap[stepFromUrl] || stepFromUrl;
      if (workflowSteps.some((s) => s.id === mapped)) {
        setWorkflowStep(mapped);
        return;
      }
    }
  }, [stepFromUrl, workflowSteps, vid, nav]);

  useEffect(() => {
    if (!visit || !user || workflowSteps.length === 0) return;
    if (stepFromUrl) return;
    if (workflowStep !== "overview") return;
    setWorkflowStep(initialStepForUser(user, visit, workflowSteps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit?.id, user?.role]);

  useEffect(() => {
    if (!workflowSteps.length) return;
    if (!workflowSteps.some((s) => s.id === workflowStep)) {
      setWorkflowStep(workflowSteps[0].id);
    }
  }, [workflowSteps, workflowStep]);

  const stepIndex = workflowSteps.findIndex((s) => s.id === workflowStep);
  const isFirst = stepIndex <= 0;
  const isLast = stepIndex >= workflowSteps.length - 1;
  const isFinalStep = workflowStep === "final_review";

  const handleSaveDraft = async () => {
    setBarBusy(true);
    try {
      if (workflowStep === "final_review") {
        await finalReviewRef.current?.saveDraft?.();
        await load();
        return;
      }
      if (workflowStep === "clinical_notes") {
        if (showDoctorNotes) await doctorRef.current?.saveDraft?.();
        else if (showTherapistNotes || showNurseNotes) await therapistRef.current?.saveDraft?.();
        await load();
      }
    } finally {
      setBarBusy(false);
    }
  };

  const handleSubmitLock = async () => {
    setBarBusy(true);
    try {
      await finalReviewRef.current?.submitLock?.();
      await load();
    } finally {
      setBarBusy(false);
    }
  };

  const goPrev = () => {
    if (!isFirst) setWorkflowStep(workflowSteps[stepIndex - 1].id);
  };

  const goNext = () => {
    if (!isLast) setWorkflowStep(workflowSteps[stepIndex + 1].id);
  };

  if (loadError) {
    return (
      <div className="p-10 max-w-lg mx-auto text-center">
        <p className="text-[#5C6C62]">{loadError}</p>
        <button type="button" onClick={() => nav(-1)} className="mt-4 bl-btn-ghost text-sm">Go back</button>
      </div>
    );
  }

  if (!visit) return <div className="p-10 text-[#5C6C62]">Loading…</div>;

  const showCollectPayment = canCollect && visit.status === "submitted" && visit.payment_status !== "paid";
  const consentInfo = consentSummary(visit.consent_forms || []);
  const billing = formatBillingLabel(visit, invoiceSummary);
  const { primary, additional } = primaryAndAdditionalPerformers(visit);

  const notesStepTitle = clinicalNotesStepLabel(visit);
  const displaySteps = workflowSteps.map((s) => (
    s.id === "clinical_notes" ? { ...s, label: notesStepTitle, shortLabel: "Notes" } : s
  ));

  return (
    <div
      className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto pb-44 lg:pb-32"
      data-testid="visit-workflow-page"
    >
      <button onClick={() => nav(-1)} className="inline-flex items-center gap-2 text-sm text-[#5C6C62] hover:text-[#2D3A33]">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="mt-5 flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">{visit.visit_type} treatment session</div>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">
            <Link to={`/patients/${visit.patient.id}`} className="hover:opacity-70">{visit.patient.full_name}</Link>
          </h1>
          <div className="mt-1.5 space-y-1.5 text-sm text-[#5C6C62]">
            <div className="flex flex-wrap items-center gap-2">
              <span>{new Date(visit.visit_date || visit.created_at).toLocaleString()}</span>
              <span className={`bl-chip ${visit.status === "completed" ? "success" : visit.status === "submitted" ? "warning" : "info"}`}>
                {visit.status.replace("_", " ")}
              </span>
              {(visit.consent_forms || []).length > 0 && (
                <ConsentStatusBadge status={consentInfo.status} compact />
              )}
              {canViewBilling && <span className={`bl-chip ${billing.chip}`}>{billing.label}</span>}
            </div>
            {primary && (
              <div>
                <span className="text-[#5C6C62]">Assigned staff:</span>{" "}
                <span className="text-[#2D3A33] font-medium">
                  {primary.staff_name_snapshot || visit.assigned_user?.name}
                  {(primary.staff_role_snapshot || visit.assigned_user?.role) && (
                    <> ({ROLE_LABEL[primary.staff_role_snapshot || visit.assigned_user?.role] || primary.staff_role_snapshot})</>
                  )}
                </span>
              </div>
            )}
            {additional.length > 0 && (
              <div>
                <span className="text-[#5C6C62]">Additional:</span>{" "}
                {additional.map((p, i) => (
                  <span key={p.staff_id || i}>
                    {i > 0 ? ", " : ""}
                    {p.staff_name_snapshot || p.staff_id}
                    {p.staff_role_snapshot ? ` (${ROLE_LABEL[p.staff_role_snapshot] || p.staff_role_snapshot})` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          {showCollectPayment && (
            <Link to={`/invoices/visit/${visit.id}`} className="bl-btn-primary inline-flex items-center justify-center gap-2" data-testid="visit-collect-payment">
              Collect payment
            </Link>
          )}
          <Link to={`/print/visit/${visit.id}`} target="_blank" className="bl-btn-ghost inline-flex items-center justify-center gap-2" data-testid="visit-print-button">
            <Printer className="w-4 h-4" /> Print / PDF
          </Link>
        </div>
      </div>

      <div className="mt-6 lg:mt-7 sticky top-0 z-20 -mx-4 sm:-mx-6 md:-mx-8 px-4 sm:px-6 md:px-8 bg-[#FDFBF7] py-3 border-b border-[#EAE6D7]">
        <VisitWorkflowStepper
          steps={displaySteps}
          currentId={workflowStep}
          statuses={stepStatuses}
          onSelect={setWorkflowStep}
        />
      </div>

      <div className="mt-7">
        <div hidden={workflowStep !== "overview"}>
          <VisitStepOverview
            visit={visit}
            invoice={invoiceSummary}
            showBilling={canViewBilling}
            canCollect={showCollectPayment}
          />
        </div>

        <div hidden={workflowStep !== "consent"}>
          <FeatureGate feature="emr">
            <VisitConsentPanel visit={visit} onUpdated={load} />
          </FeatureGate>
        </div>

        <div hidden={workflowStep !== "photos_before"}>
          <FeatureGate feature="photos">
            <Photos visit={visit} onSaved={load} photoStep="before" />
          </FeatureGate>
        </div>

        <div hidden={workflowStep !== "clinical_notes"}>
          <FeatureGate feature="emr">
            {showDoctorNotes && (
              <DoctorForm ref={doctorRef} visit={visit} onSaved={load} workflowMode />
            )}
            {(showTherapistNotes || showNurseNotes) && (
              <TherapistForm
                ref={therapistRef}
                visit={visit}
                onSaved={load}
                noteRole={therapistNoteRole}
                workflowMode
              />
            )}
            {!showDoctorNotes && !showTherapistNotes && !showNurseNotes && (
              <p className="text-sm text-[#5C6C62] bl-card p-4">No clinical note sections apply to your role on this treatment session.</p>
            )}
          </FeatureGate>
        </div>

        <div hidden={workflowStep !== "mapping"}>
          <FeatureGate feature="mapping">
            <MappingCanvas visit={visit} onSaved={load} />
          </FeatureGate>
        </div>

        <div hidden={workflowStep !== "treatments"}>
          <FeatureGate feature="emr">
            <TreatmentItems visit={visit} onSaved={load} workflowMode />
          </FeatureGate>
        </div>

        <div hidden={workflowStep !== "photos_after"}>
          <FeatureGate feature="photos">
            <Photos visit={visit} onSaved={load} photoStep="after" />
          </FeatureGate>
        </div>

        <div hidden={workflowStep !== "final_review"}>
          <FeatureGate feature="emr">
            <VisitStepFinalReview
              ref={finalReviewRef}
              visit={visit}
              invoice={invoiceSummary}
              showBilling={canViewBilling}
              clinicalRef={doctorRef}
              therapistRef={therapistRef}
              onSaved={load}
            />
          </FeatureGate>
        </div>
      </div>

      <VisitWorkflowActionBar
        busy={barBusy}
        showPrevious={!isFirst}
        showNext={!isLast && !isFinalStep}
        showSubmit={isFinalStep}
        onSaveDraft={handleSaveDraft}
        onPrevious={goPrev}
        onNext={goNext}
        onSubmitLock={handleSubmitLock}
      />
    </div>
  );
}
