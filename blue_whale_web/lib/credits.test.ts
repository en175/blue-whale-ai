import { describe, expect, it } from "vitest";

import { quotaToCredits } from "./credits";

describe("quotaToCredits", () => {
  it("converts quota with the configured display coefficient", () => {
    expect(quotaToCredits(500000, 7)).toBe(3500000);
  });

  it("does not display negative or invalid quota", () => {
    expect(quotaToCredits(-1, 7)).toBe(0);
    expect(quotaToCredits(Number.NaN, 7)).toBe(0);
  });
});
