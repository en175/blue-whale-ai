import { describe, expect, it } from "vitest";

import { wireInteger, wireNullableInteger } from "./wire-integer";

describe("wireInteger", () => {
  it("keeps safe integers numeric and preserves larger database ids as strings", () => {
    expect(wireInteger("42")).toBe(42);
    expect(wireInteger("9007199254740993")).toBe("9007199254740993");
  });

  it("preserves null for optional database ids", () => {
    expect(wireNullableInteger(null)).toBeNull();
    expect(wireNullableInteger("9007199254740993")).toBe("9007199254740993");
  });
});
