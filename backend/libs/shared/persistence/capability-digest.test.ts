import { describe, expect, it } from "vitest";

import { capabilityDigestFromModelCapability } from "./capability-digest.js";

const CAPABILITY = {
  supported_sizes: [{ id: "2k", label: "2K", api_value: "2K" }],
  supported_aspect_ratios: ["1:1", "16:9"],
  supported_durations: null,
  supported_formats: ["png"],
  default_size: "2k",
  default_format: "png",
  default_aspect_ratio: "1:1",
  default_duration: null,
  features: { quantity_max: 4 },
};

describe("capabilityDigestFromModelCapability", () => {
  it("固定 schema v1 的 8 字段摘要，忽略未纳入旧契约的 features", () => {
    const expected =
      "sha256:1046d40616542955a70381b1b0da40a463da049d2cccde230dc547af24667711";
    const changedFeatures = {
      ...CAPABILITY,
      features: { quantity_max: 99 },
    };

    expect(capabilityDigestFromModelCapability(CAPABILITY)).toBe(expected);
    expect(capabilityDigestFromModelCapability(changedFeatures)).toBe(expected);
  });
});
