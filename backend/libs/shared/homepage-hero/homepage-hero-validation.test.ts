import { describe, expect, it } from "vitest";

import {
  parseBigId,
  parseHomepageHeroForm,
  parseMoveDirection,
} from "./homepage-hero-validation.js";

describe("parseHomepageHeroForm — 首页背景配置入参校验（IKCH05）", () => {
  it("合法视频：media_type=video + media_url + poster_url", () => {
    const r = parseHomepageHeroForm({
      media_type: "video",
      media_url: "https://tos.example.com/v.mp4",
      poster_url: "https://tos.example.com/p.jpg",
      sort_order: 2,
      enabled: 1,
    });
    expect(r).toEqual({
      ok: true,
      input: {
        media_type: "video",
        media_url: "https://tos.example.com/v.mp4",
        poster_url: "https://tos.example.com/p.jpg",
        sort_order: 2,
        enabled: 1,
      },
    });
  });

  it("视频没有 poster_url → 拒绝（视频没封面不能保存）", () => {
    const r = parseHomepageHeroForm({
      media_type: "video",
      media_url: "https://tos.example.com/v.mp4",
    });
    expect(r).toEqual({ ok: false, error: "视频背景必须配置 poster_url 封面" });
  });

  it("图片：poster_url 可空，纯图背景合法", () => {
    const r = parseHomepageHeroForm({
      media_type: "image",
      media_url: "https://tos.example.com/bg.png",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.poster_url).toBeNull();
      expect(r.input.media_type).toBe("image");
    }
  });

  it("media_type 非法拒绝", () => {
    expect(parseHomepageHeroForm({ media_type: "gif" }).ok).toBe(false);
    expect(parseHomepageHeroForm({ media_type: 1 }).ok).toBe(false);
    expect(parseHomepageHeroForm({}).ok).toBe(false);
  });

  it("media_url 可暂空（TOS 迁移期，落库为 ''）", () => {
    const r = parseHomepageHeroForm({ media_type: "image", media_url: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.media_url).toBe("");
  });

  it("media_url 非 http(s):// 或超长拒绝", () => {
    expect(
      parseHomepageHeroForm({
        media_type: "image",
        media_url: "ftp://x/1.jpg",
      }).ok,
    ).toBe(false);
    expect(
      parseHomepageHeroForm({ media_type: "image", media_url: "not-a-url" }).ok,
    ).toBe(false);
  });

  it("poster_url 非法格式拒绝", () => {
    expect(
      parseHomepageHeroForm({
        media_type: "image",
        poster_url: "abc",
      }).ok,
    ).toBe(false);
  });

  it("sort_order 缺省省略（undefined）；负值/小数/超限拒绝", () => {
    const r = parseHomepageHeroForm({ media_type: "image" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.sort_order).toBeUndefined();

    expect(
      parseHomepageHeroForm({ media_type: "image", sort_order: -1 }).ok,
    ).toBe(false);
    expect(
      parseHomepageHeroForm({ media_type: "image", sort_order: 1.5 }).ok,
    ).toBe(false);
    expect(
      parseHomepageHeroForm({ media_type: "image", sort_order: 2 ** 31 }).ok,
    ).toBe(false);
  });

  it("enabled 仅 0/1；缺省省略；其他拒绝", () => {
    const r = parseHomepageHeroForm({ media_type: "image", enabled: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.enabled).toBe(0);

    expect(
      parseHomepageHeroForm({ media_type: "image", enabled: 2 }).ok,
    ).toBe(false);
    expect(
      parseHomepageHeroForm({ media_type: "image", enabled: true }).ok,
    ).toBe(false);
  });
});

describe("parseBigId / parseMoveDirection", () => {
  it("parseBigId 仅接受正整数串", () => {
    expect(parseBigId("1")).toBe(1n);
    expect(parseBigId("123456789012345")).toBe(123456789012345n);
    expect(parseBigId("0")).toBeNull();
    expect(parseBigId("-1")).toBeNull();
    expect(parseBigId("abc")).toBeNull();
    expect(parseBigId("")).toBeNull();
    expect(parseBigId(5)).toBeNull();
    expect(parseBigId(null)).toBeNull();
    expect(parseBigId(undefined)).toBeNull();
  });

  it("parseMoveDirection 仅接受 up/down", () => {
    expect(parseMoveDirection("up")).toBe("up");
    expect(parseMoveDirection("down")).toBe("down");
    expect(parseMoveDirection("left")).toBeNull();
    expect(parseMoveDirection(1)).toBeNull();
    expect(parseMoveDirection(undefined)).toBeNull();
  });
});
