// IKGOQ0 验收修订：图片尺寸探测器的字节布局单测（各格式构造真实头字节）与 storage 探测行为。
import { describe, expect, it, vi } from "vitest";

import {
  parseImageDimensions,
  probeImageDimensions,
} from "./image-dimensions.js";

function pngHead(width: number, height: number): Uint8Array {
  const head = new Uint8Array(32);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  head.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR 段长 13
  head.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const view = new DataView(head.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return head;
}

function gifHead(width: number, height: number): Uint8Array {
  const head = new Uint8Array(32);
  head.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // "GIF89a"
  const view = new DataView(head.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return head;
}

function bmpHead(width: number, height: number): Uint8Array {
  const head = new Uint8Array(32);
  head.set([0x42, 0x4d], 0); // "BM"
  const view = new DataView(head.buffer);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  return head;
}

function webpVp8Head(width: number, height: number): Uint8Array {
  const head = new Uint8Array(32);
  head.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  head.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  head.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  head.set([0x9d, 0x01, 0x2a], 23); // 帧签名
  const view = new DataView(head.buffer);
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);
  return head;
}

function webpVp8lHead(width: number, height: number): Uint8Array {
  const head = new Uint8Array(32);
  head.set([0x52, 0x49, 0x46, 0x46], 0);
  head.set([0x57, 0x45, 0x42, 0x50], 8);
  head.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
  head[20] = 0x2f; // 签名
  const w = width - 1;
  const h = height - 1;
  head[21] = w & 0xff;
  head[22] = ((w >> 8) & 0x3f) | ((h & 0x03) << 6);
  head[23] = (h >> 2) & 0xff;
  head[24] = (h >> 10) & 0x0f;
  return head;
}

function webpVp8xHead(width: number, height: number): Uint8Array {
  const head = new Uint8Array(32);
  head.set([0x52, 0x49, 0x46, 0x46], 0);
  head.set([0x57, 0x45, 0x42, 0x50], 8);
  head.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const w = width - 1;
  const h = height - 1;
  head[24] = w & 0xff;
  head[25] = (w >> 8) & 0xff;
  head[26] = (w >> 16) & 0xff;
  head[27] = h & 0xff;
  head[28] = (h >> 8) & 0xff;
  head[29] = (h >> 16) & 0xff;
  return head;
}

/** JPEG：SOI + 若干 APPn 段 + SOF0。appPadding 控制 APP1 段体量，模拟 EXIF 把 SOF 顶到后面。 */
function jpegHead(width: number, height: number, appPadding = 0): Uint8Array {
  const app1Len = 2 + 6 + appPadding; // 段长含自身 2 字节；6 = "Exif\0\0"
  const total = 2 + 2 + app1Len + 2 + 7 + 16;
  const head = new Uint8Array(Math.max(total, 64));
  const view = new DataView(head.buffer);
  head[0] = 0xff;
  head[1] = 0xd8; // SOI
  let o = 2;
  head[o] = 0xff;
  head[o + 1] = 0xe1; // APP1
  view.setUint16(o + 2, app1Len);
  head.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], o + 4); // "Exif\0\0"
  o += 2 + app1Len;
  head[o] = 0xff;
  head[o + 1] = 0xc0; // SOF0
  view.setUint16(o + 2, 17); // 段长
  head[o + 4] = 8; // precision
  view.setUint16(o + 5, height);
  view.setUint16(o + 7, width);
  return head;
}

describe("parseImageDimensions：各格式字节布局", () => {
  it("parses PNG dimensions from the IHDR header", () => {
    expect(parseImageDimensions(pngHead(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it("parses GIF dimensions from the logical screen descriptor", () => {
    expect(parseImageDimensions(gifHead(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it("parses BMP dimensions and normalizes a negative (top-down) height", () => {
    expect(parseImageDimensions(bmpHead(800, 600))).toEqual({ width: 800, height: 600 });
    expect(parseImageDimensions(bmpHead(800, -600))).toEqual({ width: 800, height: 600 });
  });

  it("parses lossy WebP (VP8) dimensions masked to 14 bits", () => {
    expect(parseImageDimensions(webpVp8Head(1024, 768))).toEqual({ width: 1024, height: 768 });
  });

  it("parses lossless WebP (VP8L) dimensions from the packed bits", () => {
    expect(parseImageDimensions(webpVp8lHead(1776, 2368))).toEqual({ width: 1776, height: 2368 });
  });

  it("parses extended WebP (VP8X) canvas dimensions stored as value-1", () => {
    expect(parseImageDimensions(webpVp8xHead(300, 200))).toEqual({ width: 300, height: 200 });
  });

  it("parses JPEG dimensions from the SOF segment right after SOI", () => {
    expect(parseImageDimensions(jpegHead(1776, 2368, 0))).toEqual({ width: 1776, height: 2368 });
  });

  it("finds the JPEG SOF segment behind a large EXIF APP1 segment", () => {
    expect(parseImageDimensions(jpegHead(4160, 3120, 60_000))).toEqual({
      width: 4160,
      height: 3120,
    });
  });

  it("returns null for a JPEG without any SOF segment in the probed head", () => {
    const head = new Uint8Array(64);
    head[0] = 0xff;
    head[1] = 0xd8;
    head[2] = 0xff;
    head[3] = 0xe1;
    new DataView(head.buffer).setUint16(4, 60); // APP1 段长越界 → 扫不到 SOF
    expect(parseImageDimensions(head)).toBeNull();
  });

  it("returns null for a non-image file (mp3)", () => {
    const head = new Uint8Array(32);
    head.set([0x49, 0x44, 0x33], 0); // "ID3"
    expect(parseImageDimensions(head)).toBeNull();
  });

  it("returns null for recognized-but-unsupported layouts (heic)", () => {
    const head = new Uint8Array(32);
    head.set([0x00, 0x00, 0x00, 0x18], 0);
    head.set([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
    head.set([0x68, 0x65, 0x69, 0x63], 8); // "heic"
    expect(parseImageDimensions(head)).toBeNull();
  });
});

describe("probeImageDimensions：storage 探测行为", () => {
  const storageOf = (head: Uint8Array | null) => ({
    readHead: vi.fn().mockResolvedValue(head),
  });

  it("reads only 32 bytes for PNG and parses dimensions", async () => {
    const storage = storageOf(pngHead(1920, 1080));
    await expect(probeImageDimensions(storage, "uploads/9/image/a.png")).resolves.toEqual({
      width: 1920,
      height: 1080,
    });
    expect(storage.readHead).toHaveBeenCalledTimes(1);
    expect(storage.readHead).toHaveBeenCalledWith("uploads/9/image/a.png", 32);
  });

  it("re-reads a larger head for JPEG to scan past EXIF segments", async () => {
    const storage = storageOf(jpegHead(1776, 2368, 60_000));
    await expect(probeImageDimensions(storage, "uploads/9/image/a.jpg")).resolves.toEqual({
      width: 1776,
      height: 2368,
    });
    expect(storage.readHead).toHaveBeenCalledTimes(2);
    expect(storage.readHead).toHaveBeenLastCalledWith("uploads/9/image/a.jpg", 256 * 1024);
  });

  it("returns null when the object cannot be read", async () => {
    await expect(
      probeImageDimensions(storageOf(null), "uploads/9/image/missing.png"),
    ).resolves.toBeNull();
  });

  it("returns null when readHead throws (storage degraded)", async () => {
    const storage = { readHead: vi.fn().mockRejectedValue(new Error("timeout")) };
    await expect(probeImageDimensions(storage, "uploads/9/image/a.png")).resolves.toBeNull();
  });
});
