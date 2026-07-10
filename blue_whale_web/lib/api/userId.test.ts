// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getOrCreateUserId } from "./userId";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  // 清掉外部污染值,确保 getOrCreateUserId 走"无则生成"路径
  window.localStorage.removeItem("bw-user-id");
});

describe("getOrCreateUserId", () => {
  it("首次进入生成合规 UUID v4 并持久化", () => {
    const id = getOrCreateUserId();
    expect(id).toMatch(UUID_V4_RE);
    expect(window.localStorage.getItem("bw-user-id")).toBe(id);
  });

  it("二次进入复用已存值（不重新生成）", () => {
    const first = getOrCreateUserId();
    const second = getOrCreateUserId();
    expect(second).toBe(first);
  });

  it("外部污染（非法值）覆盖重发为合法 UUID", () => {
    window.localStorage.setItem("bw-user-id", "not-a-uuid");
    const id = getOrCreateUserId();
    expect(id).toMatch(UUID_V4_RE);
    expect(window.localStorage.getItem("bw-user-id")).toBe(id);
  });

  it("外部写入了格式合法但非 v4 的 UUID,仍当作非法并覆盖", () => {
    // v1 格式（时间基）—— BACKEND-API-PRD §4 要求 v4
    window.localStorage.setItem("bw-user-id", "550e8400-e29b-11d4-a716-446655440000");
    const id = getOrCreateUserId();
    expect(id).toMatch(UUID_V4_RE);
    expect(id).not.toBe("550e8400-e29b-11d4-a716-446655440000");
  });

  it("localStorage 不可用时不抛、仍返回合法 UUID", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("quota exceeded");
        },
        setItem: () => {
          throw new Error("quota exceeded");
        },
        removeItem: () => {
          /* noop */
        },
      },
      configurable: true,
    });
    try {
      const id = getOrCreateUserId();
      expect(id).toMatch(UUID_V4_RE);
    } finally {
      Object.defineProperty(window, "localStorage", {
        value: original,
        configurable: true,
      });
    }
  });
});
