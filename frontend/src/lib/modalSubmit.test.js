import { finishModalSuccess } from "@/lib/modalSubmit";

describe("finishModalSuccess", () => {
  it("calls onSuccess then onClose", () => {
    const order = [];
    finishModalSuccess({
      onSuccess: () => order.push("success"),
      onClose: () => order.push("close"),
    });
    expect(order).toEqual(["success", "close"]);
  });
});
