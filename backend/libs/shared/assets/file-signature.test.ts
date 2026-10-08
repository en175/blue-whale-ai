import { describe, expect, it } from "vitest";

import { sniffFileSignature } from "./file-signature.js";

const CORRUPT_JPG =
  'q83vEgAQSkZJRgABV/iHIa5uRGaJSzcfNe1eD+g2D0V+zGEHgkfsy+tYlmoQ4oCSe2T5+pG6zMbVihWRdvSG8HRL1xk8/kN0pfdh' +
  'mQ3W9hAe5sHFPQ184XP/W9tzxkhV2inNMRPIGKm0Ig9J8Q/FJ8SU7Wmv88O3rP7uuvHbB9urrR/2SbAq8zwt6DjMqv2uqYAKoGm4' +
  'MC8jnllqv0ZWtB+ShUNJII0tYy/bCy6w5HkSlrNQPxcozZFIdBG308wdHEWx7Z811N3hIono8nUn8itsKzepeUaWA00V+3qv6XDo' +
  'zbUJavTPpow14AyuKidsXG3iF9yawUTS0sORuTgcYJlyRRY1yZ2bMlSaCHu++PP8tsSuWKeev/61f5JrB457ah5jqvCYxdCf5Wco' +
  '09GRtuSxvyQieysWZckegfh27pP7ICDI/vDtSQC44IFyVK6HXvo/ipWBGeZ7xB/XuC6qs3YRYnglArzMiAsPJDasPpWo4Gz0NRaL' +
  'uDTgd/7tPVQX0rdfi/FGJikWWTOnBo7PrV0KUeK+ixt8Oh0eChEwp1qBwQvzOIh1JqLqAuzyqhFj3MMrhB7Nq0E8D8JmBn0jNbag' +
  'WkiW/eMokrewvUkqwoQ7geLm1/QFiMLXjIhw9FVR5qddy52btVFNX2UfNhwxS9vcLVsRl/VybdnU6peiV2zSoAfy0WzDzeclyrU=';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (value: string) => new TextEncoder().encode(value);
const withHeader = (header: Uint8Array, length = 32) => {
  const head = new Uint8Array(length);
  head.set(header.subarray(0, length));
  return head;
};

describe("sniffFileSignature", () => {
  it("认不出 2026-09-08 那份坏文件——它不是任何一种媒体容器", () => {
    const head = new Uint8Array(Buffer.from(CORRUPT_JPG, "base64")).subarray(0, 32);
    expect([...head.subarray(0, 4)]).toEqual([0xab, 0xcd, 0xef, 0x12]);
    expect(sniffFileSignature(head)).toBeNull();
  });

  it("空字节认不出", () => {
    expect(sniffFileSignature(new Uint8Array(0))).toBeNull();
  });

  it("认出常见图片", () => {
    expect(sniffFileSignature(withHeader(bytes(0xff, 0xd8, 0xff, 0xe0)))).toEqual({
      kind: "image",
      format: "jpeg",
    });
    expect(
      sniffFileSignature(withHeader(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))),
    ).toEqual({ kind: "image", format: "png" });
    expect(sniffFileSignature(withHeader(ascii("GIF89a")))).toEqual({
      kind: "image",
      format: "gif",
    });
    const webp = withHeader(ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "));
    expect(sniffFileSignature(webp)).toEqual({ kind: "image", format: "webp" });
  });

  it("heic / bmp / tiff 都认得出，不是「坏文件」", () => {
    const heic = withHeader(ascii("\u0000\u0000\u0000\u0018ftypheic"));
    expect(sniffFileSignature(heic)).toEqual({ kind: "image", format: "heic" });
    expect(sniffFileSignature(withHeader(ascii("BM")))).toEqual({ kind: "image", format: "bmp" });
    expect(sniffFileSignature(withHeader(bytes(0x49, 0x49, 0x2a, 0x00)))).toEqual({
      kind: "image",
      format: "tiff",
    });
  });

  it("ftyp 盒子按 brand 分图片和视频，不能一见 ftyp 就当视频", () => {
    expect(sniffFileSignature(withHeader(ascii("\u0000\u0000\u0000\u0018ftypisom")))).toEqual({
      kind: "video",
      format: "isom",
    });
    expect(sniffFileSignature(withHeader(ascii("\u0000\u0000\u0000\u0018ftypavif")))).toEqual({
      kind: "image",
      format: "avif",
    });
  });

  it("认出 matroska / webm", () => {
    expect(sniffFileSignature(withHeader(bytes(0x1a, 0x45, 0xdf, 0xa3)))).toEqual({
      kind: "video",
      format: "matroska",
    });
  });

  it("一段散文认不出——它不是媒体文件", () => {
    expect(sniffFileSignature(ascii("这是一段散文，不是任何媒体。"))).toBeNull();
  });
});
