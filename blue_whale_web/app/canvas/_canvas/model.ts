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
import { wireInteger } from "@/lib/wire-integer";

export type NodeKindId =
  "text" | "image" | "video" | "audio" | "group" | "reference";
export type MediaKind = "text" | "image" | "video" | "audio";
/** IK55VS 参考卡类型（单 kind=reference + cardType；后续新卡类只扩此联合，不改节点模型）。 */
export type ReferenceCardType =
  "style" | "character" | "object" | "environment" | "custom";
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

/** 音频生成参数（IK55VM）：子模式 + music 专属字段；不设显式时长/格式（模型能力决定，默认 mp3）。 */
export interface AudioGenParams {
  mode?: "audio" | "music";
  lyrics?: string;
  instrumental?: boolean;
  quantity?: number;
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
  transform:
    "upscale" | "snapshot" | "extract-audio" | "inpaint" | "regenerate";
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
  richDoc?: unknown; // IK55VH 富文本卡 TipTap JSON doc；连线进 prompt 时由 richDocToPlainText 派生纯文本
  cardType?: ReferenceCardType; // IK55VS 参考卡类型（仅 kind=reference 时有意义）
  description?: string; // IK55VS 参考卡描述文本（双击就地编辑写回）
  name?: string; // IK55VT 参考卡名称（双击改名；默认=类型名，持久化显式改过的）
  referenceAssetId?: string; // IK55VT 参考卡参考图引用 store.assets[id]（非 url 直存）
  referenceImageAspect?: number; // IK55VT 参考图宽高比（width/height），已填态高度按比自适应
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
 * 兼容期产 NodeItem[]：安全 assetId 用 number，超大 ID 保留十进制 string，剥临时态。
 * edges/version 暂不入库（工作流未开，edges 恒空；开后再扩展结构）。
 *
 * type 透传 kind（image/video/audio/text/reference）；group 无独立产物 → 降级 image（老 NodeItem 无 group，
 * 老画布遇未知 type 走 RF 默认节点不崩）。audio/reference 不降级：IJZY0Z 音频节点与 IK55VS 参考卡
 * 须持久化重载保留 kind。
 */
export function serialize(doc: CanvasDoc): string {
  const items = doc.nodes.map((n) => ({
    id: n.id,
    type: n.data.kind === "group" ? ("image" as const) : n.data.kind,
    position: n.position,
    width: n.width ?? 200,
    height: n.height ?? 200,
    content: n.data.content,
    assetId: n.data.assetId != null ? wireInteger(n.data.assetId) : undefined,
    prompt: n.data.prompt,
    richDoc: n.data.richDoc,
    cardType: n.data.cardType,
    description: n.data.description,
    name: n.data.name,
    referenceAssetId:
      n.data.referenceAssetId != null
        ? Number(n.data.referenceAssetId)
        : undefined,
    referenceImageAspect: n.data.referenceImageAspect,
    recipe: n.data.recipe,
    taskId: n.data.taskId,
    // edges 聚合到 target 节点 references（兼容老 NodeItem[]：老忽略 references，v2 parse 派生 edges）
    references: [] as Array<{
      source: string;
      sourceHandle?: string;
      targetHandle?: string;
    }>,
  }));
  for (const e of doc.edges) {
    const t = items.find((i) => i.id === e.target);
    if (t)
      t.references.push({
        source: e.source,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      });
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
  const arr = (
    Array.isArray(raw) ? raw : ((raw as { nodes?: unknown[] })?.nodes ?? [])
  ) as Record<string, unknown>[];
  const obj =
    (Array.isArray(raw) ? {} : (raw as Record<string, unknown>)) ?? {};
  // edges：数组从 references 派生（兼容老 NodeItem[]），对象从 obj.edges
  const edges: CanvasEdge[] = Array.isArray(raw)
    ? arr.flatMap((n) => {
        const id = (n.id as string) ?? "";
        const refs =
          (n.references as Array<{
            source: string;
            sourceHandle?: string;
            targetHandle?: string;
          }>) ?? [];
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
  const rawType = ((data.kind as NodeKindId) ??
    (n.type as NodeKindId) ??
    "text") as NodeKindId;
  const kind: NodeKindId = rawType === "group" ? "image" : rawType;
  const content = data.content ?? n.content;
  const rawAsset = data.assetId ?? n.assetId;
  const assetId = rawAsset != null ? String(rawAsset) : undefined;
  const imageUrl = data.imageUrl ?? n.imageUrl;
  const prompt = data.prompt ?? n.prompt;
  const richDoc = data.richDoc ?? n.richDoc;
  const cardType = (data.cardType ?? n.cardType) as
    ReferenceCardType | undefined;
  const description = (data.description ?? n.description) as string | undefined;
  const name = (data.name ?? n.name) as string | undefined;
  const rawRefAsset = data.referenceAssetId ?? n.referenceAssetId;
  const referenceAssetId =
    rawRefAsset != null ? String(rawRefAsset) : undefined;
  const referenceImageAspect = (data.referenceImageAspect ??
    n.referenceImageAspect) as number | undefined;
  const recipe = (data.recipe ?? n.recipe) as NodeRecipe | undefined;
  const taskId = (data.taskId ?? n.taskId) as string | undefined;
  const nodeData: CanvasNodeData = { kind };
  if (content != null) (nodeData as Record<string, unknown>).content = content;
  if (assetId != null) nodeData.assetId = assetId;
  if (imageUrl != null)
    (nodeData as Record<string, unknown>).imageUrl = imageUrl;
  if (prompt != null) nodeData.prompt = prompt as string;
  if (richDoc != null) nodeData.richDoc = richDoc;
  if (cardType != null) nodeData.cardType = cardType;
  if (description != null) nodeData.description = description;
  if (name != null) nodeData.name = name;
  if (referenceAssetId != null) nodeData.referenceAssetId = referenceAssetId;
  if (referenceImageAspect != null)
    nodeData.referenceImageAspect = referenceImageAspect;
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

/** IK55VH 富文本卡 JSON doc 节点结构（TipTap getJSON 输出，宽松遍历）。 */
type RichDocNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: RichDocNode[];
};

/**
 * IK55VH 富文本卡 JSON doc → 纯文本（连线进下游节点 prompt 用）。
 * mention → @[name]（与 dock/mention.ts extractEditor 契约一致），
 * heading/paragraph 按行，列表/引用展平，分割线 → `---`。
 */
export function richDocToPlainText(doc: unknown): string {
  const lines: string[] = [];
  const inline = (n: RichDocNode): string => {
    if (n.type === "text") return n.text ?? "";
    if (n.type === "mention")
      return `@[${(n.attrs?.label as string) ?? (n.attrs?.id as string) ?? ""}]`;
    if (n.type === "hardBreak") return "\n";
    return (n.content ?? []).map(inline).join("");
  };
  const blocks = (n: RichDocNode) => {
    for (const c of n.content ?? []) {
      if (c.type === "paragraph" || c.type === "heading") lines.push(inline(c));
      else if (c.type === "horizontalRule") lines.push("---");
      else if (
        c.type === "blockquote" ||
        c.type === "bulletList" ||
        c.type === "orderedList" ||
        c.type === "listItem"
      )
        blocks(c);
      else lines.push(inline(c));
    }
  };
  blocks(doc as RichDocNode);
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** IK55VH：空卡判定（纯文本派生为空即为空卡，用于「添加笔记...」占位）。 */
export function isEmptyRichDoc(doc: unknown): boolean {
  return richDocToPlainText(doc).length === 0;
}
