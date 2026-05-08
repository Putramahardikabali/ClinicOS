import { useState, useRef } from "react";
import api, { fileUrl } from "@/lib/api";
import { toast } from "sonner";
import { useAuth, can } from "@/lib/auth";
import { Upload, Trash2, ImageIcon } from "lucide-react";
import { CameraButton } from "@/components/CameraCapture";

const ANGLES = [
  { v: "front", label: "Front" },
  { v: "left_45", label: "Left 45°" },
  { v: "right_45", label: "Right 45°" },
  { v: "left_side", label: "Left side" },
  { v: "right_side", label: "Right side" },
  { v: "back", label: "Back" },
  { v: "body_front", label: "Body front" },
  { v: "body_back", label: "Body back" },
  { v: "body_left", label: "Body left" },
  { v: "body_right", label: "Body right" },
  { v: "other", label: "Other" },
];

const TYPES = [
  { v: "before", label: "Before" },
  { v: "after", label: "After" },
  { v: "follow_up", label: "Follow-up" },
];

export default function Photos({ visit, onSaved }) {
  const { user } = useAuth();
  const editable = can(user, "upload_photo");
  const inputRef = useRef(null);
  const [uploadType, setUploadType] = useState("before");
  const [uploadAngle, setUploadAngle] = useState("front");
  const [filterType, setFilterType] = useState("all");
  const [busy, setBusy] = useState(false);

  const photos = visit.photos || [];
  const filtered = filterType === "all" ? photos : photos.filter(p => p.photo_type === filterType);

  const onPick = () => inputRef.current?.click();

  const uploadFile = async (file) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("photo_type", uploadType);
      fd.append("angle", uploadAngle);
      await api.post(`/visits/${visit.id}/photos`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Photo uploaded");
      onSaved?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    for (const f of files) await uploadFile(f);
    e.target.value = "";
  };

  const del = async (id) => {
    try { await api.delete(`/visits/${visit.id}/photos/${id}`); onSaved?.(); toast.success("Photo removed"); } catch {}
  };

  return (
    <div className="space-y-6">
      {editable && (
        <div className="bl-card p-5" data-testid="photo-uploader">
          <div className="font-display text-base text-[#2D3A33] mb-3">Upload photo</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <select className="bl-input" value={uploadType} onChange={(e)=>setUploadType(e.target.value)} data-testid="photo-type-select">
              {TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
            <select className="bl-input" value={uploadAngle} onChange={(e)=>setUploadAngle(e.target.value)} data-testid="photo-angle-select">
              {ANGLES.map(a => <option key={a.v} value={a.v}>{a.label}</option>)}
            </select>
            <button type="button" onClick={onPick} disabled={busy} className="bl-btn-primary inline-flex items-center justify-center gap-2" data-testid="photo-upload-button">
              <Upload className="w-4 h-4" /> {busy ? "Uploading…" : "Choose file"}
            </button>
            <CameraButton onCapture={uploadFile} />
          </div>
          <input ref={inputRef} type="file" accept="image/*" multiple onChange={onFile} className="hidden" />
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="label-eyebrow mr-2">Filter</span>
        {[{v:"all", label:"All"}, ...TYPES].map(t => (
          <button key={t.v} onClick={()=>setFilterType(t.v)} className={`bl-chip ${filterType === t.v ? "info" : ""}`}>{t.label}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bl-card p-12 text-center text-[#5C6C62]">
          <ImageIcon className="w-10 h-10 mx-auto opacity-50 mb-3" />
          No photos yet for this visit.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="photo-grid">
          {filtered.map(p => (
            <div key={p.id} className="bl-card overflow-hidden group">
              <div className="aspect-[3/4] bg-[#F3F1EB] relative">
                <img src={fileUrl(p.storage_path)} alt={p.angle} className="w-full h-full object-cover" />
                {editable && (
                  <button onClick={()=>del(p.id)} className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/90 text-[#B14A2C] opacity-0 group-hover:opacity-100 transition" data-testid={`photo-delete-${p.id}`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center gap-2">
                  <span className={`bl-chip ${p.photo_type === "before" ? "info" : p.photo_type === "after" ? "success" : "warning"}`}>{p.photo_type.replace("_"," ")}</span>
                </div>
                <div className="mt-1.5 text-sm text-[#2D3A33] capitalize">{ANGLES.find(a=>a.v===p.angle)?.label || p.angle}</div>
                <div className="text-xs text-[#5C6C62]">{new Date(p.created_at).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
