import { sniffFileSignature } from "./file-signature.js";

export interface ImageDimensions {
  width: number;
  height: number;
}

const HEAD_BYTES = 32;
const JPEG_HEAD_BYTES = 256 * 1024;

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const u16be = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const u16le = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
const u24le = (b: Uint8Array, o: number): number =>
  b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const u32be = (b: Uint8Array, o: number): number =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const i32le = (b: Uint8Array, o: number): number =>
  b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24);

const ascii4 = (b: Uint8Array, o: number): string =>
  String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

function dims(width: number, height: number): ImageDimensions | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function parsePng(head: Uint8Array): ImageDimensions | null {
  if (head.length < 24) return null;
  return dims(u32be(head, 16), u32be(head, 20));
}

function parseGif(head: Uint8Array): ImageDimensions | null {
  if (head.length < 10) return null;
  return dims(u16le(head, 6), u16le(head, 8));
}

function parseBmp(head: Uint8Array): ImageDimensions | null {
  if (head.length < 26) return null;
  return dims(i32le(head, 18), Math.abs(i32le(head, 22)));
}

function parseWebp(head: Uint8Array): ImageDimensions | null {
  if (head.length < 30) return null;
  const chunk = ascii4(head, 12);
  if (chunk === "VP8 ") {
    if (head[23] !== 0x9d || head[24] !== 0x01 || head[25] !== 0x2a) return null;
    return dims(u16le(head, 26) & 0x3fff, u16le(head, 28) & 0x3fff);
  }
  if (chunk === "VP8L") {
    if (head[20] !== 0x2f) return null;
    const width = 1 + (((head[22]! & 0x3f) << 8) | head[21]!);
    const height =
      1 + (((head[24]! & 0x0f) << 10) | (head[23]! << 2) | ((head[22]! & 0xc0) >> 6));
    return dims(width, height);
  }
  if (chunk === "VP8X") {
    return dims(1 + u24le(head, 24), 1 + u24le(head, 27));
  }
  return null;
}

function parseJpeg(head: Uint8Array): ImageDimensions | null {
  let offset = 2;
  while (offset + 9 <= head.length) {
    if (head[offset] !== 0xff) return null;
    let markerStart = offset;
    let marker = head[markerStart + 1];
    while (marker === 0xff && markerStart + 2 < head.length) {
      markerStart += 1;
      marker = head[markerStart + 1];
    }
    if (marker == null) return null;
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset = markerStart + 2;
      continue;
    }
    const segLen = u16be(head, markerStart + 2);
    if (segLen < 2) return null;
    if (SOF_MARKERS.has(marker)) {
      return dims(u16be(head, markerStart + 7), u16be(head, markerStart + 5));
    }
    offset = markerStart + 2 + segLen;
  }
  return null;
}

export function parseImageDimensions(head: Uint8Array): ImageDimensions | null {
  const signature = sniffFileSignature(head);
  if (!signature || signature.kind !== "image") return null;
  switch (signature.format) {
    case "png":
      return parsePng(head);
    case "gif":
      return parseGif(head);
    case "bmp":
      return parseBmp(head);
    case "webp":
      return parseWebp(head);
    case "jpeg":
      return parseJpeg(head);
    default:
      return null;
  }
}

export async function probeImageDimensions(
  storage: {
    readHead(storageKey: string, length: number): Promise<Uint8Array | null>;
  },
  storageKey: string,
): Promise<ImageDimensions | null> {
  let head: Uint8Array | null;
  try {
    head = await storage.readHead(storageKey, HEAD_BYTES);
  } catch {
    return null;
  }
  if (!head) return null;
  const signature = sniffFileSignature(head);
  if (!signature || signature.kind !== "image") return null;
  if (signature.format === "jpeg") {
    try {
      head = await storage.readHead(storageKey, JPEG_HEAD_BYTES);
    } catch {
      return null;
    }
    if (!head) return null;
  }
  return parseImageDimensions(head);
}
