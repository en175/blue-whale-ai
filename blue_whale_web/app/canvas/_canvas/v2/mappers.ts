/**
 * v2 mappers —— job / card → CanvasNodeData 纯映射（v2 专用）。
 *
 * 不复用老 recover.ts/nodeFromCard.ts（它们产出 NodeItem，老 /canvas 依赖，
 * strangler 不动）。v2 产出 CanvasNodeData + 新 status 枚举（running 非 loading）。
 *
 * 位置（position）依赖视口/容器，由 page addNode 层封装，本文件只产 data + 尺寸。
 */
import { parseAspectRatio } from "../aspectRatio";
import type { CanvasNodeData, NodeKindId, GenerationRecipe, ImageGenParams, RecipeInput, VideoGenParams } from "../model";
import type { DockPrefill, DockMediaItem } from "../types";
import type { JobListItem } from "../api/generation";
import type { CardMessage } from "../nodeFromCard";

export type V2Placeholder = {
  /** 稳定去重 id：同 jobId 刷新多次只建一个占位。 */
  id: string;
  kind: NodeKindId;
  width: number;
  height: number;
  data: Partial<CanvasNodeData> & { content?: string; progress?: number };
};

/**
 * processing job → v2 占位：content 取 input.prompt、status=running（非 loading）、
 * 尺寸按 input.aspectRatio、视频带 progress。input 缺失回退（空 prompt、1:1）。
 */
export function jobToV2Placeholder(job: JobListItem): V2Placeholder {
  const input = job.input ?? {};
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const aspectToken = typeof input.aspectRatio === "string" ? input.aspectRatio : "1:1";
  const { width, height } = parseAspectRatio(aspectToken);
  const kind: NodeKindId = job.type === "video" ? "video" : "image";
  const data: V2Placeholder["data"] = { content: prompt, status: "running" };
  if (kind === "video" && typeof job.progress === "number") {
    data.progress = job.progress;
  }
  return { id: `job-${job.jobId}`, kind, width, height, data };
}

/** card → v2 图片节点字段（位置外）：尺寸按 card.meta 比例，content=card.text。 */
export function cardToV2ImageFields(card: CardMessage): { width: number; height: number; content: string } {
  const { width, height } = parseAspectRatio(card.meta);
  return { width, height, content: card.text };
}

/**
 * recipe.generation → Dock 预填快照（P2 重新编辑：把节点生成参数带回底部栏）。
 * 纯提取：prompt + 模型/比例/分辨率/数量/时长/refMode + 首尾帧/参考图 url。字段缺失返 undefined（Dock 侧跳过）。
 */
/**
 * DockMediaItem → RecipeInput[]：nodeId 画布内来源（可追溯+重连感知）+ assetId 上传资产 + url 兜底。
 * 支撑 recipe references 带 nodeId（P3，ADR-0027 REQ-6）：连线（nodeId 关联画布节点）+ 重新生成溯源。
 */
export function dockMediaToRecipeRefs(media: DockMediaItem[]): RecipeInput[] {
  return media
    .filter((m) => m.src)
    .map((m) => ({
      kind: m.type,
      nodeId: m.nodeId,
      assetId: m.assetId != null ? String(m.assetId) : undefined,
      url: m.src,
    }));
}

export function recipeToDockPrefill(gen: GenerationRecipe): DockPrefill {
  const params = gen.params as Partial<ImageGenParams & VideoGenParams>;
  // references 保留各自 kind（image/video/audio）——视频 Dock 按 kind 分到 referenceImages/Videos/Audios
  const refs = gen.inputs.references?.flatMap((r) =>
    r.url && r.kind !== "text" ? [{ url: r.url, kind: r.kind as "image" | "video" | "audio" }] : [],
  );
  return {
    prompt: gen.inputs.prompt?.text,
    modelId: gen.model,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
    quantity: typeof params.quantity === "number" ? params.quantity : undefined,
    duration: typeof params.duration === "number" ? params.duration : undefined,
    refMode: params.refMode,
    firstFrameUrl: gen.inputs.firstFrame?.url,
    lastFrameUrl: gen.inputs.lastFrame?.url,
    references: refs && refs.length ? refs : undefined,
  };
}

/** 点击式跨模态 refill（D IJZY24）：节点 + action → 唤起 Dock mode + 带参考 media / derived。 */
export type CrossmodalRefill = { mode?: "image" | "video" | "audio"; media?: DockMediaItem; derived?: boolean };

export function buildCrossmodalRefill(
  node: { id: string; data: { kind: NodeKindId; content?: string } },
  actionId: string,
  src?: string,
): CrossmodalRefill | null {
  // 只 image/video/audio 媒体节点参与跨模态（text/group 无跨模态 toolbar action）
  if (node.data.kind !== "image" && node.data.kind !== "video" && node.data.kind !== "audio") return null;
  const name = node.data.content || "未命名素材";
  const type = node.data.kind; // image|video|audio ∈ DockMediaItem["type"]
  switch (actionId) {
    case "video": // 生成视频（图/视/音 → video Dock 带参考）
    case "audio": // 生成音频（图/视/音 → audio Dock 带参考，mock）
      if (!src) return null;
      return { mode: actionId, media: { id: node.id, type, name, src } };
    case "extract-audio": // 提取音频（视 → 派生占位，后端待接）
      return { derived: true };
    default:
      return null;
  }
}
