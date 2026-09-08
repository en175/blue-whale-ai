/**
 * 文件开头那几个字节说这是什么（IKE53U）。
 *
 * **这不是格式白名单。** 支不支持某种编码是策略，住在别处；这里只回答一个事实问题——这份
 * 字节是不是一份媒体文件。所以判据是「认不出任何已知容器才拒」，而不是「不在名单里就拒」：
 * heic（iPhone 拍照默认）、bmp、tiff 都认得出、TOS 也转得动，把它们挡在门外是错的。
 *
 * 为什么要有这一步：上传口此前只校验**声明值**——type 合法、mime 前缀与 type 对得上、size
 * 为正且不超上限，complete 时再比一次对象存储上的 size 与 Content-Type 是否与声明一致。而
 * Content-Type 正是客户端 PUT 时自己写的，两边自然自洽，对一份伪造的文件毫无作用。测试站
 * 2026-09-08 的 asset_id=6012 就这么进了库：524 字节随机数据，头四字节 AB CD EF 12，声明
 * image/jpeg，一路畅通。
 *
 * width/height 也当不了信号：它们由前端上报、后端原样存，库里 2129 张图有 860 张是 null。
 */

export type MediaKind = "image" | "video" | "audio";

export interface FileSignature {
  kind: MediaKind;
  /** 小写短名，来自字节而不是后缀：`jpeg` / `png` / `mp4` / `heic` … */
  format: string;
}

const startsWith = (head: Uint8Array, bytes: readonly number[]): boolean =>
  head.length >= bytes.length && bytes.every((byte, index) => head[index] === byte);

const ascii = (head: Uint8Array, offset: number, length: number): string =>
  head.length >= offset + length
    ? String.fromCharCode(...head.subarray(offset, offset + length))
    : "";

/**
 * ISO 基础媒体容器（`....ftyp<brand>`）。同一个盒子既装 MP4 也装 HEIC 和 AVIF，只有 brand
 * 分得开——所以这里必须看 brand，不能一见 `ftyp` 就当视频。
 */
const ISO_IMAGE_BRANDS = ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1", "avif", "avis"];

function sniffIsoContainer(head: Uint8Array): FileSignature | null {
  if (ascii(head, 4, 4) !== "ftyp") return null;
  const brand = ascii(head, 8, 4).toLowerCase().trim();
  if (ISO_IMAGE_BRANDS.includes(brand)) return { kind: "image", format: brand };
  if (brand === "m4a" || brand === "m4b") return { kind: "audio", format: "m4a" };
  // 其余 brand（isom / mp41 / mp42 / avc1 / qt / M4V …）都是视频容器。认不出的 brand 也
  // 归到这里：ftyp 盒子本身已经证明它是一份 ISO 媒体文件，而这一层要判的正是「是不是媒体」。
  return { kind: "video", format: brand || "mp4" };
}

function sniffRiffContainer(head: Uint8Array): FileSignature | null {
  if (ascii(head, 0, 4) !== "RIFF") return null;
  const form = ascii(head, 8, 4).toUpperCase();
  if (form === "WEBP") return { kind: "image", format: "webp" };
  if (form === "AVI ") return { kind: "video", format: "avi" };
  if (form === "WAVE") return { kind: "audio", format: "wav" };
  return null;
}

/**
 * 认这份字节。认不出返回 `null`——那才是「这不是一份媒体文件」。
 *
 * 只需要开头很少的字节，调用方按 Range 取一小段即可，不必下载整份文件。
 */
export function sniffFileSignature(head: Uint8Array): FileSignature | null {
  if (head.length === 0) return null;

  // 图片
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { kind: "image", format: "jpeg" };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: "image", format: "png" };
  }
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") {
    return { kind: "image", format: "gif" };
  }
  if (ascii(head, 0, 2) === "BM") return { kind: "image", format: "bmp" };
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { kind: "image", format: "tiff" };
  }

  // 视频 / 音频容器
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: "video", format: "matroska" };
  if (ascii(head, 0, 4) === "OggS") return { kind: "audio", format: "ogg" };
  if (ascii(head, 0, 4) === "fLaC") return { kind: "audio", format: "flac" };
  if (ascii(head, 0, 3) === "ID3") return { kind: "audio", format: "mp3" };
  // MPEG 音频帧同步：11 个 1 位。0xFF 0xD8 的 JPEG 已经在上面认掉了，不会撞。
  if (head.length >= 2 && head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) {
    return { kind: "audio", format: "mp3" };
  }

  return sniffRiffContainer(head) ?? sniffIsoContainer(head);
}

/** 取够认出所有已知容器的字节数。ISO 的 brand 落在第 8–12 字节，取 32 绰绰有余。 */
export const FILE_SIGNATURE_HEAD_BYTES = 32;
