/* ============================================
 * prompt-doc 纯逻辑层（IKFA1M）：生图正文素材标签的结构与派生规则
 *
 * 与 packages/contracts/src/prompt-doc.ts 同语义（web 侧镜像；跨进程权威在契约包）。
 * 规则备忘：
 * - 稳定身份 = 本地 Asset id（媒体）/ 来源画布 textNode 节点 id（文本，IKFA1P）；
 *   展示编号（图片N/文本N）由身份在最终输入顺序中的位置派生，编号不是身份。
 * - 标签位置由片段顺序隐式表达，不使用字符区间。
 * - 失效标签保留原身份与原编号（invalid_label）；身份重新加入当前有效集合时自动恢复（IKFA1N）。
 * - 草稿防丢失：结构化 promptDoc 与拍平镜像 prompt 双写；镜像不一致说明旧客户端改过，丢弃结构不猜造。
 * ============================================ */

export const PROMPT_DOC_VERSION = 1 as const;

export interface PromptDocTextSegment {
  kind: 'text';
  text: string;
}

export interface PromptDocAssetRefSegment {
  kind: 'asset_ref';
  asset_id: string;
  /** 展示编号缓存（图片N）：失效时作为「原编号」引用；权威编号永远按当前输入派生 */
  label?: string;
  /** 失效恢复信息：失效前的展示编号；存在即失效标签 */
  invalid_label?: string;
}

export interface PromptDocTextRefSegment {
  kind: 'text_ref';
  /** 来源画布文本节点 id（IKFA1P）：与媒体身份空间不重叠 */
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

/** 草稿节点 data 持久形状：结构 + 拍平镜像（防丢失校验基准） */
export interface StoredPromptDoc extends PromptDoc {
  flat: string;
}

/** 标签统一寻址键：编号映射按身份类型分派（媒体 → asset_id / 文本 → node_id） */
export interface PromptRefKey {
  kind: 'asset_ref' | 'text_ref';
  id: string;
}

export function refKeyOf(segment: PromptDocRefSegment): PromptRefKey {
  return segment.kind === 'text_ref'
    ? { kind: 'text_ref', id: segment.node_id }
    : { kind: 'asset_ref', id: segment.asset_id };
}

/** 有效图片编号：assetId 在最终输入顺序（保序）中的下标+1；不在集合返回 null */
export function imageRefNumberOf(assetId: string, orderedAssetIds: readonly string[]): number | null {
  const index = orderedAssetIds.indexOf(assetId);
  return index < 0 ? null : index + 1;
}

export function imageRefLabelOf(assetId: string, orderedAssetIds: readonly string[]): string | null {
  const n = imageRefNumberOf(assetId, orderedAssetIds);
  return n === null ? null : `图片${n}`;
}

/** 有效文本编号（IKFA1P）：nodeId 在当前文本附件顺序中的下标+1；不在集合返回 null */
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

/**
 * 草稿恢复（防丢失）：结构存在且拍平镜像与 prompt 完全一致才恢复结构；
 * 旧客户端只读写 prompt——镜像不一致说明结构已过时，丢弃结构按纯文本恢复，不从旧文字猜造标签（E1）。
 */
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

/** 编号重派生与失效推导（生图，IKFA1M）：按图片输入顺序派生编号 */
export function reconcilePromptDoc(
  doc: PromptDoc,
  orderedAssetIds: readonly string[],
): { doc: PromptDoc; changed: boolean } {
  return reconcilePromptDocWith(doc, (key) =>
    key.kind === 'text_ref' ? null : imageRefLabelOf(key.id, orderedAssetIds));
}

/**
 * 泛化编号重派生与失效推导（IKFA1O 视频 / IKFA1P 文本）：labelOf 按寻址键返回
 * 身份的当前有效标签文案（首帧/尾帧/图片N/视频N/音频N/文本N），null = 失效——
 * 身份不在当前集合，或仍在集合但当前模式/角色不接受（C2 模式失效）。
 * 失效→有效→失效状态完全由 labelOf 当前值推导：labelOf 恢复非 null 即自动恢复
 * （模式切回兼容 / 同身份重新连入），仍为 null 则不误恢复（C5）。
 */
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

/** 泛化拍平镜像（IKFA1O/IKFA1P）：有效标签按 labelOf 文案，失效标签保留原编号 */
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

/** 提交 parameters.prompt：图片标签写成 &素材id&，视觉编号只留在编辑器 */
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

/** 正文是否只剩 &素材id&（可重复），没有其它提示词 */
export function isOnlyImageSendTokens(text: string): boolean {
  return text.trim().replace(IMAGE_SEND_TOKEN_RE, '').trim() === '';
}

/** 生成框这段已经出现在文本附件里时不再拼接，避免同一个 @ 写成两次 &id& */
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

/** 正文是否包含文本标签（IKFA1P）：发送门槛与菜单展示共用 */
export function docHasTextRef(doc: PromptDoc): boolean {
  return doc.segments.some((s) => s.kind === 'text_ref');
}
