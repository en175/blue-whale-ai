import {
  TEXT_INDEX_EDGE_MARKER,
  mediaMentionSchema,
  mediaRefSchema,
  type MediaMention,
  type MediaMentionType,
  type MediaRef,
} from "./text-node-media.js";


export interface TextIndexCanvasNode {
  id?: unknown;
  type?: unknown;
  data?: Record<string, unknown>;
}

export interface TextProvidedRef {
  textNodeId: string;
  sourceNodeId: string;
  assetId: string;
  mediaType: MediaMentionType;
  name: string;
  url: string;
}

export interface TargetTextInputEntry {
  nodeId: string;
  text: string;
  identities: Array<{ sourceNodeId: string; assetId: string; mediaType: MediaMentionType }>;
}

export interface TargetTextIndex {
  inputs: TargetTextInputEntry[];
  refs: TextProvidedRef[];
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

export const IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES: readonly MediaMentionType[] = ["image"];

export const TEXT_INDEX_INVALID_MESSAGE = "文本索引存在失效素材，请修复来源文本后提交";
export const TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE = "文本索引包含目标不支持的媒体类型，请修改来源文本";
export const textIndexOverflowMessage = (max: number) => `参考图最多 ${max} 张`;

export type TextIndexSyncError =
  | { kind: "invalid_index" }
  | { kind: "unsupported_media_type"; mediaTypes: MediaMentionType[] }
  | { kind: "reference_overflow"; max: number };

function unsupportedMediaTypesOf(
  index: Pick<TargetTextIndex, "refs">,
  acceptedMediaTypes: readonly MediaMentionType[],
): MediaMentionType[] {
  return [
    ...new Set(
      index.refs
        .filter((ref) => !acceptedMediaTypes.includes(ref.mediaType))
        .map((ref) => ref.mediaType),
    ),
  ];
}

export function checkTextIndexSyncInput(args: {
  index: Pick<TargetTextIndex, "refs" | "invalid">;
  acceptedMediaTypes: readonly MediaMentionType[];
  mergedReferenceCount: number;
  maxReferences: number;
}): TextIndexSyncError | null {
  if (args.index.invalid.length > 0) return { kind: "invalid_index" };
  const unsupported = unsupportedMediaTypesOf(args.index, args.acceptedMediaTypes);
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


export interface VideoReferenceLikeItem {
  asset_id?: unknown;
}

export interface TextProvidedVideoReference {
  role: "reference";
  asset_id: string;
  type: MediaMentionType;
}

function appendTextProvidedReferences(
  directItems: ReadonlyArray<VideoReferenceLikeItem>,
  refs: ReadonlyArray<TextProvidedRef>,
): TextProvidedVideoReference[] {
  const seen = new Set(
    directItems
      .map((item) => (typeof item.asset_id === "string" || typeof item.asset_id === "number" ? String(item.asset_id) : null))
      .filter((id): id is string => id !== null),
  );
  const added: TextProvidedVideoReference[] = [];
  for (const ref of refs) {
    if (seen.has(ref.assetId)) continue;
    seen.add(ref.assetId);
    added.push({ role: "reference", asset_id: ref.assetId, type: ref.mediaType });
  }
  return added;
}

export function textProvidedVideoReferences(
  directItems: ReadonlyArray<VideoReferenceLikeItem>,
  refs: ReadonlyArray<TextProvidedRef>,
): TextProvidedVideoReference[] {
  return appendTextProvidedReferences(directItems, refs);
}

export const VIDEO_TEXT_INDEX_FRAME_CONFLICT_MESSAGE =
  "首尾帧模式不能与文本带入参考混用，请调整参考或修改来源文本";

export type VideoTextIndexSyncError =
  | { kind: "invalid_index" }
  | { kind: "frame_conflict" }
  | { kind: "unsupported_media_type"; mediaTypes: MediaMentionType[] };

export function checkVideoTextIndexSyncInput(args: {
  index: Pick<TargetTextIndex, "refs" | "invalid">;
  acceptedMediaTypes: readonly MediaMentionType[];
  hasFrameRole: boolean;
}): VideoTextIndexSyncError | null {
  if (args.index.invalid.length > 0) return { kind: "invalid_index" };
  if (args.hasFrameRole && args.index.refs.length > 0) return { kind: "frame_conflict" };
  const unsupported = unsupportedMediaTypesOf(args.index, args.acceptedMediaTypes);
  if (unsupported.length > 0) return { kind: "unsupported_media_type", mediaTypes: unsupported };
  return null;
}


export const AUDIO_TEXT_INDEX_ACCEPTED_MEDIA_TYPES: readonly MediaMentionType[] = ["audio", "image"];

export type TextProvidedAudioReference = TextProvidedVideoReference;

export function textProvidedAudioReferences(
  directItems: ReadonlyArray<VideoReferenceLikeItem>,
  refs: ReadonlyArray<TextProvidedRef>,
): TextProvidedAudioReference[] {
  return appendTextProvidedReferences(directItems, refs);
}

export type AudioTextIndexSyncError =
  | { kind: "invalid_index" }
  | { kind: "unsupported_media_type"; mediaTypes: MediaMentionType[] };

export function checkAudioTextIndexSyncInput(args: {
  index: Pick<TargetTextIndex, "refs" | "invalid">;
  acceptedMediaTypes: readonly MediaMentionType[];
}): AudioTextIndexSyncError | null {
  if (args.index.invalid.length > 0) return { kind: "invalid_index" };
  const unsupported = unsupportedMediaTypesOf(args.index, args.acceptedMediaTypes);
  if (unsupported.length > 0) return { kind: "unsupported_media_type", mediaTypes: unsupported };
  return null;
}
