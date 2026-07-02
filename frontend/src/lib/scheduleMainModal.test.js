import { canCloseUtilityDrawer } from "./scheduleMainModal";

describe("scheduleMainModal", () => {
  it("allows close when guard passes", () => {
    const ref = { current: () => true };
    expect(canCloseUtilityDrawer(ref)).toBe(true);
  });

  it("blocks close when guard returns false", () => {
    const ref = { current: () => false };
    expect(canCloseUtilityDrawer(ref)).toBe(false);
  });

  it("allows close when no guard", () => {
    expect(canCloseUtilityDrawer(null)).toBe(true);
    expect(canCloseUtilityDrawer({ current: null })).toBe(true);
  });
});
