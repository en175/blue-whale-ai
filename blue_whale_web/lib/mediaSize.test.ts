// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scaleToShortSide,
  fallbackMediaSize,
  readLocalMediaMetadata,
  readMediaNaturalSize,
  MEDIA_SHORT_SIDE,
} from "./mediaSize";

/** 假 Image：src 赋值后微任务触发 onload（带 natural 尺寸）。 */
function makeFakeImage(naturalWidth: number, naturalHeight: number) {
  const obj: {
    naturalWidth: number;
    naturalHeight: number;
    onload: (() => void) | null;
    onerror: (() => void) | null;
    _src: string;
    src: string;
  } = {
    naturalWidth: 0,
    naturalHeight: 0,
    onload: null,
    onerror: null,
    _src: "",
    src: "",
  };
  Object.defineProperty(obj, "src", {
    configurable: true,
    get() {
      return this._src;
    },
    set(v: string) {
      this._src = v;
      setTimeout(() => {
        this.naturalWidth = naturalWidth;
        this.naturalHeight = naturalHeight;
        this.onload?.();
      }, 0);
    },
  });
  return obj;
}

/** 假 Image：src 赋值后微任务触发 onerror。 */
function makeFakeImageError() {
  const obj: {
    onload: (() => void) | null;
    onerror: (() => void) | null;
    _src: string;
    src: string;
  } = { onload: null, onerror: null, _src: "", src: "" };
  Object.defineProperty(obj, "src", {
    configurable: true,
    get() {
      return this._src;
    },
    set(v: string) {
      this._src = v;
      setTimeout(() => this.onerror?.(), 0);
    },
  });
  return obj;
}

/** 假 <video>：src 赋值后微任务触发 onloadedmetadata（带 video 尺寸）。 */
function makeFakeVideo(videoWidth: number, videoHeight: number, duration = 0) {
  const obj: {
    preload: string;
    videoWidth: number;
    videoHeight: number;
    duration: number;
    onloadedmetadata: (() => void) | null;
    onerror: (() => void) | null;
    _src: string;
    src: string;
  } = {
    preload: "",
    videoWidth: 0,
    videoHeight: 0,
    duration: 0,
    onloadedmetadata: null,
    onerror: null,
    _src: "",
    src: "",
  };
  Object.defineProperty(obj, "src", {
    configurable: true,
    get() {
      return this._src;
    },
    set(v: string) {
      this._src = v;
      setTimeout(() => {
        this.videoWidth = videoWidth;
        this.videoHeight = videoHeight;
        this.duration = duration;
        this.onloadedmetadata?.();
      }, 0);
    },
  });
  return obj;
}

describe("scaleToShortSide", () => {
  it("正方形 → 宽高均为 base", () => {
    expect(scaleToShortSide(100, 100)).toEqual({ width: 200, height: 200 });
  });
  it("16:9 横图 → 高=base、宽按比例", () => {
    expect(scaleToShortSide(1920, 1080)).toEqual({ width: 356, height: 200 });
  });
  it("9:16 竖图 → 宽=base、高按比例", () => {
    expect(scaleToShortSide(1080, 1920)).toEqual({ width: 200, height: 356 });
  });
  it("自定义 base 生效", () => {
    expect(scaleToShortSide(200, 100, 100)).toEqual({
      width: 200,
      height: 100,
    });
  });
  it("0 尺寸 → null", () => {
    expect(scaleToShortSide(0, 100)).toBeNull();
    expect(scaleToShortSide(100, 0)).toBeNull();
  });
  it("负 / NaN 尺寸 → null", () => {
    expect(scaleToShortSide(-1, 100)).toBeNull();
    expect(scaleToShortSide(NaN, 100)).toBeNull();
  });
});

describe("fallbackMediaSize", () => {
  it("image → 1:1（短边 base）", () => {
    expect(fallbackMediaSize("image")).toEqual({
      width: MEDIA_SHORT_SIDE,
      height: MEDIA_SHORT_SIDE,
    });
  });
  it("video → 16:9（短边 base）", () => {
    expect(fallbackMediaSize("video")).toEqual({
      width: 356,
      height: MEDIA_SHORT_SIDE,
    });
  });
});

describe("readMediaNaturalSize", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("image onload → 真实比例缩放尺寸", async () => {
    vi.stubGlobal("Image", function FakeImage() {
      return makeFakeImage(1920, 1080);
    });
    const p = readMediaNaturalSize("http://x/a.png", "image");
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ width: 356, height: 200 });
  });

  it("image onerror → 回退 1:1", async () => {
    vi.stubGlobal("Image", function FakeImage() {
      return makeFakeImageError();
    });
    const p = readMediaNaturalSize("http://x/a.png", "image");
    await vi.runAllTimersAsync();
    expect(await p).toEqual(fallbackMediaSize("image"));
  });

  it("video loadedmetadata → 真实比例缩放尺寸", async () => {
    const fake = makeFakeVideo(1920, 1080);
    const spy = vi
      .spyOn(document, "createElement")
      .mockReturnValue(fake as unknown as HTMLVideoElement);
    const p = readMediaNaturalSize("http://x/a.mp4", "video");
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ width: 356, height: 200 });
    expect(spy).toHaveBeenCalledWith("video");
  });

  it("超时未读到元数据 → 回退，不阻塞", async () => {
    // 真实 jsdom Image 不加载假 url，onload/onerror 均不触发；推进超时阈值
    const p = readMediaNaturalSize("http://x/never.png", "image");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toEqual(fallbackMediaSize("image"));
  });
});

describe("readLocalMediaMetadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads trusted video dimensions and duration before upload", async () => {
    const fake = makeFakeVideo(1920, 1080, 6.5);
    vi.spyOn(document, "createElement").mockReturnValue(
      fake as unknown as HTMLVideoElement,
    );
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:reference-video"),
      revokeObjectURL,
    });

    await expect(
      readLocalMediaMetadata(
        new File(["video"], "reference.mp4", { type: "video/mp4" }),
        "video",
      ),
    ).resolves.toEqual({ width: 1920, height: 1080, duration: 6.5 });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:reference-video");
  });
});
