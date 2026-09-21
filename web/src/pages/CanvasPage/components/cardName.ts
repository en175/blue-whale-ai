/* ============================================
 * 卡片名称（IKFA8X）：图片/视频/音频/文本卡片双击改名共用规则。
 * 名称是节点级显示信息（媒体节点 data.fileName / 文本节点 data.title），
 * 用户自定义状态由显式 data.customName 标记，不靠名称内容推断。
 * 下载文件名（IKFA8Y）：以当前卡片名称为基础，扩展名取自真实文件类型。
 * ============================================ */

/** 卡片名称最大字符数（按 JS 字符串长度计；父规格 A08：100 可保存，101 拒绝） */
export const CARD_NAME_MAX_LENGTH = 100;

/** 完整 MIME → 该类型的等价扩展名集合（首项为规范写法，用于下载命名） */
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

/** 取路径末段「看起来是文件扩展名」的一段（2–5 位字母数字，如 .png / .m4a）；无则空串 */
function extensionOfPath(path: string): string {
  const match = /\.([A-Za-z0-9]{2,5})$/.exec(path.trim());
  return match ? match[1]!.toLowerCase() : '';
}

function extensionFromUrl(src?: string): string {
  let path = (src ?? '').split(/[?#]/)[0]!;
  try {
    path = new URL(path).pathname;
  } catch {
    // 相对地址（blob: 等）按原串处理
  }
  return extensionOfPath(path);
}

/**
 * 下载用 MIME。M4A 与 MP4 同属 ISO 容器，CDN/浏览器常把 Content-Type 标成
 * audio/mpeg 或 video/mp4：对象 key / 卡片名的 .m4a、音频卡上的 ISO 容器，都认成 audio/mp4。
 */
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

/** 真实文件类型对应的扩展名：一般优先 MIME，其次素材地址路径。
 *  例外：路径已是 .m4a 时以路径为准（MIME 常被错标成 audio/mpeg / video/mp4）。 */
export function mediaExtensionOf(mime?: string, src?: string): string {
  const pathExt = extensionFromUrl(src);
  if (pathExt === 'm4a') return 'm4a';
  const mediaType = (mime ?? '').split(';')[0]!.trim().toLowerCase();
  const fromMime = MIME_EXTENSIONS[mediaType];
  if (fromMime) return fromMime[0]!;
  return pathExt;
}

/** 名称与实际扩展名须同属一种媒体类型（例如 jpg/jpeg、mpeg/mpg）。 */
function isSameFileType(nameExt: string, realExt: string): boolean {
  return nameExt === realExt || Object.values(MIME_EXTENSIONS).some(
    (extensions) => extensions.includes(nameExt) && extensions.includes(realExt),
  );
}

/**
 * 下载文件名（IKFA8Y）：以卡片名称为基础，扩展名取真实文件类型。
 * 名称已带同一扩展名（.jpg 与 .jpeg 互认）时不重复追加；带的是别的扩展名时按真实类型替换，
 * 避免出现「海边日落.mp4.png」这类名实不符的名字；类型未知时原样使用卡片名称。
 * 名称以点开头或全是点（如「.」「..png」）时退化为按卡片名主干拼一次扩展名，不产出多重点号。
 */
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
  /** 有效新名称：保存去首尾空格后的值 */
  | { kind: 'save'; value: string }
  /** 空白或全空格提交：恢复编辑前名称，不保存 */
  | { kind: 'restore' }
  /** 内容与当前名称一致：直接退出编辑，不触发保存、不置自定义标记 */
  | { kind: 'noop' }
  /** 超长：保留编辑内容继续修改，不保存、不截断 */
  | { kind: 'invalid'; message: string };

/** 提交归一化：去首尾空格 → 空回退 → 超长拒绝 → 未变更跳过 → 保存 */
export function commitCardName(raw: string, current: string): CardNameCommit {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'restore' };
  if (trimmed.length > CARD_NAME_MAX_LENGTH) {
    return { kind: 'invalid', message: `名称最多 ${CARD_NAME_MAX_LENGTH} 个字符，当前内容未保存` };
  }
  if (trimmed === current) return { kind: 'noop' };
  return { kind: 'save', value: trimmed };
}
