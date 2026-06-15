import {
  REALTIME_TOPICS,
  topicsForEvent,
  toastForEvent,
  isEventRelevantToUser,
  visitTopicKey,
  debounce,
} from "./realtimeEvents";

describe("realtimeEvents", () => {
  const foUser = { id: "fo1", role: "fo", clinic_id: "c1" };
  const doctorUser = { id: "d1", role: "doctor", clinic_id: "c1" };
  const otherDoctor = { id: "d2", role: "doctor", clinic_id: "c1" };

  test("visit_assigned event maps to my-visits and visits topics", () => {
    const event = {
      type: "visit_started",
      reference_type: "visit",
      reference_id: "v1",
      performer_ids: ["d1"],
      payload: { message: "Visit started" },
    };
    const topics = topicsForEvent(event);
    expect(topics).toEqual(expect.arrayContaining([
      REALTIME_TOPICS.MY_VISITS,
      REALTIME_TOPICS.VISITS,
      "visit:v1",
    ]));
  });

  test("visit_submitted maps to front-desk topic", () => {
    const event = {
      type: "visit_submitted",
      reference_type: "visit",
      reference_id: "v2",
      performer_ids: ["d1"],
      payload: { staff_name: "Dr. A" },
    };
    expect(topicsForEvent(event)).toEqual(expect.arrayContaining([
      REALTIME_TOPICS.FRONT_DESK,
      REALTIME_TOPICS.INVOICES,
    ]));
  });

  test("doctor only receives events for assigned performer_ids", () => {
    const event = { performer_ids: ["d1"] };
    expect(isEventRelevantToUser(event, doctorUser)).toBe(true);
    expect(isEventRelevantToUser(event, otherDoctor)).toBe(false);
    expect(isEventRelevantToUser(event, foUser)).toBe(true);
  });

  test("toast for visit_submitted on FO", () => {
    const event = {
      type: "visit_submitted",
      performer_ids: ["d1"],
      payload: { staff_name: "Lisa Therapist" },
    };
    expect(toastForEvent(event, foUser)?.message).toMatch(/Lisa Therapist/);
  });

  test("toast for new visit on doctor", () => {
    const event = {
      type: "visit_started",
      performer_ids: ["d1"],
      payload: { message: "New visit assigned" },
    };
    expect(toastForEvent(event, doctorUser)?.message).toBe("New visit assigned");
  });

  test("visit topic key helper", () => {
    expect(visitTopicKey("abc")).toBe("visit:abc");
    expect(visitTopicKey("")).toBeNull();
  });

  test("debounce batches rapid calls", () => {
    jest.useFakeTimers();
    const fn = jest.fn();
    const d = debounce(fn, 500);
    d();
    d();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
