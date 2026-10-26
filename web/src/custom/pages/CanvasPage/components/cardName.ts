
export const CARD_NAME_MAX_LENGTH = 100;

const MIME_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'image/avif': ['avif'],
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
  'video/quicktime': ['mov'],
  'audio/mpeg': ['mp3'],
  'video/mpeg': ['mpeg', 'mpg'],
  'audio/mp3': ['mp3'],
  'audio/mp4': ['m4a'],
  'audio/x-m4a': ['m4a'],
  'audio/m4a': ['m4a'],
  'audio/wav': ['wav'],
  'audio/x-wav': ['wav'],
  'audio/aac': ['aac'],
  'audio/ogg': ['ogg'],
  'audio/flac': ['flac'],
  'audio/x-flac': ['flac'],
};

function extensionOfPath(path: string): string {
  const match = /\.([A-Za-z0-9]{2,5})$/.exec(path.trim());
  return match ? match[1]!.toLowerCase() : '';
}

function extensionFromUrl(src?: string): string {
  let path = (src ?? '').split(/[?#]/)[0]!;
  try {
    path = new URL(path).pathname;
  } catch {
  }
  return extensionOfPath(path);
}

export function resolveDownloadMime(input: {
  sniffed?: string;
  blobType?: string;
  nodeMime?: string;
  src?: string;
  fileName?: string;
  mediaType?: string;
}): string | undefined {
  if (extensionFromUrl(input.src) === 'm4a' || extensionOfPath(input.fileName ?? '') === 'm4a') {
    return 'audio/mp4';
  }
  const mime = (input.sniffed || input.blobType || input.nodeMime || '').split(';')[0]!.trim();
  if (input.mediaType === 'audio' && mime.toLowerCase() === 'video/mp4') return 'audio/mp4';
  return mime || undefined;
}

export function mediaExtensionOf(mime?: string, src?: string): string {
  const pathExt = extensionFromUrl(src);
  if (pathExt === 'm4a') return 'm4a';
  const mediaType = (mime ?? '').split(';')[0]!.trim().toLowerCase();
  const fromMime = MIME_EXTENSIONS[mediaType];
  if (fromMime) return fromMime[0]!;
  return pathExt;
}

function isSameFileType(nameExt: string, realExt: string): boolean {
  return nameExt === realExt || Object.values(MIME_EXTENSIONS).some(
    (extensions) => extensions.includes(nameExt) && extensions.includes(realExt),
  );
}

export function downloadFileNameOf(name: string, mime?: string, src?: string): string {
  const trimmed = name.trim() || '下载';
  const ext = mediaExtensionOf(mime, src);
  if (!ext) return trimmed;
  const suffix = extensionOfPath(trimmed);
  const current = suffix === ext || suffix === 'txt' || Object.values(MIME_EXTENSIONS).some((extensions) => extensions.includes(suffix))
    ? suffix : '';
  const stem = (current ? trimmed.slice(0, -(current.length + 1)) : trimmed).replace(/^\.+/, '');
  if (!stem) return `下载.${ext}`;
  if (current && isSameFileType(current, ext)) return trimmed;
  return `${stem}.${ext}`;
}

export type CardNameCommit =
  | { kind: 'save'; value: string }
  | { kind: 'restore' }
  | { kind: 'noop' }
  | { kind: 'invalid'; message: string };

export function commitCardName(raw: string, current: string): CardNameCommit {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'restore' };
  if (trimmed.length > CARD_NAME_MAX_LENGTH) {
    return { kind: 'invalid', message: `名称最多 ${CARD_NAME_MAX_LENGTH} 个字符，当前内容未保存` };
  }
  if (trimmed === current) return { kind: 'noop' };
  return { kind: 'save', value: trimmed };
}
