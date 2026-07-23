import { describe, it, expect } from "vitest";
import { dockAccept } from "./utils";

/**
 * D-3 picking.accept：Dock「从画布选」按类型过滤（IJZY24）。
 * image Dock / 首尾帧 → 只图；video/audio Dock → 图视音。
 */
describe("dockAccept（D-3 Dock 选参考类型过滤）", () => {
  it("image Dock → 只 [image]", () => {
    expect(dockAccept("image")).toEqual(["image"]);
  });
  it("video Dock → [image, video, audio]", () => {
    expect(dockAccept("video")).toEqual(["image", "video", "audio"]);
  });
  it("audio Dock → [image, video, audio]", () => {
    expect(dockAccept("audio")).toEqual(["image", "video", "audio"]);
  });
  it("首尾帧 picking → [image]（首尾帧要图）", () => {
    expect(dockAccept("firstFrame")).toEqual(["image"]);
    expect(dockAccept("lastFrame")).toEqual(["image"]);
  });
});
