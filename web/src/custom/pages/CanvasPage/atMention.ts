import type { ComposedValue } from './components/ChipTextEditor/composed';
import type { AudioRefItem } from './components/AudioDialog';
import { type AtMentionKind } from '@/custom/enums';

export interface AtMentionItem {
  id: string;
  kind: AtMentionKind;
  name: string;
  thumbUrl?: string;
  assetId?: string;
  disabled?: boolean;
  searchText?: string;
}

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

export function trailingAtQueryFromComposed(value: ComposedValue): string | null {
  let tail = '';
  for (let i = value.segments.length - 1; i >= 0; i -= 1) {
    const seg = value.segments[i];
    if (seg.kind !== 'text') break;
    tail = seg.value + tail;
  }
  return trailingAtQuery(tail);
}

export function stripTrailingAtQuery(text: string): string {
  return text.replace(AT_QUERY_RE, '');
}

export function filterAtMentionItems(items: AtMentionItem[], query: string): AtMentionItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.name.toLowerCase().includes(q)
    || (item.searchText?.toLowerCase().includes(q) ?? false));
}
