import { describe, expect, it } from "vitest";
import { transferReferenceMarkers } from "./transfer-reference-markers.js";

const labels = (...pairs: Array<[string, string]>) => new Map(pairs);

describe("transferReferenceMarkers（IKG6EK / ADR-0088）", () => {
  it("命中身份：&id& 换成 @标签，其余正文逐字不变", () => {
    expect(
      transferReferenceMarkers(
        "一条清澈的小河参考&21212& ，一只小马在喝水",
        labels(["21212", "图片1"]),
      ),
    ).toBe("一条清澈的小河参考@图片1 ，一只小马在喝水");
  });

  it("素材库 / 虚拟角色库身份（asset- 前缀）同样命中——本层不解释身份形态", () => {
    expect(
      transferReferenceMarkers("角色参考&asset-active-1& 出场", labels(["asset-active-1", "图片1"])),
    ).toBe("角色参考@图片1 出场");
    expect(
      transferReferenceMarkers(
        "角色参考&asset-20260916091331-r74gp& 出场",
        labels(["asset-20260916091331-r74gp", "图片1"]),
      ),
    ).toBe("角色参考@图片1 出场");
  });

  it("素材库身份大小写不敏感（本仓 materialId() / MATERIAL_ID_PATTERN /i 同口径）", () => {
    expect(
      transferReferenceMarkers("参考&Asset-active-1&", labels(["asset-active-1", "图片1"])),
    ).toBe("参考@图片1");
    expect(
      transferReferenceMarkers("参考&asset-active-1&", labels(["Asset-Active-1", "图片1"])),
    ).toBe("参考@图片1");
  });

  it("全大写身份也命中——语法层不比校验层窄（MATERIAL_ID_PATTERN 是 /i）", () => {
    expect(
      transferReferenceMarkers("参考&ASSET-x&", labels(["ASSET-x", "图片1"])),
    ).toBe("参考@图片1");
    expect(
      transferReferenceMarkers("参考&ASSET-x&", labels(["asset-x", "图片1"])),
    ).toBe("参考@图片1");
  });

  it("未闭合的 &asset- 不会吞掉后续合法标记（空白处收口）", () => {
    expect(
      transferReferenceMarkers("参考 &Asset-x 和 &7&", labels(["7", "图片1"])),
    ).toBe("参考 &Asset-x 和 @图片1");
  });

  it("数字身份不做小写回退（不存在大小写问题，也不该放宽匹配面）", () => {
    expect(transferReferenceMarkers("&6047&", labels(["asset-6047", "图片1"]))).toBe("&6047&");
  });

  it("找不到身份就不转，标记原样保留（不猜测、不删除）", () => {
    expect(transferReferenceMarkers("参考&99999& 生成", labels(["21212", "图片1"]))).toBe(
      "参考&99999& 生成",
    );
    expect(transferReferenceMarkers("参考&asset-gone& 生成", labels(["asset-active-1", "图片1"]))).toBe(
      "参考&asset-gone& 生成",
    );
  });

  it("同一素材多次提及得到同一标签", () => {
    expect(transferReferenceMarkers("&7&和&7&", labels(["7", "图片2"]))).toBe("@图片2和@图片2");
  });

  it("相邻标记互不吞噬", () => {
    expect(transferReferenceMarkers("&7&&9&", labels(["7", "图片1"], ["9", "图片2"]))).toBe(
      "@图片1@图片2",
    );
  });

  it("多个不同标记各自按 labels 替换，与标记出现顺序无关", () => {
    expect(transferReferenceMarkers("先&9&后&7&", labels(["7", "图片1"], ["9", "图片2"]))).toBe(
      "先@图片2后@图片1",
    );
  });

  it("无标记的正文原样返回", () => {
    expect(transferReferenceMarkers("画一只猫", labels(["7", "图片1"]))).toBe("画一只猫");
  });

  it("labels 为空时不做任何扫描改写", () => {
    expect(transferReferenceMarkers("参考&7&", labels())).toBe("参考&7&");
  });

  it("非引用形态的 & 保持原样：单个 &、非数字、&0&、带前导零、空 asset-", () => {
    expect(transferReferenceMarkers("A&B", labels(["7", "图片1"]))).toBe("A&B");
    expect(transferReferenceMarkers("价格 &abc& 元", labels(["7", "图片1"]))).toBe("价格 &abc& 元");
    expect(transferReferenceMarkers("&0&", labels(["0", "图片1"]))).toBe("&0&");
    expect(transferReferenceMarkers("&007&", labels(["007", "图片1"]))).toBe("&007&");
    expect(transferReferenceMarkers("&asset-&", labels(["asset-", "图片1"]))).toBe("&asset-&");
  });

  it("标签只补一个 @，不重复前缀（labels 的值不带 @）", () => {
    expect(transferReferenceMarkers("&7&", labels(["7", "图片1"]))).toBe("@图片1");
  });
});
