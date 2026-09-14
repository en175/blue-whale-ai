import {
  TEXT_INDEX_EDGE_MARKER,
  mediaMentionSchema,
  mediaRefSchema,
  type MediaMention,
  type MediaMentionType,
  type MediaRef,
} from "./text-node-media.js";

/* 文本索引下游同步契约 v1（IKFM3S）：docs/specs/2026-09-14-ikfm3s-text-index-sync-contract.md
   引用来源 = 直接参考 ∪ 文本带入参考（纯派生，不建自动连线、不存来源集合）；
   并入规则、发送校验与输入签名前后端同源，本文件是唯一实现。 */

/** 画布节点的宽松形态（JSON.parse 结果直读，未知节点字段忽略） */
export interface TextIndexCanvasNode {
  id?: unknown;
  type?: unknown;
  data?: Record<string, unknown>;
}

/** 文本带入参考项：身份解析后的展示与提交数据（name/url 取 mediaRefs 快照） */
export interface TextProvidedRef {
  /** 提供该素材的文本卡 id */
  textNodeId: string;
  /** 素材来源画布节点 id（索引契约身份的 nodeId） */
  sourceNodeId: string;
  assetId: string;
  mediaType: MediaMentionType;
  name: string;
  url: string;
}

/** 目标的单条文本输入（签名与冻结的最小单元） */
export interface TargetTextInputEntry {
  /** 文本卡 id */
  nodeId: string;
  /** 正文 Markdown 源（data.text） */
  text: string;
  /** 有效身份按正文首现序 */
  identities: Array<{ sourceNodeId: string; assetId: string; mediaType: MediaMentionType }>;
}

/** 目标文本索引派生结果：输入、带入参考与失效身份 */
export interface TargetTextIndex {
  /** 按文本入边边序 */
  inputs: TargetTextInputEntry[];
  /** 文本带入参考（文本边序 × 正文首现序展开，未跨来源去重——去重在合并函数做） */
  refs: TextProvidedRef[];
  /** 失效身份（任一存在即阻止发送；含素材不可及） */
  invalid: Array<{ textNodeId: string; sourceNodeId: string; name: string }>;
}

function readMediaIndex(data: Record<string, unknown> | undefined): {
  mentions: MediaMention[];
  refs: MediaRef[];
} {
  const mentions: MediaMention[] = [];
  for (const raw of Array.isArray(data?.mediaMentions) ? data.mediaMentions : []) {
    const parsed = mediaMentionSchema.safeParse(raw);
    if (parsed.success) mentions.push(parsed.data);
  }
  const refs: MediaRef[] = [];
  for (const raw of Array.isArray(data?.mediaRefs) ? data.mediaRefs : []) {
    const parsed = mediaRefSchema.safeParse(raw);
    if (parsed.success) refs.push(parsed.data);
  }
  return { mentions, refs };
}

/** 按目标推导文本索引（契约 §1）：文本入边逐卡解析 mediaMentions/mediaRefs；
 *  身份有效 ⟺ 来源节点在画布 + textIndex 关系线存在 + 素材可及（非 assetMissing）+ 快照 ref 存在。
 *  与索引契约 §3 的标签有效性同源，另把素材不可及一并归入失效（IKFM3S §3：失效即阻止发送）。 */
export function textIndexOfTarget(
  nodes: TextIndexCanvasNode[],
  edgesRaw: unknown,
  targetNodeId: string,
): TargetTextIndex {
  const nodeById = new Map(
    nodes.filter((node) => typeof node.id === "string").map((node) => [node.id as string, node]),
  );
  const edgeList = Array.isArray(edgesRaw) ? (edgesRaw as Array<Record<string, unknown>>) : [];
  const textIndexPairs = new Set<string>();
  for (const edge of edgeList) {
    const edgeData = (edge?.data ?? null) as Record<string, unknown> | null;
    if (!edge || edgeData?.[TEXT_INDEX_EDGE_MARKER] !== true) continue;
    if (typeof edge.source === "string" && typeof edge.target === "string") {
      textIndexPairs.add(`${edge.source} ${edge.target}`);
    }
  }
  const inputs: TargetTextInputEntry[] = [];
  const refs: TextProvidedRef[] = [];
  const invalid: TargetTextIndex["invalid"] = [];
  for (const edge of edgeList) {
    if (!edge || edge.target !== targetNodeId || typeof edge.source !== "string") continue;
    const textNode = nodeById.get(edge.source);
    if (!textNode || textNode.type !== "textNode") continue;
    const data = textNode.data ?? {};
    const { mentions, refs: mediaRefs } = readMediaIndex(data);
    const refByNode = new Map(mediaRefs.map((ref) => [ref.nodeId, ref]));
    const entry: TargetTextInputEntry = {
      nodeId: edge.source,
      text: typeof data.text === "string" ? data.text : "",
      identities: [],
    };
    const seenIdentities = new Set<string>();
    for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
      if (seenIdentities.has(mention.nodeId)) continue;
      seenIdentities.add(mention.nodeId);
      const sourceNode = nodeById.get(mention.nodeId);
      const ref = refByNode.get(mention.nodeId);
      const linked =
        sourceNode !== undefined && textIndexPairs.has(`${mention.nodeId} ${edge.source}`);
      const assetMissing = (sourceNode?.data ?? {}).assetMissing === true;
      if (!linked || assetMissing || !ref) {
        invalid.push({
          textNodeId: edge.source,
          sourceNodeId: mention.nodeId,
          name: ref?.name ?? "未知素材",
        });
        continue;
      }
      entry.identities.push({
        sourceNodeId: mention.nodeId,
        assetId: mention.assetId,
        mediaType: ref.mediaType,
      });
      refs.push({
        textNodeId: edge.source,
        sourceNodeId: mention.nodeId,
        assetId: mention.assetId,
        mediaType: ref.mediaType,
        name: ref.name,
        url: ref.url,
      });
    }
    inputs.push(entry);
  }
  return { inputs, refs, invalid };
}

