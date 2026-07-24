/**
 * L0 — 画布文档模型（纯数据，无 React Flow 依赖）。
 *
 * 蓝鲸化：
 * - 媒体产物用 `assetId` 引用（非 value{url}），对齐后端 assets 表 + IK2BJK。
 * - edges / group / recipe / parentId 为工作流留位（本轮空/占位，UI 不开放）。
 * - serialize 剥离临时态（status/progress/selected），不进持久文档。
 *
 * 决策见 ADR-0021；规格见 openspec/changes/canvas-frontend-architecture/specs/canvas-doc-model。
 */

export type NodeKindId = "text" | "image" | "video" | "audio" | "group";
export type MediaKind = "text" | "image" | "video" | "audio";
export type NodeStatus = "idle" | "running" | "done" | "error"; // 投影态，不持久化

/** 蓝鲸 Asset 独立实体（对齐后端 assets 表）；节点只存 assetId 引用，src 惰性重签。 */
export interface Asset {
  id: string;
  kind: MediaKind;
  src?: string;
  cover?: string;
  width?: number;
  height?: number;
  duration?: number;
  mimeType?: string;
  source?: "generated" | "uploaded";
}

/** 节点产物来源（recipe.origin）。 */
export type NodeOrigin = "uploaded" | "generated" | "derived";

/** 输入引用：画布内 nodeId 优先（可追溯+重连感知），画布外 assetId/url 兜底，text 内联文本快照。 */
export interface RecipeInput {
  kind: MediaKind;
  nodeId?: string;
  assetId?: string;
  text?: string;
  url?: string;
}

/** 生成输入（lineage）：prompt/首帧/尾帧/参考 来自画布内节点 or 画布外资产。 */
export interface RecipeInputs {
  prompt?: RecipeInput;
  firstFrame?: RecipeInput;
  lastFrame?: RecipeInput;
  references?: RecipeInput[];
}

export interface ImageGenParams {
  aspectRatio: string;
  resolution: string;
  quantity: number;
  refMode?: string;
}

export interface VideoGenParams {
  aspectRatio: string;
  resolution: string;
  duration: number;
  refMode: string;
  internetSearch?: boolean;
}

export interface AudioGenParams {
  [key: string]: unknown;
}

/** 生成记录：模型 + 参数 + 输入引用 + 绑定 job。 */
export interface GenerationRecipe {
  mediaKind: MediaKind;
  model: string;
  params: ImageGenParams | VideoGenParams | AudioGenParams;
  inputs: RecipeInputs;
  jobId?: string;
  generatedAt?: string;
}

/** 派生变换记录（origin=derived；本轮类型就位，派生动作属后续子工单）。 */
export interface DerivedRecipe extends GenerationRecipe {
  transform: "upscale" | "snapshot" | "extract-audio" | "inpaint" | "regenerate";
  sourceNodeId?: string;
  sourceAssetId?: string;
}

/**
 * 节点 Recipe：产物「怎么来的」+ 重生成所需全部信息（provenance + params）。
 * 持久化进画布 JSON；是「重新生成」与「派生操作」的唯一依据。旧节点无 recipe → undefined（向前兼容）。
 */
export interface NodeRecipe {
  origin: NodeOrigin;
  generation?: GenerationRecipe;
}

export interface CanvasNodeData {
  kind: NodeKindId;
  label?: string;
  prompt?: string; // 节点自带；有引用时让位（见 engine resolveInputs）
  model?: string;
  providerId?: string;
  assetId?: string; // ★ 媒体引用 store.assets[id]（非 url 直存）
  recipe?: NodeRecipe; // ★ 产物溯源 + 重生成依据（origin/generation；旧节点无=向前兼容）
  taskId?: string; // 绑 GenerationJob（工作流留位）
  status?: NodeStatus; // 投影态，serialize 剥离
  collapsed?: boolean; // group 折叠（工作流留位）
  [key: string]: unknown;
}

export interface CanvasNode {
  id: string;
  type: NodeKindId; // === data.kind，供 RF
  position: { x: number; y: number };
  /** 节点持久尺寸（resize 后存）；省略时由 RF measured 或默认。 */
  width?: number;
  height?: number;
  parentId?: string; // 编组留位：子节点 parentId = group id
  data: CanvasNodeData;
}

/** 工作流留位（本轮恒空数组，不渲染连线）。 */
export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface CanvasDoc {
  id: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  version: number;
}

/** 新建空 doc。 */
export function createEmptyDoc(id = ""): CanvasDoc {
  return { id, nodes: [], edges: [], version: 1 };
}

