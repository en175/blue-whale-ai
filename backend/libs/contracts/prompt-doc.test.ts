import { describe, expect, it } from "vitest";
import {
  buildReferenceMarkerLabels,
  imageRefLabel,
  videoRefLabel,
  type VideoRefItem,
} from "./prompt-doc.js";

/* IKG6EK / ADR-0088：`prompt_doc` 已退役——本文件只保留存续的「身份 → 展示编号」派生。
   doc 的结构 schema、身份复核与正文编译随契约退役（用例见 handle-create-generation-job.test.ts
   「prompt_doc 已退役」组）。编号规则的历史契约：docs/specs/2026-09-12-ikfa1m-image-prompt-ref-contract.md。 */

const ref = (
  id: string,
  role: VideoRefItem["role"],
  type: VideoRefItem["type"] = "image",
): VideoRefItem => ({ id, role, type });

describe("imageRefLabel（图片展示编号，IKFA1M）", () => {
  it("编号 = asset_id 在有序输入集合中的下标 + 1，跟输入顺序不跟正文顺序", () => {
    expect(imageRefLabel("101", ["101", "102"])).toBe("图片1");
    expect(imageRefLabel("102", ["101", "102"])).toBe("图片2");
    expect(imageRefLabel("102", ["102", "101"])).toBe("图片1");
  });

  it("身份不在集合 → null（失效）", () => {
    expect(imageRefLabel("999", ["101", "102"])).toBeNull();
  });
});

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
});
