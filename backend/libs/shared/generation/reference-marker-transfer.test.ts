import { describe, expect, it, vi } from "vitest";
import { transferPromptReferenceMarkers } from "./reference-marker-transfer.js";

const ref = (id: string, role: "first_frame" | "last_frame" | "reference", type: "image" | "video" | "audio" = "image") =>
  ({ id, role, type });

describe("transferPromptReferenceMarkers（IKG6EK / ADR-0088）", () => {
  it("正文无标记 → 原样返回，且不查库", async () => {
    const resolveAssets = vi.fn();
    expect(
      await transferPromptReferenceMarkers({
        prompt: "画一只猫",
        items: [ref("9", "reference")],
        materialOnlyIds: [],
        resolveAssets,
      }),
    ).toBe("画一只猫");
    expect(resolveAssets).not.toHaveBeenCalled();
  });

  it("本地素材命中：按 references 顺序出 @图片N", async () => {
    expect(
      await transferPromptReferenceMarkers({
        prompt: "一条清澈的小河参考&21& ，一只小马在喝水",
        items: [ref("21", "reference"), ref("22", "reference")],
        materialOnlyIds: [],
        resolveAssets: vi.fn(),
      }),
    ).toBe("一条清澈的小河参考@图片1 ，一只小马在喝水");
  });

  it("视频：首尾帧按角色、普通参考按同类型编号", async () => {
    expect(
      await transferPromptReferenceMarkers({
        prompt: "&9&里的人走动，参考&22&",
        items: [ref("9", "first_frame"), ref("22", "reference"), ref("23", "reference", "video")],
        materialOnlyIds: [],
        resolveAssets: vi.fn(),
      }),
    ).toBe("@首帧里的人走动，参考@图片1");
  });

  it("素材库引用：经身份桥解析成本地 asset 后按位次出标签", async () => {
    const resolveAssets = vi.fn(async () => [{ id: "21", material_id: "555" }]);
    expect(
      await transferPromptReferenceMarkers({
        prompt: "参考&21&",
        items: [ref("9", "first_frame"), ref("555", "reference")],
        materialOnlyIds: ["555"],
        resolveAssets,
      }),
    ).toBe("参考@图片1");
    expect(resolveAssets).toHaveBeenCalledWith(["21"]);
  });

  it("桥解出的 asset 未命中本次 material → 不建立映射，标记原样保留", async () => {
    const resolveAssets = vi.fn(async () => [{ id: "21", material_id: "999" }]);
    expect(
      await transferPromptReferenceMarkers({
        prompt: "参考&21&",
        items: [ref("555", "reference")],
        materialOnlyIds: ["555"],
        resolveAssets,
      }),
    ).toBe("参考&21&");
  });

  it("身份不在本次素材集合 → 不转，原样保留", async () => {
    expect(
      await transferPromptReferenceMarkers({
        prompt: "参考&99999&",
        items: [ref("21", "reference")],
        materialOnlyIds: [],
        resolveAssets: vi.fn(),
      }),
    ).toBe("参考&99999&");
  });

  it("已在本地的标识不触发查库（全部命中时跳过桥）", async () => {
    const resolveAssets = vi.fn();
    await transferPromptReferenceMarkers({
      prompt: "&21&和&22&",
      items: [ref("21", "reference"), ref("22", "reference")],
      materialOnlyIds: ["555"],
      resolveAssets,
    });
    expect(resolveAssets).not.toHaveBeenCalled();
  });
});
