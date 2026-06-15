import { useState, useRef } from "react";
import api, { fileUrl } from "@/lib/api";
import { toast } from "sonner";
import { useAuth, can } from "@/lib/auth";
import { Upload, Trash2, ImageIcon, Camera } from "lucide-react";
import {
  compressImageBeforeUpload,
  photoUploadErrorMessage,
  COMPRESSION_FAILED_MESSAGE,
} from "@/utils/imageCompression";

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

function photoPrivacyBadge(photo) {
  const status = photo.privacy_status || photo.usage_approval;
  if (!status) return null;
  const labels = {
    internal: "Internal only",
    internal_only: "Internal only",
    patient_approved: "Patient approved",
    marketing_approved: "Marketing approved",
  };
  const label = labels[status] || status.replace(/_/g, " ");
  return (
    <span className="bl-chip text-[10px] mt-1.5" title={label}>
      {label}
    </span>
  );
}

function PhotoCard({ photo, editable, onDelete }) {
  return (
    <div className="bl-card overflow-hidden group">
      <div className="aspect-[3/4] bg-[#F3F1EB] relative">
        <img src={fileUrl(photo.storage_path)} alt={photo.angle} className="w-full h-full object-cover" />
        {editable && (
          <button
            type="button"
            onClick={() => onDelete(photo.id)}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/90 text-[#B14A2C] opacity-0 group-hover:opacity-100 transition"
            data-testid={`photo-delete-${photo.id}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="p-3">
        <span className={`bl-chip ${photo.photo_type === "before" ? "info" : photo.photo_type === "after" ? "success" : "warning"}`}>
          {photo.photo_type === "follow_up" ? "Follow-up" : photo.photo_type.replace("_", " ")}
        </span>
        {photoPrivacyBadge(photo)}
        <div className="mt-1.5 text-sm text-[#2D3A33] capitalize">{ANGLES.find(a => a.v === photo.angle)?.label || photo.angle}</div>
        {photo.notes && <div className="text-xs text-[#5C6C62] mt-1">{photo.notes}</div>}
        <div className="text-xs text-[#5C6C62] mt-1">{new Date(photo.created_at).toLocaleString()}</div>
      </div>
    </div>
  );
}

export default function Photos({ visit, onSaved, photoStep = null }) {
  const { user } = useAuth();
  const editable = can(user, "upload_photo") && user?.role !== "fo";
  const inputRef = useRef(null);
  const cameraRef = useRef(null);
  const lockType = photoStep === "before" || photoStep === "after" ? photoStep : null;
  const [uploadType, setUploadType] = useState(lockType || "before");
  const [uploadAngle, setUploadAngle] = useState("front");
  const [photoNotes, setPhotoNotes] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [busy, setBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [pendingType, setPendingType] = useState(lockType || "before");

  const photos = visit.photos || [];
  const filtered = filterType === "all" ? photos : photos.filter(p => p.photo_type === filterType);
  const beforeCount = photos.filter(p => p.photo_type === "before").length;
  const afterCount = photos.filter(p => p.photo_type === "after").length;

  const onPick = (type, useCamera = false) => {
    setPendingType(type || uploadType);
    if (useCamera) cameraRef.current?.click();
    else inputRef.current?.click();
  };

  const uploadFile = async (rawFile, type = uploadType) => {
    setBusy(true);
    setUploadStatus("optimizing");
    let file = rawFile;
    try {
      try {
        const result = await compressImageBeforeUpload(rawFile);
        file = result.file;
      } catch (err) {
        const message = err?.message || COMPRESSION_FAILED_MESSAGE;
        toast.error(message);
        return;
      }

      setUploadStatus("uploading");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("photo_type", type);
      fd.append("angle", uploadAngle);
      if (photoNotes.trim()) fd.append("notes", photoNotes.trim());
      await api.post(`/visits/${visit.id}/photos`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Photo uploaded");
      setPhotoNotes("");
      onSaved?.();
    } catch (err) {
      toast.error(photoUploadErrorMessage(err));
    } finally {
      setBusy(false);
      setUploadStatus("");
    }
  };

  const onFile = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    for (const f of files) {
      if (f.type && !f.type.startsWith("image/")) {
        toast.error("Please select an image file.");
        continue;
      }
      await uploadFile(f, pendingType);
    }
    e.target.value = "";
  };

  const busyLabel = uploadStatus === "optimizing"
    ? "Optimizing photo..."
    : uploadStatus === "uploading"
      ? "Uploading..."
      : "…";

  const del = async (id) => {
    try {
      await api.delete(`/visits/${visit.id}/photos/${id}`);
      onSaved?.();
      toast.success("Photo removed");
    } catch {
      toast.error("Could not remove photo");
    }
  };

  const renderGrid = (list) => (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="photo-grid">
      {list.map(p => (
        <PhotoCard key={p.id} photo={p} editable={editable} onDelete={del} />
      ))}
    </div>
  );

  const stepPhotos = lockType ? photos.filter((p) => p.photo_type === lockType) : photos;
  const stepCount = lockType === "before" ? beforeCount : lockType === "after" ? afterCount : photos.length;
  const activeType = lockType || uploadType;

  const uploader = editable && (
    <div className="bl-card p-5" data-testid="photo-uploader">
      <div className="font-display text-base text-[#2D3A33] mb-1">
        {lockType === "before" ? "Before treatment photos" : lockType === "after" ? "After treatment photos" : "Quick upload"}
      </div>
      <p className="text-sm text-[#5C6C62] mb-4">
        {lockType ? `${stepCount} photo(s) on file for this step.` : "Add before, after, or follow-up photos."}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {!lockType && (
          <select className="bl-input" value={uploadType} onChange={(e) => setUploadType(e.target.value)} data-testid="photo-type-select">
            {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
        )}
        <select className="bl-input" value={uploadAngle} onChange={(e) => setUploadAngle(e.target.value)} data-testid="photo-angle-select">
          {ANGLES.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
        </select>
        <input className="bl-input" placeholder="Optional caption / notes" value={photoNotes} onChange={(e) => setPhotoNotes(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onPick(activeType, true)}
            disabled={busy}
            className="bl-btn-primary inline-flex items-center justify-center gap-2 flex-1"
            data-testid="photo-open-camera"
          >
            <Camera className="w-4 h-4" /> {busy ? busyLabel : "Open camera"}
          </button>
          <button
            type="button"
            onClick={() => onPick(activeType, false)}
            disabled={busy}
            className="bl-btn-ghost inline-flex items-center justify-center gap-2 flex-1"
            data-testid="photo-upload-gallery"
          >
            <Upload className="w-4 h-4" /> {busy ? busyLabel : "Upload"}
          </button>
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple onChange={onFile} className="hidden" />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
    </div>
  );

  if (lockType) {
    return (
      <div className="space-y-6" data-testid={`photos-step-${lockType}`}>
        {uploader}
        {stepCount === 0 ? (
          <div className="bl-card p-8 text-center text-sm text-[#5C6C62]">
            <ImageIcon className="w-8 h-8 mx-auto opacity-40 mb-2" />
            No {lockType} photos yet.
          </div>
        ) : renderGrid(stepPhotos)}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bl-card p-4 text-center">
          <div className="text-2xl font-display text-[#2D3A33]">{beforeCount}</div>
          <div className="text-xs text-[#5C6C62] uppercase tracking-widest mt-1">Before</div>
        </div>
        <div className="bl-card p-4 text-center">
          <div className="text-2xl font-display text-[#2D3A33]">{afterCount}</div>
          <div className="text-xs text-[#5C6C62] uppercase tracking-widest mt-1">After</div>
        </div>
        <div className="bl-card p-4 text-center">
          <div className="text-2xl font-display text-[#2D3A33]">{photos.filter((p) => p.photo_type === "follow_up").length}</div>
          <div className="text-xs text-[#5C6C62] uppercase tracking-widest mt-1">Follow-up</div>
        </div>
      </div>

      {uploader}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="space-y-4">
          <h3 className="font-display text-lg text-[#2D3A33]">Before treatment</h3>
          {beforeCount === 0 ? (
            <div className="bl-card p-8 text-center text-sm text-[#5C6C62]"><ImageIcon className="w-8 h-8 mx-auto opacity-40 mb-2" />No before photos yet.</div>
          ) : renderGrid(photos.filter((p) => p.photo_type === "before"))}
        </div>
        <div className="space-y-4">
          <h3 className="font-display text-lg text-[#2D3A33]">After treatment</h3>
          {afterCount === 0 ? (
            <div className="bl-card p-8 text-center text-sm text-[#5C6C62]"><ImageIcon className="w-8 h-8 mx-auto opacity-40 mb-2" />No after photos yet.</div>
          ) : renderGrid(photos.filter((p) => p.photo_type === "after"))}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-4">
          <span className="label-eyebrow mr-2">All photos</span>
          {[{ v: "all", label: "All" }, ...TYPES].map((t) => (
            <button key={t.v} type="button" onClick={() => setFilterType(t.v)} className={`bl-chip ${filterType === t.v ? "info" : ""}`}>{t.label}</button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="bl-card p-12 text-center text-[#5C6C62]">
            <ImageIcon className="w-10 h-10 mx-auto opacity-50 mb-3" />
            No photos yet for this visit.
          </div>
        ) : renderGrid(filtered)}
      </div>
    </div>
  );
}
