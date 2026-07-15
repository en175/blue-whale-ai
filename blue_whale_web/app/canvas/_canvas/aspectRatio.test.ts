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

    it("16:9 → 短边(高)=200，长边(宽)按比例放大", () => {
      // 期望值独立算出：round(200 * 16 / 9) = round(355.56) = 356
      expect(parseAspectRatio("16:9")).toEqual({ width: 356, height: 200 });
    });

    it("9:16 → 短边(宽)=200，长边(高)按比例放大", () => {
      // 期望值独立算出：round(200 * 16 / 9) = 356
      expect(parseAspectRatio("9:16")).toEqual({ width: 200, height: 356 });
    });

    it("4:3 → 短边(高)=200，长边(宽)按比例放大", () => {
      // 期望值独立算出：round(200 * 4 / 3) = round(266.67) = 267
      expect(parseAspectRatio("4:3")).toEqual({ width: 267, height: 200 });
    });

    it("3:4 → 短边(宽)=200，长边(高)按比例放大", () => {
      // 期望值独立算出：round(200 * 4 / 3) = 267
      expect(parseAspectRatio("3:4")).toEqual({ width: 200, height: 267 });
    });

    it("21:9 → 短边(高)=200，长边(宽)按比例放大", () => {
      // 期望值独立算出：round(200 * 21 / 9) = round(466.67) = 467
      expect(parseAspectRatio("21:9")).toEqual({ width: 467, height: 200 });
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
