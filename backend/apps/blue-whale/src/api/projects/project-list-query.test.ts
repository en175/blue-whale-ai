import { describe, expect, it } from "vitest";

import { resolveProjectListQuery } from "./project-list-query.js";

describe("resolveProjectListQuery", () => {
  it("treats a missing pair as the unpaged list", () => {
    expect(resolveProjectListQuery({})).toEqual({ kind: "all" });
  });

  it("rejects a lone page or size", () => {
    expect(resolveProjectListQuery({ page: "1" })).toEqual({ kind: "invalid" });
    expect(resolveProjectListQuery({ size: "30" })).toEqual({ kind: "invalid" });
  });

  it("clamps invalid paired numbers to 1 like /api/assets", () => {
    expect(resolveProjectListQuery({ page: "0", size: "-3" })).toEqual({
      kind: "page",
      page: 1,
      size: 1,
    });
    expect(resolveProjectListQuery({ page: "abc", size: "" })).toEqual({
      kind: "page",
      page: 1,
      size: 1,
    });
  });

  it("passes through a valid pair", () => {
    expect(resolveProjectListQuery({ page: "2", size: "30" })).toEqual({
      kind: "page",
      page: 2,
      size: 30,
    });
  });
});
