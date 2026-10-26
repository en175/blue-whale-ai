import { describe, expect, it } from "vitest";

import { normalizeNickname } from "./nickname.js";

describe("normalizeNickname", () => {
  it("接受 2–20 个中英文数字下划线短横线", () => {
    expect(normalizeNickname("蓝鲸")).toEqual({ ok: true, value: "蓝鲸" });
    expect(normalizeNickname("Ab_12-")).toEqual({ ok: true, value: "Ab_12-" });
    expect(normalizeNickname("a".repeat(20))).toMatchObject({ ok: true });
  });

  it("首尾空白裁掉，中间空白拒绝", () => {
    expect(normalizeNickname("  小明  ")).toEqual({ ok: true, value: "小明" });
    expect(normalizeNickname("小 明")).toEqual({ ok: false, reason: "chars" });
    expect(normalizeNickname("小\n明")).toEqual({ ok: false, reason: "chars" });
  });

  it("长度按字符算，扩展汉字计 1 个", () => {
    expect(normalizeNickname("𠀀𠀀")).toMatchObject({ ok: true });
    expect(normalizeNickname("a")).toEqual({ ok: false, reason: "length" });
    expect(normalizeNickname("a".repeat(21))).toEqual({ ok: false, reason: "length" });
  });

  it("拒绝 Emoji 与其他字符", () => {
    expect(normalizeNickname("小明😀")).toMatchObject({ ok: false });
    expect(normalizeNickname("x@y")).toMatchObject({ ok: false });
    expect(normalizeNickname(123)).toMatchObject({ ok: false });
  });
});
