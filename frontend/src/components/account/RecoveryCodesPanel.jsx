import { toast } from "sonner";

export default function RecoveryCodesPanel({ codes, onDismiss }) {
  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success("Recovery codes copied");
    } catch {
      toast.error("Could not copy codes");
    }
  };

  return (
    <div className="p-4 rounded-xl border border-[#EAE6D7] bg-[#F8F5EC] space-y-3">
      <div className="text-sm font-medium text-[#2D3A33]">Save your recovery codes</div>
      <p className="text-xs text-[#5C6C62]">
        Store these codes in a secure place. Each code works once if you lose access to your authenticator app.
      </p>
      <div className="grid grid-cols-2 gap-2 font-mono text-sm text-[#2D3A33]">
        {codes.map((c) => (
          <div key={c} className="px-2 py-1 rounded bg-white border border-[#EAE6D7]">{c}</div>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={copyAll} className="bl-btn-ghost text-sm">
          Copy all
        </button>
        <button type="button" onClick={onDismiss} className="bl-btn-primary text-sm">
          I saved these codes
        </button>
      </div>
    </div>
  );
}
