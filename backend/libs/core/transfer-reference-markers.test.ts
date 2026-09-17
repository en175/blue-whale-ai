import { describe, expect, it } from "vitest";
import { markerAssetIdsOf, transferReferenceMarkers } from "./transfer-reference-markers.js";

const labels = (...pairs: Array<[string, string]>) => new Map(pairs);

describe("transferReferenceMarkers（IKG6EK / ADR-0088）", () => {
  it("命中身份：&asset_id& 换成 @标签，其余正文逐字不变", () => {
    expect(
      transferReferenceMarkers(
        "一条清澈的小河参考&21212& ，一只小马在喝水",
        labels(["21212", "图片1"]),
      ),
    ).toBe("一条清澈的小河参考@图片1 ，一只小马在喝水");
  });

  it("找不到身份就不转，标记原样保留（不猜测、不删除）", () => {
    expect(
      transferReferenceMarkers("参考&99999& 生成", labels(["21212", "图片1"])),
    ).toBe("参考&99999& 生成");
  });

  it("同一素材多次提及得到同一标签", () => {
    expect(
      transferReferenceMarkers("&7&和&7&", labels(["7", "图片2"])),
    ).toBe("@图片2和@图片2");
  });

  it("多个不同标记各自按 labels 替换，与标记出现顺序无关", () => {
    expect(
      transferReferenceMarkers("先&9&后&7&", labels(["7", "图片1"], ["9", "图片2"])),
    ).toBe("先@图片2后@图片1");
  });

  it("无标记的正文原样返回", () => {
    expect(transferReferenceMarkers("画一只猫", labels(["7", "图片1"]))).toBe("画一只猫");
  });

  it("labels 为空时不做任何扫描改写", () => {
    expect(transferReferenceMarkers("参考&7&", labels())).toBe("参考&7&");
  });

  it("非引用形态的 & 保持原样：单个 &、非数字、&0&、带前导零", () => {
    expect(transferReferenceMarkers("A&B", labels(["7", "图片1"]))).toBe("A&B");
    expect(transferReferenceMarkers("价格 &abc& 元", labels(["7", "图片1"]))).toBe("价格 &abc& 元");
    expect(transferReferenceMarkers("&0&", labels(["0", "图片1"]))).toBe("&0&");
    expect(transferReferenceMarkers("&007&", labels(["007", "图片1"]))).toBe("&007&");
  });

  it("标签只补一个 @，不重复前缀（labels 的值不带 @）", () => {
    expect(transferReferenceMarkers("&7&", labels(["7", "图片1"]))).toBe("@图片1");
  });
});

describe("markerAssetIdsOf（与转移同一套语法）", () => {
  it("取出被引用的 asset id，去重保首见", () => {
    expect(markerAssetIdsOf("先&9&后&7&再&9&")).toEqual(["9", "7"]);
  });

  it("非引用形态的 & 不计入", () => {
    expect(markerAssetIdsOf("A&B 价格 &abc& &0& &007&")).toEqual([]);
  });

  it("无标记返回空数组", () => {
    expect(markerAssetIdsOf("画一只猫")).toEqual([]);
  });

  it("与 transferReferenceMarkers 同源：扫出来的 id 就是会被替换的 id", () => {
    const prompt = "参考&21&和&22&，还有&abc&";
    const ids = markerAssetIdsOf(prompt);
    const map = new Map(ids.map((id) => [id, `图片${id}`]));
    expect(transferReferenceMarkers(prompt, map)).toBe("参考@图片21和@图片22，还有&abc&");
  });
});
