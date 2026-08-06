import { describe, expect, it } from "vitest";

import { classifyPlanApplicationAvailability } from "./plan-application-availability.js";

describe("classifyPlanApplicationAvailability", () => {
  it("素材与能力都正常且余额充足 → available", () => {
    expect(
      classifyPlanApplicationAvailability({
        mentionUnavailable: false,
        capabilityDrifted: false,
        balanceSufficient: true,
      }),
    ).toBe("available");
  });

  it("素材失效 → requires_new_plan（即使余额充足）", () => {
    expect(
      classifyPlanApplicationAvailability({
        mentionUnavailable: true,
        capabilityDrifted: false,
        balanceSufficient: true,
      }),
    ).toBe("requires_new_plan");
  });

  it("能力永久漂移 → requires_new_plan", () => {
    expect(
      classifyPlanApplicationAvailability({
        mentionUnavailable: false,
        capabilityDrifted: true,
        balanceSufficient: true,
      }),
    ).toBe("requires_new_plan");
  });

  it("余额耗尽 → retryable_blocked（素材与能力都正常）", () => {
    expect(
      classifyPlanApplicationAvailability({
        mentionUnavailable: false,
        capabilityDrifted: false,
        balanceSufficient: false,
      }),
    ).toBe("retryable_blocked");
  });

  it("requires_new_plan 优先于 retryable_blocked（素材失效且余额不足）", () => {
    expect(
      classifyPlanApplicationAvailability({
        mentionUnavailable: true,
        capabilityDrifted: false,
        balanceSufficient: false,
      }),
    ).toBe("requires_new_plan");
  });

  it("余额未知（snapshot 场景）且素材/能力正常 → available（不判 retryable_blocked）", () => {
    expect(
      classifyPlanApplicationAvailability({
        mentionUnavailable: false,
        capabilityDrifted: false,
        balanceSufficient: null,
      }),
    ).toBe("available");
  });
});
