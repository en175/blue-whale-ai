import { describe, it, expect } from "vitest";
import { parseAspectRatio, ASPECT_RATIO_BASE } from "./aspectRatio";

describe("parseAspectRatio", () => {
  describe("已知 token（基准边长作用于短边）", () => {
    it("1:1 → 正方形，宽高均为基准边长", () => {
      expect(parseAspectRatio("1:1")).toEqual({
        width: ASPECT_RATIO_BASE,
        height: ASPECT_RATIO_BASE,
      });
    });

    it("16:9 → 短边(高)=240，长边(宽)按比例放大", () => {
      // 期望值独立算出：round(240 * 16 / 9) = round(426.67) = 427
      expect(parseAspectRatio("16:9")).toEqual({ width: 427, height: 240 });
    });

    it("9:16 → 短边(宽)=240，长边(高)按比例放大", () => {
      // 期望值独立算出：round(240 * 16 / 9) = 427
      expect(parseAspectRatio("9:16")).toEqual({ width: 240, height: 427 });
    });

    it("4:3 → 短边(高)=240，长边(宽)按比例放大", () => {
      // 期望值独立算出：240 * 4 / 3 = 320
      expect(parseAspectRatio("4:3")).toEqual({ width: 320, height: 240 });
    });

    it("3:4 → 短边(宽)=240，长边(高)按比例放大", () => {
      // 期望值独立算出：240 * 4 / 3 = 320
      expect(parseAspectRatio("3:4")).toEqual({ width: 240, height: 320 });
    });

    it("21:9 → 短边(高)=240，长边(宽)按比例放大", () => {
      // 期望值独立算出：round(240 * 21 / 9) = round(560) = 560
      expect(parseAspectRatio("21:9")).toEqual({ width: 560, height: 240 });
    });
  });

  describe("回退（无法识别一律回到正方形基准）", () => {
    const fallback = { width: ASPECT_RATIO_BASE, height: ASPECT_RATIO_BASE };

    it("空串回退", () => {
      expect(parseAspectRatio("")).toEqual(fallback);
    });

    it("中文文案（非比例 token）回退", () => {
      expect(parseAspectRatio("横向")).toEqual(fallback);
    });

    it("缺冒号的数字串回退", () => {
      expect(parseAspectRatio("169")).toEqual(fallback);
    });

    it("含 0 的 0:1 回退（避免除零）", () => {
      expect(parseAspectRatio("0:1")).toEqual(fallback);
    });

    it("含 0 的 1:0 回退（避免除零）", () => {
      expect(parseAspectRatio("1:0")).toEqual(fallback);
    });
  });
});
