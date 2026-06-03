import { MapPin } from "lucide-react";
import { fileUrl } from "@/lib/api";

function PhotoThumb({ photo }) {
  return (
    <div className="bl-card overflow-hidden">
      <div className="aspect-[3/4] bg-[#F3F1EB]">
        <img
          src={fileUrl(photo.storage_path)}
          alt={photo.angle || photo.photo_type}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="p-2 text-xs text-[#5C6C62] capitalize">{photo.angle?.replace(/_/g, " ") || photo.photo_type}</div>
    </div>
  );
}

export default function VisitReviewMedia({ visit }) {
  const before = (visit.photos || []).filter((p) => p.photo_type === "before");
  const after = (visit.photos || []).filter((p) => p.photo_type === "after");
  const mappings = visit.mappings || [];

  return (
    <div className="space-y-4" data-testid="visit-review-media">
      {before.length > 0 && (
        <div className="bl-card p-5" data-testid="review-before-photos">
          <div className="label-eyebrow mb-3">Before photos</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {before.map((p) => <PhotoThumb key={p.id} photo={p} />)}
          </div>
        </div>
      )}

      {after.length > 0 && (
        <div className="bl-card p-5" data-testid="review-after-photos">
          <div className="label-eyebrow mb-3">After photos</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {after.map((p) => <PhotoThumb key={p.id} photo={p} />)}
          </div>
        </div>
      )}

      {mappings.length > 0 ? (
        <div className="bl-card p-5" data-testid="review-mapping">
          <div className="label-eyebrow mb-3">Mapping</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {mappings.map((m) => (
              <div key={m.id} className="bl-card overflow-hidden">
                <div className="bg-[#F3F1EB] aspect-[3/4] relative">
                  <img src={m.image_data} alt={m.map_type} className="w-full h-full object-contain" />
                </div>
                <div className="p-3 text-sm capitalize">{m.map_type?.replace(/_/g, " ")}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bl-card p-5 text-center text-sm text-[#5C6C62]" data-testid="review-mapping-empty">
          <MapPin className="w-6 h-6 mx-auto mb-2 opacity-40" />
          No mapping saved for this visit.
        </div>
      )}
    </div>
  );
}
