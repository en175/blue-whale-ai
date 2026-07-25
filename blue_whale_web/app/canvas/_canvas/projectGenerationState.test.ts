import { describe, expect, it } from "vitest";
import { setProjectSubmitting } from "./projectGenerationState";

describe("project generation state", () => {
  it("切换 Project 时只禁用正在提交的 Project", () => {
    const projectA = setProjectSubmitting({}, "project-a", true);

    expect(projectA["project-a"]).toBe(true);
    expect(projectA["project-b"]).toBeUndefined();

    const finished = setProjectSubmitting(projectA, "project-a", false);
    expect(finished).toEqual({});
  });
});
