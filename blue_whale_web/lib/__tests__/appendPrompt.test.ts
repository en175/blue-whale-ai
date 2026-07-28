import { describe, it, expect } from "vitest";
import { appendPrompt } from "../appendPrompt";

describe("appendPrompt", () => {
  it("existing empty → returns incoming directly", () => {
    expect(appendPrompt("", "hello")).toBe("hello");
  });

  it("existing non-empty → joins with newline", () => {
    expect(appendPrompt("hello", "world")).toBe("hello\nworld");
  });

  it("existing whitespace-only → treated as empty, returns incoming", () => {
    expect(appendPrompt("   ", "hello")).toBe("hello");
  });

  it("consecutive appends → each adds a newline", () => {
    const first = appendPrompt("", "a");
    const second = appendPrompt(first, "b");
    expect(second).toBe("a\nb");
  });
});
