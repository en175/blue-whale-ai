/**
 * L3 — run engine。纯部分（resolveInputs/topoSort）在此；异步 runNode/runGroup
 * 经注入的 RunCtx 编排，故可脱离 store/React 测试。
 *
 * 蓝鲸化：resolveInputs 读上游 assetId → 查 assets 得 Asset；runNode 写回 assetId（非 value）。
 * 本轮 UI 不触发 run（工作流 UI 不开），但纯函数 + 单测就绪，未来接 UI 零改动。
 */
import type {
  Asset,
  AudioGenParams,
  CanvasEdge,
  CanvasNode,
  CanvasNodeData,
  ImageGenParams,
  MediaKind,
  NodeRecipe,
  RecipeInput,
  RecipeInputs,
  VideoGenParams,
} from "./model";
import { nodeKinds, type TaskInput } from "./kinds";

/**
 * 解析 target 的输入：对每条指向 target 的 link，读上游节点【当前 assetId】对应的 Asset，
 * 按 link 的 targetHandle 归位。纯读，绝不触发上游运行。
 */
export function resolveInputs(
  target: CanvasNode,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  assets: Record<string, Asset>,
): Record<string, Asset> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inputs: Record<string, Asset> = {};
  for (const edge of edges) {
    if (edge.target !== target.id || !edge.targetHandle) continue;
    const src = byId.get(edge.source);
    if (!src) continue;
    // text 上游：有 assetId 读 asset；否则 data.prompt 物化成 text Asset（让 prompt 能流）
    if (src.data.kind === "text") {
      if (src.data.assetId) {
        const a = assets[src.data.assetId];
        if (a) inputs[edge.targetHandle] = a;
      } else if (src.data.prompt) {
        inputs[edge.targetHandle] = {
          id: src.id,
          kind: "text",
          src: src.data.prompt,
        };
      }
      continue;
    }
    const assetId = src.data.assetId;
    if (!assetId) continue;
    const asset = assets[assetId];
    if (asset) inputs[edge.targetHandle] = asset;
  }
  return inputs;
}

/**
 * 把 target 的入边解析成冻结 RecipeInputs（lineage）：按 targetHandle 归位，
 * 记上游 nodeId（画布内可追溯）+ assetId/url（兜底）+ text（prompt 文本快照）。
 * 与 resolveInputs 同源遍历，但产出可持久化引用（含 nodeId），供 recipe 冻结。
 */
export function toRecipeInputs(
  target: CanvasNode,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  assets: Record<string, Asset>,
): RecipeInputs {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inputs: RecipeInputs = {};
  const references: RecipeInput[] = [];
  for (const edge of edges) {
    if (edge.target !== target.id || !edge.targetHandle) continue;
    const src = byId.get(edge.source);
    if (!src) continue;
    const input = toRecipeInput(src, assets);
    switch (edge.targetHandle) {
      case "prompt":
        inputs.prompt = input;
        break;
      case "firstFrame":
        inputs.firstFrame = input;
        break;
      case "lastFrame":
        inputs.lastFrame = input;
        break;
      default:
        references.push(input); // reference 等归 references
    }
  }
  if (references.length) inputs.references = references;
  return inputs;
}

/** 单上游节点 → RecipeInput：nodeId 必带，assetId/url/text 按节点类型填充。 */
function toRecipeInput(
  src: CanvasNode,
  assets: Record<string, Asset>,
): RecipeInput {
  const kind: MediaKind =
    src.data.kind === "text" ? "text" : (src.data.kind as MediaKind);
  const input: RecipeInput = { kind, nodeId: src.id };
  if (kind === "text") {
    if (src.data.assetId) {
      const a = assets[src.data.assetId];
      if (a) input.text = a.src;
    } else if (src.data.prompt) {
      input.text = src.data.prompt;
    }
  } else if (src.data.assetId) {
    input.assetId = src.data.assetId;
    const a = assets[src.data.assetId];
    if (a) input.url = a.src;
  }
  return input;
}

/**
 * 组装 generated NodeRecipe（冻结生成记录：model/params/inputs/jobId）。
 * generatedAt 缺省取当前 ISO 时间；测试可注入固定值。纯函数，无副作用。
 */
export function buildGenerationRecipe(args: {
  mediaKind: MediaKind;
  model: string;
  params: ImageGenParams | VideoGenParams | AudioGenParams;
  inputs: RecipeInputs;
  jobId?: string;
  generatedAt?: string;
}): NodeRecipe {
  return {
    origin: "generated",
    generation: {
      mediaKind: args.mediaKind,
      model: args.model,
      params: args.params,
      inputs: args.inputs,
      jobId: args.jobId,
      generatedAt: args.generatedAt ?? new Date().toISOString(),
    },
  };
}

/** 拓扑排序；ids 内有环返回 null，否则返回合法序（上游在前）。 */
export function topoSort(
  ids: string[],
  edges: { source: string; target: string }[],
): string[] | null {
  const members = new Set(ids);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const downstream = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    if (!members.has(edge.source) || !members.has(edge.target)) continue;
    downstream.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const next of downstream.get(cur)!) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  return order.length === ids.length ? order : null;
}

/** runNode/runGroup 的运行时依赖面，注入以保持 engine 可测。 */
export interface RunCtx {
  getNodes: () => CanvasNode[];
  getEdges: () => CanvasEdge[];
  getAssets: () => Record<string, Asset>;
  /** 提交一次生成，resolve 为产出的 Asset。本轮 UI 不触发，留接口（mock 测）。 */
  generate: (nodeId: string, task: TaskInput) => Promise<Asset>;
  /** 回写节点 data（status / assetId）。 */
  updateNode: (nodeId: string, patch: Partial<CanvasNodeData>) => void;
}

/** 单跑一个节点：解析引用输入（快照，不级联）→ 构造任务 → 一次生成 → 写回 assetId。绝不级联上游。 */
export async function runNode(nodeId: string, ctx: RunCtx): Promise<Asset> {
  const node = ctx.getNodes().find((n) => n.id === nodeId);
  if (!node) throw new Error(`node ${nodeId} not found`);
  if (node.data.kind === "group")
    throw new Error("run a group via runGroup, not runNode");
  const inputs = resolveInputs(
    node,
    ctx.getNodes(),
    ctx.getEdges(),
    ctx.getAssets(),
  );
  const task = nodeKinds[node.data.kind].buildTask(node, inputs);
  ctx.updateNode(nodeId, { status: "running" });
  const asset = await ctx.generate(nodeId, task);
  ctx.updateNode(nodeId, { assetId: asset.id, status: "done" });
  return asset;
}

/** 整组运行：成员按内部 link 拓扑顺序逐个跑，下游读到上游刚产出值（级联）。有环抛错。 */
export async function runGroup(groupId: string, ctx: RunCtx): Promise<void> {
  const members = ctx
    .getNodes()
    .filter((n) => n.parentId === groupId && n.data.kind !== "group");
  const memberIds = new Set(members.map((m) => m.id));
  const internal = ctx
    .getEdges()
    .filter((e) => memberIds.has(e.source) && memberIds.has(e.target));
  const order = topoSort([...memberIds], internal);
  if (!order) throw new Error("group contains a cycle, cannot run");
  for (const id of order) await runNode(id, ctx);
}
