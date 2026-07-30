import { describe, expect, it } from "vitest";

import { parseNewApiBearerToken } from "./bearer-token";

describe("parseNewApiBearerToken", () => {
  it.each([
    ["Bearer sk-valid", "sk-valid"],
    ["Bearer sk-valid ", null],
    ["Bearer  sk-valid", null],
    ["bearer sk-valid", null],
    ["Bearer legacy.jwt", null],
  ])("parses %j as %j", (authorization, expected) => {
    expect(parseNewApiBearerToken(authorization)).toBe(expected);
  });
});
