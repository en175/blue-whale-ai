/* ============================================
 * 编辑器内容的结构化表示（IKAFSX）
 *
 * 从前编辑器的出口是一个 `string`，而胶囊在拼接时被替换成了它背后的**完整 prompt**。
 * 一连串后果由此而来：字数统计数的是展开后的全文（引一张长卡直接吃光额度）、于是触发截断、
 * 而截断走的是「用纯文本整体替换编辑器内容」——**所有胶囊当场湮灭，正文被从中间腰斩**。
 *
 * 这里把出口换成片段序列。胶囊在**编辑期**始终是一个指针，只在**提交那一刻**才解引用。
 * dock 里那段文字最终要喂给出片模型，模型不会跟着指针走，所以展开是必然的——问题从来只是
 * 「在哪一步展开」。这就是 Notion 块引用、飞书 @、MCP resource 引用的通用形状。
 * ============================================ */

/** 一条引用：编辑期只显示 label，提交时才换成 prompt。 */
export interface ComposedRef {
  id: string;
  label: string;
  /** 解引用后真正送出去的全文 */
  prompt: string;
}

export type ComposedSegment =
  | { kind: 'text'; value: string }
  | { kind: 'ref'; ref: ComposedRef };

export interface ComposedValue {
  segments: ComposedSegment[];
}

export const EMPTY_COMPOSED: ComposedValue = { segments: [] };

/**
 * 计数口径：文字按字符数，**一个胶囊算 1 个单位**（已确认）。
 *
 * 胶囊背后那几千字不计入——限制的本意是「别让用户手打太多字」，而引用是一次点击，
 * 按全文惩罚它等于劝用户别用引用。算 1 而不是 0，是因为用户看得见它占了个位置。
 */
export function composedLength(value: ComposedValue): number {
  return value.segments.reduce(
    (total, segment) => total + (segment.kind === 'text' ? segment.value.length : 1),
    0,
  );
}

/** 有没有可发送的内容：纯空白不算，但只有一个胶囊算。 */
export function composedIsEmpty(value: ComposedValue): boolean {
  return !value.segments.some((segment) => (segment.kind === 'ref' ? true : segment.value.trim().length > 0));
}

/**
 * 解引用：把每个胶囊换成它的完整 prompt，得到真正要送出去的文本。
 *
 * **只在提交那一刻调用。** 编辑期调用它就等于回到了旧行为。
 */
export function resolveComposed(value: ComposedValue): string {
  return value.segments
    .map((segment) => (segment.kind === 'text' ? segment.value : segment.ref.prompt))
    .join('');
}

