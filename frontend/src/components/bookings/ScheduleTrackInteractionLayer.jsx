import { hitTestTrackPointer, logScheduleInteractionDebug } from "./scheduleInteraction";

/**
 * Transparent hit target above slot visuals, below appointment cards (z-3 vs z-10).
 */
export default function ScheduleTrackInteractionLayer({
  trackRef,
  enabled,
  onPointerDownHit,
  onPointerMoveHit,
  onPointerUpHit,
}) {
  if (!enabled) return null;

  return (
    <div
      className="absolute inset-0 z-[3] cursor-pointer touch-none"
      data-schedule-interaction-layer=""
      aria-hidden
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const trackEl = trackRef?.current;
        const hit = hitTestTrackPointer(trackEl, e.clientX, e.clientY);
        if (!hit) return;
        logScheduleInteractionDebug({
          phase: "down",
          x: hit.localX,
          y: hit.localY,
          staffId: hit.staffId,
          time: hit.timeStr,
          slotIndex: hit.slotIndex,
        });
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        onPointerDownHit?.(e, hit);
      }}
      onPointerMove={(e) => {
        if ((e.buttons & 1) === 0) return;
        const trackEl = trackRef?.current;
        const hit = hitTestTrackPointer(trackEl, e.clientX, e.clientY);
        if (!hit) return;
        onPointerMoveHit?.(e, hit);
      }}
      onPointerUp={(e) => {
        const trackEl = trackRef?.current;
        const hit = hitTestTrackPointer(trackEl, e.clientX, e.clientY);
        onPointerUpHit?.(e, hit);
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }}
      onPointerCancel={(e) => {
        onPointerUpHit?.(e, null);
      }}
    />
  );
}
