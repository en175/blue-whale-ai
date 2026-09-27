import type { ComposedValue } from './components/ChipTextEditor/composed';
import type { AudioRefItem } from './components/AudioDialog';

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
  /** 能力失效（如合规未通过）时置灰不可选 */
  disabled?: boolean;
  /** 文本节点正文全文（IKIQGR）：仅文本类候选携带，@ 检索按正文命中；媒体项不带、不按正文误命中 */
  searchText?: string;
}

/** 画布来源参考音频 → @ 菜单同形态素材项（IKFCKS：缩略图 @ 与手动 @ 选择走同一
 *  onMentionCanvas 入口，结果等价——素材进入参考区；本地 blob 上传项无画布身份不适用） */
export function audioRefToMentionItem(ref: AudioRefItem): AtMentionItem {
  return {
    id: ref.id,
    kind: 'audio',
    name: ref.name,
    thumbUrl: ref.src,
    ...(ref.assetId != null ? { assetId: String(ref.assetId) } : {}),
  };
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

/** 按名称或文本正文全文模糊过滤（忽略大小写；正文仅文本类候选携带，IKIQGR） */
export function filterAtMentionItems(items: AtMentionItem[], query: string): AtMentionItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.name.toLowerCase().includes(q)
    || (item.searchText?.toLowerCase().includes(q) ?? false));
}
