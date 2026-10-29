import { describe, expect, it } from "vitest";

import { resolveProjectListQuery } from "./project-list-query.js";

describe("resolveProjectListQuery", () => {
  it("treats a missing pair as the unpaged list", () => {
    expect(resolveProjectListQuery({})).toEqual({ kind: "all" });
  });

  it("rejects a lone page or size", () => {
    expect(resolveProjectListQuery({ page: "1" })).toMatchObject({ kind: "invalid" });
    expect(resolveProjectListQuery({ size: "30" })).toMatchObject({ kind: "invalid" });
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

describe("resolveProjectListQuery limit / keyword (IKRE7U)", () => {
  it("accepts limit within 1-20", () => {
    expect(resolveProjectListQuery({ limit: "1" })).toEqual({ kind: "limit", limit: 1 });
    expect(resolveProjectListQuery({ limit: "3" })).toEqual({ kind: "limit", limit: 3 });
    expect(resolveProjectListQuery({ limit: "20" })).toEqual({ kind: "limit", limit: 20 });
  });

  it("rejects limit outside 1-20 or non-integer", () => {
    for (const limit of ["0", "21", "abc", "3.5", ""]) {
      expect(resolveProjectListQuery({ limit })).toMatchObject({ kind: "invalid" });
    }
  });

  it("rejects limit combined with page or size", () => {
    expect(resolveProjectListQuery({ limit: "3", page: "1", size: "10" })).toMatchObject({
      kind: "invalid",
    });
    expect(resolveProjectListQuery({ limit: "3", page: "1" })).toMatchObject({
      kind: "invalid",
    });
  });

  it("trims keyword and carries it on every shape", () => {
    expect(resolveProjectListQuery({ keyword: "  设计  " })).toEqual({
      kind: "all",
      keyword: "设计",
    });
    expect(resolveProjectListQuery({ keyword: "设计", limit: "3" })).toEqual({
      kind: "limit",
      limit: 3,
      keyword: "设计",
    });
    expect(resolveProjectListQuery({ keyword: "设计", page: "2", size: "10" })).toEqual({
      kind: "page",
      page: 2,
      size: 10,
      keyword: "设计",
    });
  });

  it("ignores blank keyword and rejects overlong keyword", () => {
    expect(resolveProjectListQuery({ keyword: "   " })).toEqual({ kind: "all" });
    expect(
      resolveProjectListQuery({ keyword: "x".repeat(65) }),
    ).toMatchObject({ kind: "invalid" });
  });
});

describe("resolveProjectListQuery source (IKRGON)", () => {
  it("carries dialog/canvas and rejects unknown values", () => {
    expect(resolveProjectListQuery({ source: "dialog" })).toEqual({
      kind: "all",
      source: "dialog",
    });
    expect(resolveProjectListQuery({ source: "canvas", page: "2", size: "6" })).toEqual({
      kind: "page",
      page: 2,
      size: 6,
      source: "canvas",
    });
    expect(resolveProjectListQuery({ source: "other" })).toMatchObject({ kind: "invalid" });
  });
});
