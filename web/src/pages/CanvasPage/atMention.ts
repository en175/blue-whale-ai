import type { ComposedValue } from './components/ChipTextEditor/composed';

/** 画布 @ 引用可选素材类型 */
export type AtMentionKind = 'image' | 'video' | 'audio' | 'text';

/** 输入框 @ 菜单中的一条画布素材 */
export interface AtMentionItem {
  id: string;
  kind: AtMentionKind;
  name: string;
  /** 图片/视频缩略地址；音频与文本无缩略图 */
  thumbUrl?: string;
  /** 媒体节点资产 ID，写入参考时复用 */
  assetId?: string;
}

const AT_QUERY_RE = /@([^\s@]*)$/;

/** 光标前文本若处于 @ 提及中，返回 @ 后的检索词（可为空串）；否则 null */
export function trailingAtQuery(text: string): string | null {
  const at = text.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0) {
    const prev = text.charAt(at - 1);
    if (prev !== ' ' && prev !== '\n' && prev !== '\t') return null;
  }
  const rest = text.slice(at + 1);
  if (/\s/.test(rest)) return null;
  return rest;
}

/** 从结构化输入取末尾纯文本的 @ 检索词 */
export function trailingAtQueryFromComposed(value: ComposedValue): string | null {
  let tail = '';
  for (let i = value.segments.length - 1; i >= 0; i -= 1) {
    const seg = value.segments[i];
    if (seg.kind !== 'text') break;
    tail = seg.value + tail;
  }
  return trailingAtQuery(tail);
}

/** 选中素材后去掉输入末尾的 @检索词 */
export function stripTrailingAtQuery(text: string): string {
  return text.replace(AT_QUERY_RE, '');
}

/** 按名称模糊过滤（忽略大小写） */
export function filterAtMentionItems(items: AtMentionItem[], query: string): AtMentionItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.name.toLowerCase().includes(q));
}
