/* ============================================
 * prompt-doc 纯逻辑层（IKFA1M）：生图正文素材标签的结构与派生规则
 *
 * 与 packages/contracts/src/prompt-doc.ts 同语义（web 侧镜像；跨进程权威在契约包）。
 * 规则备忘：
 * - 稳定身份 = 本地 Asset id；展示编号（图片N）由身份在最终输入顺序中的位置派生，编号不是身份。
 * - 标签位置由片段顺序隐式表达，不使用字符区间。
 * - 失效标签保留原身份与原编号（invalid_label）；身份重新加入当前有效集合时自动恢复（IKFA1N）。
 * - 草稿防丢失：结构化 promptDoc 与拍平镜像 prompt 双写；镜像不一致说明旧客户端改过，丢弃结构不猜造。
 * ============================================ */

export const PROMPT_DOC_VERSION = 1 as const;

export interface PromptDocTextSegment {
  kind: 'text';
  text: string;
}

export interface PromptDocRefSegment {
  kind: 'asset_ref';
  asset_id: string;
  /** 展示编号缓存（图片N）：失效时作为「原编号」引用；权威编号永远按当前输入派生 */
  label?: string;
  /** 失效恢复信息：失效前的展示编号；存在即失效标签 */
  invalid_label?: string;
}

export type PromptDocSegment = PromptDocTextSegment | PromptDocRefSegment;

export interface PromptDoc {
  version: typeof PROMPT_DOC_VERSION;
  segments: PromptDocSegment[];
}

/** 草稿节点 data 持久形状：结构 + 拍平镜像（防丢失校验基准） */
export interface StoredPromptDoc extends PromptDoc {
  flat: string;
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

/** 标签当前应展示的文案：失效 → 已失效：原图片N；有效 → 派生编号（缓存兜底） */
export function refSegmentDisplayLabel(
  segment: PromptDocRefSegment,
  orderedAssetIds: readonly string[],
): string {
  if (segment.invalid_label !== undefined) return `已失效：原${segment.invalid_label}`;
  return imageRefLabelOf(segment.asset_id, orderedAssetIds) ?? segment.label ?? '图片?';
}

/** 拍平镜像：文字原样；有效标签 → 图片N；失效标签 → 已失效：原图片N */
export function flattenPromptDoc(doc: PromptDoc, orderedAssetIds: readonly string[]): string {
  return doc.segments
    .map((segment) =>
      segment.kind === 'text' ? segment.text : refSegmentDisplayLabel(segment, orderedAssetIds),
    )
    .join('');
}

const ASSET_ID_PATTERN = /^[1-9][0-9]*$/;

function isRefSegment(v: unknown): v is PromptDocRefSegment {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  if (s.kind !== 'asset_ref' || typeof s.asset_id !== 'string' || !ASSET_ID_PATTERN.test(s.asset_id)) return false;
  if (s.label !== undefined && typeof s.label !== 'string') return false;
  if (s.invalid_label !== undefined && typeof s.invalid_label !== 'string') return false;
  return true;
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
    if (isRefSegment(raw)) {
      const seg: PromptDocRefSegment = { kind: 'asset_ref', asset_id: raw.asset_id };
      if (raw.label !== undefined) seg.label = raw.label;
      if (raw.invalid_label !== undefined) seg.invalid_label = raw.invalid_label;
      segments.push(seg);
      continue;
    }
    return null;
  }
  return { version: PROMPT_DOC_VERSION, segments };
}

/**
 * 编号重派生与失效推导：给定当前有效输入顺序，按身份对当前集合求值——
 * - 有效标签：同步展示编号缓存 label = 图片N；
 * - 身份已不在集合：转失效，invalid_label = 失效前展示编号（label 缓存），保留原身份不转向；
 * - 失效标签身份回到集合（重新加入同一身份，IKFA1N）：自动恢复，清除失效标记并派生当次编号；
 * - 失效标签身份仍不在集合：原样保留（原身份与原编号冻结，名称不参与判定）。
 */
export function reconcilePromptDoc(
  doc: PromptDoc,
  orderedAssetIds: readonly string[],
): { doc: PromptDoc; changed: boolean } {
  let changed = false;
  const segments = doc.segments.map((segment) => {
    if (segment.kind !== 'asset_ref') return segment;
    const label = imageRefLabelOf(segment.asset_id, orderedAssetIds);
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
    const invalid = segment.label ?? '图片?';
    return { ...segment, label: invalid, invalid_label: invalid };
  });
  return changed ? { doc: { version: doc.version, segments }, changed } : { doc, changed };
}

export function docHasAnyRef(doc: PromptDoc): boolean {
  return doc.segments.some((s) => s.kind === 'asset_ref');
}

export function docHasInvalidRef(doc: PromptDoc): boolean {
  return doc.segments.some((s) => s.kind === 'asset_ref' && s.invalid_label !== undefined);
}
