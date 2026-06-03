import { ChevronLeft, ChevronRight, Save, Lock } from "lucide-react";

export default function VisitWorkflowActionBar({
  onSaveDraft,
  onPrevious,
  onNext,
  onSubmitLock,
  showPrevious = true,
  showNext = true,
  showSubmit = false,
  busy = false,
  saveDraftLabel = "Save draft",
}) {
  return (
    <div
      className="fixed left-0 right-0 z-50 border-t border-[#EAE6D7] bg-[#FDFBF7]/95 backdrop-blur-md bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-0"
      data-testid="visit-workflow-action-bar"
    >
      <div
        className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 md:px-8"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={busy}
          className="bl-btn-ghost inline-flex items-center gap-2 text-sm"
          data-testid="workflow-save-draft"
        >
          <Save className="w-4 h-4" />
          {saveDraftLabel}
        </button>
        <div className="flex items-center gap-2 ml-auto">
          {showPrevious && (
            <button
              type="button"
              onClick={onPrevious}
              disabled={busy}
              className="bl-btn-ghost inline-flex items-center gap-1 text-sm"
              data-testid="workflow-prev"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
          )}
          {showNext && !showSubmit && (
            <button
              type="button"
              onClick={onNext}
              disabled={busy}
              className="bl-btn-primary inline-flex items-center gap-1 text-sm"
              data-testid="workflow-next"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          {showSubmit && (
            <button
              type="button"
              onClick={onSubmitLock}
              disabled={busy}
              className="bl-btn-primary inline-flex items-center gap-2 text-sm"
              data-testid="workflow-submit-lock"
            >
              <Lock className="w-4 h-4" />
              Submit &amp; lock
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
