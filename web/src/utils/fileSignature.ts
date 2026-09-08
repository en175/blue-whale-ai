/* ============================================
 * 文件开头那几个字节说这是什么（IKE53Z）
 * ============================================ */

/**
 * **这不是格式白名单。** 支不支持某种编码是后端的策略；这里只回答一个事实问题——这份字节是不是
 * 一份媒体文件。所以判据是「认不出任何已知容器才拦」，而不是「不在名单里就拦」：heic
 * （iPhone 拍照默认）、bmp、tiff 都认得出、后端也转得动，把它们挡在门外是错的。
 *
 * 为什么放在选中文件的当下：三道校验各管一件事——这一道管**体验**，用户拖进来就知道要换一份；
 * 上传口那道管**正确性**，绕过页面直接调 API 也进不来；Agent 的探测管**兜底**，文件在对象存储
 * 侧后来坏掉时仍然读得出来。谁也替不掉谁。测试站 2026-09-08 那份 524 字节的假 JPEG 三道都没有，
 * 于是它一路走到 Agent 读图才被发现。
 *
 * 与后端 `backend/libs/shared/assets/file-signature.ts` 是同一张表的两份实现。故意不共享：前端
 * 不引后端的包，而这张表本身是稳定的公开知识（各容器的 magic bytes），两份各自带测试比拉一条
 * 依赖更便宜。改其中一份时记得看另一份。
 */

export type MediaKind = 'image' | 'video' | 'audio';

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
    : '';

/** ISO 基础媒体容器的图片 brand。同一个 `ftyp` 盒子既装 MP4 也装 HEIC 和 AVIF，只有 brand 分得开。 */
const ISO_IMAGE_BRANDS = [
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'mif1',
  'msf1',
  'avif',
  'avis',
];

function sniffIsoContainer(head: Uint8Array): FileSignature | null {
  if (ascii(head, 4, 4) !== 'ftyp') return null;
  const brand = ascii(head, 8, 4).toLowerCase().trim();
  if (ISO_IMAGE_BRANDS.includes(brand)) return { kind: 'image', format: brand };
  if (brand === 'm4a' || brand === 'm4b') return { kind: 'audio', format: 'm4a' };
  // 其余 brand（isom / mp41 / mp42 / avc1 / qt / M4V …）都是视频容器。认不出的 brand 也归这里：
  // ftyp 盒子本身已经证明它是一份 ISO 媒体文件，而这一层判的正是「是不是媒体」。
  return { kind: 'video', format: brand || 'mp4' };
}

function sniffRiffContainer(head: Uint8Array): FileSignature | null {
  if (ascii(head, 0, 4) !== 'RIFF') return null;
  const form = ascii(head, 8, 4).toUpperCase();
  if (form === 'WEBP') return { kind: 'image', format: 'webp' };
  if (form === 'AVI ') return { kind: 'video', format: 'avi' };
  if (form === 'WAVE') return { kind: 'audio', format: 'wav' };
  return null;
}

/** 认这份字节。认不出返回 `null`——那才是「这不是一份媒体文件」。 */
export function sniffFileSignature(head: Uint8Array): FileSignature | null {
  if (head.length === 0) return null;

  if (startsWith(head, [0xff, 0xd8, 0xff])) return { kind: 'image', format: 'jpeg' };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', format: 'png' };
  }
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') {
    return { kind: 'image', format: 'gif' };
  }
  if (ascii(head, 0, 2) === 'BM') return { kind: 'image', format: 'bmp' };
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { kind: 'image', format: 'tiff' };
  }
  // SVG 是文本，没有 magic bytes。它已经在上传口被按 mime 挡掉（TOS 处理它会挂死），这里不重复。

  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', format: 'matroska' };
  if (ascii(head, 0, 4) === 'OggS') return { kind: 'audio', format: 'ogg' };
  if (ascii(head, 0, 4) === 'fLaC') return { kind: 'audio', format: 'flac' };
  if (ascii(head, 0, 3) === 'ID3') return { kind: 'audio', format: 'mp3' };
  // MPEG 音频帧同步：11 个 1 位。JPEG 的 FF D8 已在上面认掉，不会撞。
  if (head.length >= 2 && head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) {
    return { kind: 'audio', format: 'mp3' };
  }

  return sniffRiffContainer(head) ?? sniffIsoContainer(head);
}

/** 取够认出所有已知容器的字节数。ISO 的 brand 落在第 8–12 字节，32 绰绰有余。 */
export const FILE_SIGNATURE_HEAD_BYTES = 32;

const KIND_LABELS: Record<MediaKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
};

/**
 * 选中的这份文件能不能上传。能就返回 `null`，不能就返回一句给用户看的话。
 *
 * 读文件本身失败时放行（返回 `null`）：这道门是为了挡住明显不是媒体的文件，不该因为一次读盘
 * 失败把正常上传拒掉——后面还有上传口和探测两道。
 */
export async function checkFileBeforeUpload(
  file: File,
  declared: MediaKind | 'character',
): Promise<string | null> {
  if (file.size === 0) return `${file.name} 是一个空文件，请重新选择。`;

  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, FILE_SIGNATURE_HEAD_BYTES).arrayBuffer());
  } catch {
    return null;
  }

  const signature = sniffFileSignature(head);
  if (!signature) {
    return `${file.name} 打不开，可能已损坏。请换一份 JPG、PNG、WebP 或 MP4 重新上传。`;
  }
  // `character` 是人像库那条线的资产类别，不是一种媒介——它的字节仍然是图片，所以只判「是不是
  // 媒体」，不判类别是否相符。
  if (declared !== 'character' && signature.kind !== declared) {
    return `${file.name} 实际是${KIND_LABELS[signature.kind]}，和你选择的类型不一致。请重新选择。`;
  }
  return null;
}
