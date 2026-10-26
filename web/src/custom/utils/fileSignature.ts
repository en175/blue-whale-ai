

export class FileRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileRejectedError';
  }
}

export function isFileRejected(error: unknown): error is FileRejectedError {
  return error instanceof Error && error.name === 'FileRejectedError';
}

export type MediaKind = 'image' | 'video' | 'audio';

export interface FileSignature {
  kind: MediaKind;
  format: string;
}

const startsWith = (head: Uint8Array, bytes: readonly number[]): boolean =>
  head.length >= bytes.length && bytes.every((byte, index) => head[index] === byte);

const ascii = (head: Uint8Array, offset: number, length: number): string =>
  head.length >= offset + length
    ? String.fromCharCode(...head.subarray(offset, offset + length))
    : '';

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

  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', format: 'matroska' };
  if (ascii(head, 0, 4) === 'OggS') return { kind: 'audio', format: 'ogg' };
  if (ascii(head, 0, 4) === 'fLaC') return { kind: 'audio', format: 'flac' };
  if (ascii(head, 0, 3) === 'ID3') return { kind: 'audio', format: 'mp3' };
  if (head.length >= 2 && head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) {
    return { kind: 'audio', format: 'mp3' };
  }

  return sniffRiffContainer(head) ?? sniffIsoContainer(head);
}

export const FILE_SIGNATURE_HEAD_BYTES = 32;

const KIND_LABELS: Record<MediaKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
};

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
  if (declared !== 'character' && signature.kind !== declared) {
    return `${file.name} 实际是${KIND_LABELS[signature.kind]}，和你选择的类型不一致。请重新选择。`;
  }
  return null;
}
