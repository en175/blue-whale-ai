import { describe, expect, it } from "vitest";
import {
  buildReferenceMarkerLabels,
  videoRefLabel,
  type VideoRefItem,
} from "./prompt-doc.js";


const ref = (
  id: string,
  role: VideoRefItem["role"],
  type: VideoRefItem["type"] = "image",
): VideoRefItem => ({ id, role, type });

describe("videoRefLabel（视频角色与同类型编号，IKFA1O）", () => {
  const REFS = [
    ref("7", "first_frame"),
    ref("8", "last_frame"),
    ref("9", "reference"),
    ref("11", "reference"),
    ref("13", "reference", "video"),
    ref("15", "reference", "audio"),
  ];

  it("首尾帧按角色显示，不占同类型编号", () => {
    expect(videoRefLabel("7", REFS)).toBe("首帧");
    expect(videoRefLabel("8", REFS)).toBe("尾帧");
  });

  it("普通参考按同类型连续编号（图片N / 视频N / 音频N 各自计数）", () => {
    expect(videoRefLabel("9", REFS)).toBe("图片1");
    expect(videoRefLabel("11", REFS)).toBe("图片2");
    expect(videoRefLabel("13", REFS)).toBe("视频1");
    expect(videoRefLabel("15", REFS)).toBe("音频1");
  });

  it("身份不在集合 → null", () => {
    expect(videoRefLabel("999", REFS)).toBeNull();
  });
});

describe("buildReferenceMarkerLabels（引用标记 → 标签，IKG6EK / ADR-0088）", () => {
  const REFS = [
    ref("7", "first_frame"),
    ref("9", "reference"),
    ref("11", "reference"),
    ref("13", "reference", "video"),
  ];

  it("覆盖全部身份，值与 videoRefLabel 同口径", () => {
    expect([...buildReferenceMarkerLabels(REFS).entries()]).toEqual([
      ["7", "首帧"],
      ["9", "图片1"],
      ["11", "图片2"],
      ["13", "视频1"],
    ]);
  });

  it("标签不带 @ —— 前缀由转移函数统一补", () => {
    for (const label of buildReferenceMarkerLabels(REFS).values()) {
      expect(label.startsWith("@")).toBe(false);
    }
  });

  it("空集合返回空表（转移函数退化为原样返回）", () => {
    expect(buildReferenceMarkerLabels([]).size).toBe(0);
  });

  it("身份形态无关：素材库 / 虚拟角色库的 asset- 前缀 id 一样出标签", () => {
    const refs = [
      ref("asset-active-1", "reference"),
      ref("6047", "reference"),
    ];
    expect([...buildReferenceMarkerLabels(refs).entries()]).toEqual([
      ["asset-active-1", "图片1"],
      ["6047", "图片2"],
    ]);
  });
});
