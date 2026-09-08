import {
  previewSourceSchema,
  PROMPT_TEXT_LIMITS as limits,
  type LegacyMigrationFailure,
  type PromptPreviewSource,
} from "@blue-whale/contracts";
import type { LegacyCardHistoryDraft, LegacyCardHistoryRow } from "@lib/shared/persistence/index.js";
import { sourceKey } from "./prompt-preview.js";

/** 画布 JSON 中的节点最小形状（IKDLQK 迁移只关心这些字段）。 */
export interface CanvasNodeLike {
  id: string;
  type: string;
  position?: unknown;
  data?: Record<string, unknown>;
}

/** 一次迁移的转换计划：nodes 为转换后的完整节点数组；historyDrafts 与画布在同一事务中落库。 */
export interface LegacyMigrationPlan {
  nodes: CanvasNodeLike[];
  migrated: string[];
  failed: LegacyMigrationFailure[];
  historyDrafts: LegacyCardHistoryDraft[];
}

/** 旧生成卡识别谓词：assetNode 且 data.kind === "generation"（正文块 data.generationCard）。 */
export function isLegacyGenerationCard(node: CanvasNodeLike): boolean {
  return node.type === "assetNode" && node.data?.kind === "generation";
}

/** 归一化旧卡正文块：单次提取/校验标题、提示词与来源；失败时给出面向用户的原因。 */
function inspectCard(card: unknown):
  | { ok: true; title: string; text: string; source: PromptPreviewSource | null; block: Record<string, unknown> }
  | { ok: false; title: string; reason: string } {
  const block = (card && typeof card === "object" && !Array.isArray(card) ? card : null) as Record<string, unknown> | null;
  const title = typeof block?.shotTitle === "string" ? block.shotTitle : "";
  const prompt = block?.prompt;
  if (typeof prompt !== "string") return { ok: false, title, reason: "提示词缺失或已损坏" };
  if (prompt.length > limits.text) return { ok: false, title, reason: "提示词超过存储限长" };
  if (title.length > limits.title) return { ok: false, title, reason: "标题超过存储限长" };
  const source = previewSourceSchema.safeParse(block?.source);
  return { ok: true, title, text: prompt, source: source.success ? source.data : null, block: block! };
}

/**
 * 计算旧生成卡迁移计划（纯函数）。
 * - 无旧卡返回 null（调用方不写画布）；
 * - 已有历史的旧卡内容一致时完成转换（失败恢复不丢历史、不重复落库）；
 * - 损坏/超限卡片保留原样并给出面向用户的原因，不用画面描述代替缺失提示词；
 * - promptSource 只对合法且画布内唯一的来源携带，先扫描到者优先。
 */
export function planLegacyCardMigration(
  nodes: CanvasNodeLike[],
  history: LegacyCardHistoryRow[],
): LegacyMigrationPlan | null {
  if (!nodes.some(isLegacyGenerationCard)) return null;

  const historyByNode = new Map(history.map((row) => [row.node_id, row]));
  const usedSources = new Set<string>();
  for (const node of nodes) {
    if (isLegacyGenerationCard(node)) continue;
    const key = sourceKey(node.data?.promptSource);
    if (key) usedSources.add(key);
  }

  const migrated: string[] = [];
  const failed: LegacyMigrationFailure[] = [];
  const historyDrafts: LegacyCardHistoryDraft[] = [];
  const replacements = new Map<string, CanvasNodeLike>();

  const claimSource = (source: PromptPreviewSource | null): PromptPreviewSource | undefined => {
    if (!source) return undefined;
    const key = sourceKey(source);
    if (!key || usedSources.has(key)) return undefined;
    usedSources.add(key);
    return source;
  };

  for (const node of nodes) {
    if (!isLegacyGenerationCard(node)) continue;
    const existing = historyByNode.get(node.id);
    if (existing) {
      const current = inspectCard(node.data?.generationCard);
      const visual = current.ok && typeof current.block.visual === "string" ? current.block.visual : null;
      if (!current.ok || current.title !== existing.title || current.text !== existing.prompt_text || visual !== existing.visual_text) {
        failed.push({ nodeId: node.id, title: current.ok ? current.title : "", reason: "旧卡与迁移历史冲突，双方资料已保留" });
        continue;
      }
      const source = previewSourceSchema.safeParse(existing.source_json ?? null);
      const promptSource = claimSource(source.success ? source.data : null);
      replacements.set(node.id, {
        id: node.id,
        type: "textNode",
        position: node.position,
        data: { title: existing.title, text: existing.prompt_text, ...(promptSource ? { promptSource } : {}) },
      });
      migrated.push(node.id);
      continue;
    }
    const card = inspectCard(node.data?.generationCard);
    if (!card.ok) {
      failed.push({ nodeId: node.id, title: card.title, reason: card.reason });
      continue;
    }
    const promptSource = claimSource(card.source);
    historyDrafts.push({
      nodeId: node.id,
      title: card.title,
      promptText: card.text,
      visualText: typeof card.block.visual === "string" ? card.block.visual : null,
      source: card.source,
      cardJson: card.block,
    });
    replacements.set(node.id, {
      id: node.id,
      type: "textNode",
      position: node.position,
      data: { title: card.title, text: card.text, ...(promptSource ? { promptSource } : {}) },
    });
    migrated.push(node.id);
  }

  return {
    nodes: nodes.map((node) => replacements.get(node.id) ?? node),
    migrated,
    failed,
    historyDrafts,
  };
}
