import { describe, expect, it } from "vitest";

import { aggregateSlotStatus } from "./generation-output-slot-repo.js";

describe("aggregateSlotStatus（IK67HE/T14 四态聚合）", () => {
  it("全 succeeded → success", () => {
    expect(aggregateSlotStatus(["succeeded", "succeeded"])).toBe("success");
  });

  it("全 failed/missing → failed", () => {
    expect(aggregateSlotStatus(["failed", "missing"])).toBe("failed");
    expect(aggregateSlotStatus(["failed", "failed"])).toBe("failed");
  });

  it("至少一个 succeeded 且至少一个 failed/missing → partial", () => {
    expect(aggregateSlotStatus(["succeeded", "failed"])).toBe("partial");
    expect(aggregateSlotStatus(["succeeded", "succeeded", "missing"])).toBe(
      "partial",
    );
  });

  it("存在 pending → generating（尚有未终态槽）", () => {
    expect(aggregateSlotStatus(["pending", "succeeded"])).toBe("generating");
    expect(aggregateSlotStatus(["pending"])).toBe("generating");
  });

  it("空槽集合 → failed（无槽位无法成功）", () => {
    expect(aggregateSlotStatus([])).toBe("failed");
  });
});
