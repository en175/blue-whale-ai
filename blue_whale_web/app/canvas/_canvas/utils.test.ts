import { describe, expect, it } from "vitest";

import { dockAccept } from "./utils";

describe("dockAccept", () => {
  it("allows only image and video nodes in the video Dock", () => {
    expect(dockAccept("video")).toEqual(["image", "video"]);
  });
});

describe("dockPickHint", () => {
  it("names both supported media kinds in video reference mode", async () => {
    const module = await import("./utils");
    expect(module.dockPickHint).toBeTypeOf("function");
    expect(module.dockPickHint?.("video", 0)).toBe(
      "画布上还没有可用的图片或视频",
    );
    expect(module.dockPickHint?.("video", 2)).toBe(
      "点击画布中的图片或视频加入",
    );
  });
});
