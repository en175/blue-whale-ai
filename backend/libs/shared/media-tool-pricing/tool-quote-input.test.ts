import { describe, expect, it } from "vitest";
import {
  mixChargeSeconds,
  muxChargeInput,
  muxResolution,
  speedChargeSeconds,
  trimChargeSeconds,
} from "./tool-quote-input.js";

describe("trimChargeSeconds", () => {
  it("按截取区间向上取整", () => {
    expect(trimChargeSeconds(1.5, 10.4, 60)).toBe(9);
  });

  it("缺省起点为 0，终点缺省取源时长", () => {
    expect(trimChargeSeconds(undefined, undefined, 60)).toBe(60);
    expect(trimChargeSeconds(3, undefined, 60)).toBe(57);
  });

  it("终点超过源时长时按源时长截断", () => {
    expect(trimChargeSeconds(55, 90, 60)).toBe(5);
  });

  it("区间为空或反向时返回非正数由调用方拒绝", () => {
    expect(trimChargeSeconds(10, 10, 60)).toBe(0);
    expect(trimChargeSeconds(12, 10, 60)).toBeLessThanOrEqual(0);
  });
});

describe("speedChargeSeconds", () => {
  it("按倍速折算后向上取整，至少 1 秒", () => {
    expect(speedChargeSeconds(60, 2)).toBe(30);
    expect(speedChargeSeconds(61, 2)).toBe(31);
    expect(speedChargeSeconds(1, 4)).toBe(1);
  });
});

describe("mixChargeSeconds", () => {
  it("取最长输入按毫秒向上取整", () => {
    expect(mixChargeSeconds([30_000, 62_500])).toBe(63);
    expect(mixChargeSeconds([1_000, 2_000])).toBe(2);
  });
});

describe("muxChargeInput", () => {
  it("与扣费一致：输出时长按毫秒向上取整，而不是四舍五入", () => {
    expect(
      muxChargeInput({ videoMs: 10_200, audioMs: 8_000, sync: "video", width: 1920, height: 1080 }),
    ).toEqual({ duration: 11, resolution: "1080p" });
  });

  it("sync=audio 取音频时长，sync=none 取较长者", () => {
    expect(
      muxChargeInput({ videoMs: 10_200, audioMs: 8_000, sync: "audio", width: 1920, height: 1080 })?.duration,
    ).toBe(8);
    expect(
      muxChargeInput({ videoMs: 10_200, audioMs: 30_000, sync: "none", width: 1920, height: 1080 })?.duration,
    ).toBe(30);
  });

  it("分辨率按长边分档", () => {
    expect(muxResolution(1920)).toBe("1080p");
    expect(muxResolution(2560)).toBe("2k");
    expect(muxResolution(3840)).toBe("4k");
    expect(muxResolution(0)).toBeNull();
    expect(
      muxChargeInput({ videoMs: 1_000, audioMs: 1_000, sync: "none", width: null, height: null }),
    ).toBeNull();
  });
});