/**
 * 序列化 CanvasDoc → NodeItem[] JSON（兼容老 /canvas：老 filterPersistableNodes 对数组
 * 调 .filter；若存 {nodes,edges} 对象则崩 `xxx.filter is not a function`）。
 * 兼容期产 NodeItem[]：assetId String→Number，剥临时态（status/progress/selected 自然不映射）。
 * edges/version 暂不入库（工作流未开，edges 恒空；开后再扩展结构）。
 *
 * type 透传 kind（image/video/audio/text）；group 无独立产物 → 降级 image（老 NodeItem 无 group，
 * 老画布遇未知 type 走 RF 默认节点不崩）。audio 不降级：IJZY0Z 音频节点须持久化重载保留 kind。
 */
export function serialize(doc: CanvasDoc): string {
  const items = doc.nodes.map((n) => ({
    id: n.id,
    type: n.data.kind === "group" ? ("image" as const) : n.data.kind,
    position: n.position,
    width: n.width ?? 200,
    height: n.height ?? 200,
    content: n.data.content,
    assetId: n.data.assetId != null ? Number(n.data.assetId) : undefined,
    prompt: n.data.prompt,
    recipe: n.data.recipe,
    taskId: n.data.taskId,
    // edges 聚合到 target 节点 references（兼容老 NodeItem[]：老忽略 references，v2 parse 派生 edges）
    references: [] as Array<{ source: string; sourceHandle?: string; targetHandle?: string }>,
  }));
  for (const e of doc.edges) {
    const t = items.find((i) => i.id === e.target);
    if (t) t.references.push({ source: e.source, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle });
  }
  return JSON.stringify(items);
}

/**
 * 反序列化 JSON → CanvasDoc（双兼容）：
 * - 老 NodeItem[]（数组，content/assetId 平铺 + type）
 * - 新 {nodes,edges}（v2 早期写，data.kind/data.assetId）
 */
export function parse(json: string): CanvasDoc {
  const raw = JSON.parse(json) as unknown;
  const arr = (Array.isArray(raw) ? raw : ((raw as { nodes?: unknown[] })?.nodes ?? [])) as Record<string, unknown>[];
  const obj = (Array.isArray(raw) ? {} : (raw as Record<string, unknown>)) ?? {};
  // edges：数组从 references 派生（兼容老 NodeItem[]），对象从 obj.edges
  const edges: CanvasEdge[] = Array.isArray(raw)
    ? arr.flatMap((n) => {
        const id = (n.id as string) ?? "";
        const refs = (n.references as Array<{ source: string; sourceHandle?: string; targetHandle?: string }>) ?? [];
        return refs.map((r, idx) => ({
          id: `e_${id}_${r.source}_${idx}`,
          source: r.source,
          target: id,
          sourceHandle: r.sourceHandle,
          targetHandle: r.targetHandle,
        }));
      })
    : ((obj.edges as CanvasEdge[]) ?? []);
  return {
    id: (obj.id as string) ?? "",
    nodes: arr.map((n) => normalizeNode(n as Record<string, unknown>)),
    edges,
    version: (obj.version as number) ?? 1,
  };
}

/** 兼容老 NodeItem（content/assetId 平铺 + type）+ 新 CanvasNode（data.*）→ CanvasNode。 */
function normalizeNode(n: Record<string, unknown>): CanvasNode {
  const data = (n.data ?? {}) as Record<string, unknown>;
  const rawType = ((data.kind as NodeKindId) ?? (n.type as NodeKindId) ?? "text") as NodeKindId;
  const kind: NodeKindId = rawType === "group" ? "image" : rawType;
  const content = data.content ?? n.content;
  const rawAsset = data.assetId ?? n.assetId;
  const assetId = rawAsset != null ? String(rawAsset) : undefined;
  const imageUrl = data.imageUrl ?? n.imageUrl;
  const prompt = data.prompt ?? n.prompt;
  const recipe = (data.recipe ?? n.recipe) as NodeRecipe | undefined;
  const taskId = (data.taskId ?? n.taskId) as string | undefined;
  const nodeData: CanvasNodeData = { kind };
  if (content != null) (nodeData as Record<string, unknown>).content = content;
  if (assetId != null) nodeData.assetId = assetId;
  if (imageUrl != null) (nodeData as Record<string, unknown>).imageUrl = imageUrl;
  if (prompt != null) nodeData.prompt = prompt as string;
  if (recipe) nodeData.recipe = recipe;
  if (taskId) nodeData.taskId = taskId;
  return {
    id: (n.id as string) ?? "",
    type: kind,
    position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
    width: n.width as number | undefined,
    height: n.height as number | undefined,
    parentId: n.parentId as string | undefined,
    data: nodeData,
  };
}
