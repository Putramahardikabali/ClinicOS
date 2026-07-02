import {
  buildWaitlistBookingPrefill,
  buildWaitlistQueryParams,
  resolveWaitlistDateRange,
  waitlistEmptyMessage,
} from "./waitingList";

describe("waitingList", () => {
  const fixedNow = new Date("2026-06-02T12:00:00");

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(fixedNow);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it("defaults date range to today", () => {
    expect(resolveWaitlistDateRange("today")).toEqual({
      from: "2026-06-02",
      to: "2026-06-02",
      all: false,
    });
  });

  it("resolves past 7 days through today", () => {
    expect(resolveWaitlistDateRange("past7")).toEqual({
      from: "2026-05-27",
      to: "2026-06-02",
      all: false,
    });
  });

  it("resolves next 7 days from today", () => {
    expect(resolveWaitlistDateRange("next7")).toEqual({
      from: "2026-06-02",
      to: "2026-06-08",
      all: false,
    });
  });

  it("omits date params for show all", () => {
    expect(resolveWaitlistDateRange("all")).toEqual({ from: null, to: null, all: true });
    expect(buildWaitlistQueryParams({ datePreset: "all", status: "waiting", q: "demo" })).toEqual({
      status: "waiting",
      q: "demo",
    });
  });

  it("returns preset-specific empty messages", () => {
    expect(waitlistEmptyMessage("today")).toMatch(/today/i);
    expect(waitlistEmptyMessage("past7")).toMatch(/past 7 days/i);
    expect(waitlistEmptyMessage("next7")).toMatch(/next 7 days/i);
    expect(waitlistEmptyMessage("all")).toMatch(/found/i);
  });

  it("builds booking prefill from waitlist entry", () => {
    const prefill = buildWaitlistBookingPrefill({
      id: "wl-1",
      patient_id: "p1",
      patient_name: "Test Demo",
      patient_phone: "0812",
      treatment_name_snapshot: "Anti-wrinkle",
      desired_date: "2026-06-02",
      preferred_time_type: "specific",
      preferred_time: "09:15",
      preferred_staff_id: "s1",
      notes: "Please call first",
    }, "2026-06-02");
    expect(prefill.patient_id).toBe("p1");
    expect(prefill.treatment).toBe("Anti-wrinkle");
    expect(prefill.scheduled_time).toBe("09:15");
    expect(prefill.performer_id).toBe("s1");
    expect(prefill.waiting_list_id).toBe("wl-1");
    expect(prefill.notes).toBe("Please call first");
  });
});
