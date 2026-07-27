import { describe, expect, it } from "vitest";

import { canonicalCanvasHref } from "./canonical-project";

describe("canonicalCanvasHref", () => {
  it("uses /canvas?project= as the only project deep link", () => {
    expect(canonicalCanvasHref("55")).toBe("/canvas?project=55");
    expect(canonicalCanvasHref("项目 1")).toBe(
      "/canvas?project=%E9%A1%B9%E7%9B%AE%201",
    );
    expect(canonicalCanvasHref("55")).not.toContain("canvas-v2");
  });
});