/** 参考并入（契约 §2，前后端同源）：直接参考序在前，文本带入按派生序追加；
 *  同 assetId 去重保首见。返回合并最终序与本次追加项（后端差集追加、前端同源预演共用）。 */
export function mergeTextProvidedReferences(
  directAssetIds: ReadonlyArray<string | number>,
  refs: ReadonlyArray<TextProvidedRef>,
): { merged: Array<string | number>; addedAssetIds: string[] } {
  const merged = [...directAssetIds];
  const seen = new Set(directAssetIds.map(String));
  const addedAssetIds: string[] = [];
  for (const ref of refs) {
    if (seen.has(ref.assetId)) continue;
    seen.add(ref.assetId);
    merged.push(ref.assetId);
    addedAssetIds.push(ref.assetId);
  }
  return { merged, addedAssetIds };
}

/** 图片目标接受的文本带入媒体类型（任务 3 固定图片；任务 4/5 扩展时不改本常量语义） */
export const IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES: readonly MediaMentionType[] = ["image"];

export const TEXT_INDEX_INVALID_MESSAGE = "文本索引存在失效素材，请修复来源文本后提交";
export const TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE = "文本索引包含目标不支持的媒体类型，请修改来源文本";
/** 容量超限文案（前后端共用同一模板，与既有 resolveReferenceAssets 口径一致） */
export const textIndexOverflowMessage = (max: number) => `参考图最多 ${max} 张`;

/** 发送前能力校验错误（契约 §3；判定顺序：失效 → 类型 → 超限） */
export type TextIndexSyncError =
  | { kind: "invalid_index" }
  | { kind: "unsupported_media_type"; mediaTypes: MediaMentionType[] }
  | { kind: "reference_overflow"; max: number };

/** 能力校验（契约 §3）：失效索引、不支持的媒体类型、容量超限均阻止发送，不静默丢素材。 */
export function checkTextIndexSyncInput(args: {
  index: Pick<TargetTextIndex, "refs" | "invalid">;
  acceptedMediaTypes: readonly MediaMentionType[];
  /** 合并去重后的参考总数 */
  mergedReferenceCount: number;
  maxReferences: number;
}): TextIndexSyncError | null {
  if (args.index.invalid.length > 0) return { kind: "invalid_index" };
  const unsupported = [
    ...new Set(
      args.index.refs
        .filter((ref) => !args.acceptedMediaTypes.includes(ref.mediaType))
        .map((ref) => ref.mediaType),
    ),
  ];
  if (unsupported.length > 0) return { kind: "unsupported_media_type", mediaTypes: unsupported };
  if (args.mergedReferenceCount > args.maxReferences) {
    return { kind: "reference_overflow", max: args.maxReferences };
  }
  return null;
}

function fnv1a32Hex(payload: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** 文本输入签名（契约 §4）：对目标全部文本入边（边序）的规范化数据做 FNV-1a 双段哈希
 *  （Node/浏览器同构，非加密用途）；直接参考变化不入签名。 */
export function textInputSignatureOf(inputs: ReadonlyArray<TargetTextInputEntry>): string {
  const normalized = JSON.stringify(
    inputs.map((entry) => [
      entry.nodeId,
      entry.text,
      entry.identities.map((identity) => [
        identity.sourceNodeId,
        identity.assetId,
        identity.mediaType,
      ]),
    ]),
  );
  return fnv1a32Hex(normalized, 0x811c9dc5) + fnv1a32Hex(normalized, 0x97c29b3d);
}
