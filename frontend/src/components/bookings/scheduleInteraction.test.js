import { hitTestTrackPointer, readTrackMetrics } from "./scheduleInteraction";

function mockTrack({ orientation = "vertical", rect, attrs = {}, cssVars = {} }) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => rect;
  el.setAttribute("data-staff-id", attrs.staffId || "staff-1");
  el.setAttribute("data-open-min", String(attrs.openMin ?? 540));
  el.setAttribute("data-close-min", String(attrs.closeMin ?? 1200));
  el.setAttribute("data-interval", String(attrs.interval ?? 30));
  el.setAttribute("data-orientation", orientation);
  el.setAttribute("data-row-h", String(attrs.rowH ?? 12));
  el.setAttribute("data-slot-px", String(attrs.slotPx ?? 32));
  Object.defineProperty(el, "style", {
    value: {
      getPropertyValue: (name) => {
        if (name === "--schedule-slot-height") return cssVars.slotHeight || "";
        if (name === "--schedule-slot-width") return cssVars.slotWidth || "";
        return "";
      },
    },
  });
  return el;
}

describe("scheduleInteraction", () => {
  test("hitTestTrackPointer maps vertical y to slot index", () => {
    const track = mockTrack({
      rect: { top: 100, left: 50, width: 120, height: 720 },
      attrs: { rowH: 12, openMin: 540, closeMin: 1200, interval: 30 },
    });
    const hit = hitTestTrackPointer(track, 80, 100 + 12 * 5 + 6);
    expect(hit).not.toBeNull();
    expect(hit.staffId).toBe("staff-1");
    expect(hit.slotIndex).toBe(5);
    expect(hit.slotMin).toBe(540 + 5 * 30);
    expect(hit.timeStr).toBe("11:30");
  });

  test("hitTestTrackPointer maps horizontal x to slot index", () => {
    const track = mockTrack({
      orientation: "horizontal",
      rect: { top: 200, left: 100, width: 960, height: 52 },
      attrs: { slotPx: 32, openMin: 540, closeMin: 1200, interval: 30 },
    });
    const hit = hitTestTrackPointer(track, 100 + 32 * 3 + 10, 220);
    expect(hit).not.toBeNull();
    expect(hit.slotIndex).toBe(3);
    expect(hit.slotMin).toBe(630);
  });

  test("readTrackMetrics prefers data attributes", () => {
    const track = mockTrack({ attrs: { rowH: 11, slotPx: 18 } });
    const m = readTrackMetrics(track);
    expect(m.rowH).toBe(11);
    expect(m.slotPx).toBe(18);
  });
});
