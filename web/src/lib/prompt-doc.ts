
export const PROMPT_DOC_VERSION = 1 as const;

export interface PromptDocTextSegment {
  kind: 'text';
  text: string;
}

export interface PromptDocAssetRefSegment {
  kind: 'asset_ref';
  asset_id: string;
  label?: string;
  invalid_label?: string;
}

export interface PromptDocTextRefSegment {
  kind: 'text_ref';
  node_id: string;
  label?: string;
  invalid_label?: string;
}

export type PromptDocRefSegment = PromptDocAssetRefSegment | PromptDocTextRefSegment;

export type PromptDocSegment = PromptDocTextSegment | PromptDocRefSegment;

export interface PromptDoc {
  version: typeof PROMPT_DOC_VERSION;
  segments: PromptDocSegment[];
}

export interface StoredPromptDoc extends PromptDoc {
  flat: string;
}

export interface PromptRefKey {
  kind: 'asset_ref' | 'text_ref';
  id: string;
}

export function refKeyOf(segment: PromptDocRefSegment): PromptRefKey {
  return segment.kind === 'text_ref'
    ? { kind: 'text_ref', id: segment.node_id }
    : { kind: 'asset_ref', id: segment.asset_id };
}

export function imageRefNumberOf(assetId: string, orderedAssetIds: readonly string[]): number | null {
  const index = orderedAssetIds.indexOf(assetId);
  return index < 0 ? null : index + 1;
}

export function imageRefLabelOf(assetId: string, orderedAssetIds: readonly string[]): string | null {
  const n = imageRefNumberOf(assetId, orderedAssetIds);
  return n === null ? null : `图片${n}`;
}

export function textRefLabelOf(nodeId: string, orderedTextNodeIds: readonly string[]): string | null {
  const index = orderedTextNodeIds.indexOf(nodeId);
  return index < 0 ? null : `文本${index + 1}`;
}

const ASSET_ID_PATTERN = /^([1-9][0-9]*|asset-.{1,128})$/i;
const NODE_ID_MAX = 128;

function isAssetRefSegment(v: unknown): v is PromptDocAssetRefSegment {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  if (s.kind !== 'asset_ref' || typeof s.asset_id !== 'string' || !ASSET_ID_PATTERN.test(s.asset_id)) return false;
  if (s.label !== undefined && typeof s.label !== 'string') return false;
  if (s.invalid_label !== undefined && typeof s.invalid_label !== 'string') return false;
  return true;
}

function isTextRefSegment(v: unknown): v is PromptDocTextRefSegment {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  if (s.kind !== 'text_ref' || typeof s.node_id !== 'string' || s.node_id.length === 0 || s.node_id.length > NODE_ID_MAX) return false;
  if (s.label !== undefined && typeof s.label !== 'string') return false;
  if (s.invalid_label !== undefined && typeof s.invalid_label !== 'string') return false;
  return true;
}

function refExtras(raw: { label?: unknown; invalid_label?: unknown }): { label?: string; invalid_label?: string } {
  const extras: { label?: string; invalid_label?: string } = {};
  if (typeof raw.label === 'string') extras.label = raw.label;
  if (typeof raw.invalid_label === 'string') extras.invalid_label = raw.invalid_label;
  return extras;
}

export function restorePromptDoc(stored: unknown, promptMirror: unknown): PromptDoc | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const doc = stored as Record<string, unknown>;
  if (doc.version !== PROMPT_DOC_VERSION) return null;
  if (!Array.isArray(doc.segments)) return null;
  if (typeof doc.flat !== 'string' || doc.flat !== promptMirror) return null;
  const segments: PromptDocSegment[] = [];
  for (const raw of doc.segments as unknown[]) {
    if (typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).kind === 'text') {
      const text = (raw as Record<string, unknown>).text;
      if (typeof text !== 'string') return null;
      segments.push({ kind: 'text', text });
      continue;
    }
    if (isAssetRefSegment(raw)) {
      segments.push({ kind: 'asset_ref', asset_id: raw.asset_id, ...refExtras(raw) });
      continue;
    }
    if (isTextRefSegment(raw)) {
      segments.push({ kind: 'text_ref', node_id: raw.node_id, ...refExtras(raw) });
      continue;
    }
    return null;
  }
  return { version: PROMPT_DOC_VERSION, segments };
}

export function reconcilePromptDoc(
  doc: PromptDoc,
  orderedAssetIds: readonly string[],
): { doc: PromptDoc; changed: boolean } {
  return reconcilePromptDocWith(doc, (key) =>
    key.kind === 'text_ref' ? null : imageRefLabelOf(key.id, orderedAssetIds));
}

export function reconcilePromptDocWith(
  doc: PromptDoc,
  labelOf: (key: PromptRefKey) => string | null,
): { doc: PromptDoc; changed: boolean } {
  let changed = false;
  const segments = doc.segments.map((segment) => {
    if (segment.kind === 'text') return segment;
    const label = labelOf(refKeyOf(segment));
    if (label !== null) {
      if (segment.invalid_label === undefined) {
        if (segment.label === label) return segment;
        changed = true;
        return { ...segment, label };
      }
      changed = true;
      const restored = { ...segment, label };
      delete restored.invalid_label;
      return restored;
    }
    if (segment.invalid_label !== undefined) return segment;
    changed = true;
    const invalid = segment.label ?? '素材?';
    return { ...segment, label: invalid, invalid_label: invalid };
  });
  return changed ? { doc: { version: doc.version, segments }, changed } : { doc, changed };
}

export function flattenPromptDocWith(
  doc: PromptDoc,
  labelOf: (key: PromptRefKey) => string | null,
): string {
  return doc.segments
    .map((segment) => {
      if (segment.kind === 'text') return segment.text;
      if (segment.invalid_label !== undefined) return `已失效：原${segment.invalid_label}`;
      return labelOf(refKeyOf(segment)) ?? segment.label ?? '素材?';
    })
    .join('');
}

export function flattenPromptDocForSend(doc: PromptDoc): string {
  return doc.segments
    .map((segment) => {
      if (segment.kind === 'text') return segment.text;
      if (segment.invalid_label !== undefined) return `已失效：原${segment.invalid_label}`;
      if (segment.kind === 'asset_ref') {
        const label = segment.label ?? '';
        if (label.startsWith('视频') || label.startsWith('音频')) return label || `&${segment.asset_id}&`;
        return `&${segment.asset_id}&`;
      }
      return segment.label ?? '';
    })
    .join('');
}

const IMAGE_SEND_TOKEN_RE = /&[1-9][0-9]*&/g;

export function isOnlyImageSendTokens(text: string): boolean {
  return text.trim().replace(IMAGE_SEND_TOKEN_RE, '').trim() === '';
}

export function promptCoveredByAttachmentParts(input: string, parts: readonly string[]): boolean {
  const trimmed = input.trim();
  if (!trimmed) return true;
  if (parts.some((part) => part === trimmed)) return true;
  if (!isOnlyImageSendTokens(trimmed)) return false;
  const tokens = trimmed.match(IMAGE_SEND_TOKEN_RE) ?? [];
  return tokens.length > 0 && tokens.every((token) => parts.some((part) => part.includes(token)));
}

export function docHasAnyRef(doc: PromptDoc): boolean {
  return doc.segments.some((s) => s.kind !== 'text');
}

export function docHasInvalidRef(doc: PromptDoc): boolean {
  return doc.segments.some((s) => s.kind !== 'text' && s.invalid_label !== undefined);
}

export function docHasTextRef(doc: PromptDoc): boolean {
  return doc.segments.some((s) => s.kind === 'text_ref');
}
