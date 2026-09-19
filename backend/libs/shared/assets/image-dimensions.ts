/**
 * 从对象存储里的图片字节探测真实宽高（IKGOQ0 验收修订）。
 *
 * 为什么需要它：assets.width/height 由前端上传时上报、后端原样存，而画布与资产库两条
 * 上传路径历史上不上报，库里约四成图片资产宽高为 NULL。扩图服务端复核
 * （imageOutpaintSourceGate）以资产宽高为权威，缺尺寸曾一律拒绝——用户在画布上明明
 * 看得到尺寸（浏览器实测回填到节点 data，从不回写资产）却被要求「重新上传」，且重传
 * 走同一路径依旧没有尺寸。
 *
 * 探测策略与上传口的 readFileSignature 同一模式：Range 读文件头——先读 32 字节认格式
 * （sniffFileSignature），PNG/GIF/BMP/WebP 的尺寸就落在头 32 字节内；JPEG 的尺寸在
 * SOF 段，可能排在 EXIF 等 APPn 段之后，追加读一段更大的头扫段。
 * 认不出格式、布局不在覆盖范围（heic/tiff/avif 等 ISO/TIFF 嵌套）、或 JPEG 扫不到 SOF
 * 都返回 null，由调用方落回「缺尺寸拒绝」——那份文件本身有问题，「请重新上传」才
 * 名副其实。
 */
import { sniffFileSignature } from "./file-signature.js";

export interface ImageDimensions {
  width: number;
  height: number;
}

/** 认格式并覆盖 PNG/GIF/BMP/WebP 尺寸布局的头长（与 FILE_SIGNATURE_HEAD_BYTES 同值）。 */
const HEAD_BYTES = 32;
/** JPEG 的 SOF 段可能排在 EXIF 等 APPn 段之后：扫段用的头长度（256KB 覆盖常见 APPn 体量）。 */
const JPEG_HEAD_BYTES = 256 * 1024;

/** SOF（Start of Frame）marker：C4=DHT、C8=JPG、CC=DAC 不是 SOF，其余 C0-CF 都是。 */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

// 读法辅助：各 parse 函数进入前已按布局校验 head.length，索引必在界内（noUncheckedIndexedAccess 下的非空断言）。
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

/** PNG：8 字节签名 + IHDR 段长 4 + "IHDR" 4，宽高 uint32BE 从第 16 字节起。 */
function parsePng(head: Uint8Array): ImageDimensions | null {
  if (head.length < 24) return null;
  return dims(u32be(head, 16), u32be(head, 20));
}

/** GIF：逻辑屏宽高 uint16LE 从第 6 字节起。 */
function parseGif(head: Uint8Array): ImageDimensions | null {
  if (head.length < 10) return null;
  return dims(u16le(head, 6), u16le(head, 8));
}

/** BMP：DIB 头宽高 int32LE 从第 18 字节起；height 为负表示自上而下存储，取绝对值。 */
function parseBmp(head: Uint8Array): ImageDimensions | null {
  if (head.length < 26) return null;
  return dims(i32le(head, 18), Math.abs(i32le(head, 22)));
}

/** WebP：RIFF 盒内第一个 chunk 决定布局——VP8（有损）/VP8L（无损）/VP8X（扩展）。 */
function parseWebp(head: Uint8Array): ImageDimensions | null {
  if (head.length < 30) return null;
  const chunk = ascii4(head, 12);
  if (chunk === "VP8 ") {
    // 帧签名 0x9D 0x01 0x2A 在第 23-25 字节，宽高 uint16LE @26/@28，低 14 位有效
    if (head[23] !== 0x9d || head[24] !== 0x01 || head[25] !== 0x2a) return null;
    return dims(u16le(head, 26) & 0x3fff, u16le(head, 28) & 0x3fff);
  }
  if (chunk === "VP8L") {
    // 签名 0x2F @20，随后 4 字节位打包：14 位宽 + 14 位高，各存「值 - 1」
    if (head[20] !== 0x2f) return null;
    const width = 1 + (((head[22]! & 0x3f) << 8) | head[21]!);
    const height =
      1 + (((head[24]! & 0x0f) << 10) | (head[23]! << 2) | ((head[22]! & 0xc0) >> 6));
    return dims(width, height);
  }
  if (chunk === "VP8X") {
    // 画布宽高 uint24LE @24/@27，各存「值 - 1」
    return dims(1 + u24le(head, 24), 1 + u24le(head, 27));
  }
  return null;
}

/** JPEG：SOI 之后逐段扫描，SOF 段内 precision(1) + height(2) + width(2)。 */
function parseJpeg(head: Uint8Array): ImageDimensions | null {
  let offset = 2; // 跳过 SOI（FF D8）
  while (offset + 9 <= head.length) {
    if (head[offset] !== 0xff) return null; // 段结构损坏
    let markerStart = offset;
    let marker = head[markerStart + 1];
    // marker 前允许填充连续 FF
    while (marker === 0xff && markerStart + 2 < head.length) {
      markerStart += 1;
      marker = head[markerStart + 1];
    }
    if (marker == null) return null;
    // 无段体的 marker：SOI/EOI/RSTn/TEM
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

/** 从头字节解析图片真实宽高；认不出或布局未覆盖返回 null。 */
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

/** 从对象存储 Range 读头探测图片真实宽高；读不到/认不出/布局未覆盖返回 null。 */
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
