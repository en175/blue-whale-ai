import { composeTextAttachmentPrompt } from "@blue-whale/core";
import { COMPOSED_IMAGE_PROMPT_MAX_LENGTH, promptBindingsSchema, type CanvasEdge, type PromptPlanSnapshot, type TextAttachmentSnapshot } from "@blue-whale/contracts";
import { nodeAssetId, planError, readPromptPlan, validatePlanModel, type PromptTargetNode } from "../canvas/prompt-target.js";
import type { ModelCapabilityView } from "../persistence/model-capability-repo.js";
import type { WorkerRepo } from "../persistence/generation-worker-types.js";

export async function freezePromptPlans(args: {
  nodes: PromptTargetNode[]; edges: CanvasEdge[]; version: number; targetId: string;
  inputIds: string[]; prompt: string; attachments: TextAttachmentSnapshot[];
  model: ModelCapabilityView | undefined; userId: string; projectId: string;
  assets: Pick<WorkerRepo, "resolveInputAssets">;
}): Promise<PromptPlanSnapshot | undefined> {
  const { nodes, edges, targetId, inputIds, attachments } = args;
  const planNodes = attachments.flatMap(a => {
    const n = nodes.find(n => n.id === a.node_id);
    const edge = edges.find(e => e.source === a.node_id && e.target === targetId);
    return n?.data?.promptSource && (n.data.promptMentions !== undefined || edge?.data?.promptReference !== undefined) ? [n] : [];
  });
  if (!planNodes.length) return undefined;
  const plans = planNodes.map(readPromptPlan);
  const directIds = [...new Set(edges.filter(e => e.target === targetId).flatMap(e => {
    const source = nodes.find(n => n.id === e.source && n.type === "mediaNode");
    return source ? [nodeAssetId(source)] : [];
  }))];
  for (const plan of plans) {
    const edge = edges.find(e => e.source === plan.nodeId && e.target === targetId);
    const confirmed = promptBindingsSchema.safeParse((edge?.data?.promptReference as { bindings?: unknown } | undefined)?.bindings ?? (plan.bindings.length === 0 ? [] : undefined));
    if (!confirmed.success || JSON.stringify(confirmed.data) !== JSON.stringify(plan.bindings)) planError(plan.nodeId, confirmed.success ? confirmed.data : plan.bindings, "素材待同步，请先同步素材到目标");
    for (const binding of plan.bindings) {
      if (!directIds.includes(binding.assetId) || !inputIds.includes(binding.assetId)) planError(plan.nodeId, [binding], "提示词引用的素材缺失或不完整，请补充素材或移除对应引用后再生成");
    }
    validatePlanModel(plan.nodeId, plan.bindings, inputIds.length, args.model);
  }
  if (directIds.length !== inputIds.length || directIds.some(id => !inputIds.includes(id)) || new Set(inputIds).size !== inputIds.length) {
    planError(plans[0]!.nodeId, plans.flatMap(p => p.bindings), "参考清单与目标直接连线不一致");
  }
  const resolved = await args.assets.resolveInputAssets(inputIds, args.userId, args.projectId);
  for (const id of inputIds) {
    if (!resolved.some(a => a.id === id && a.type === "image" && /^https?:\/\//.test(a.url))) {
      const plan = plans.find(p => p.bindings.some(b => b.assetId === id)) ?? plans[0]!;
      planError(plan.nodeId, plan.bindings.filter(b => b.assetId === id), "素材已删除、无权访问或类型不受支持");
    }
  }
  const compiled = attachments.map(attachment => {
    const plan = plans.find(p => p.nodeId === attachment.node_id);
    if (!plan) return attachment;
    let text = plan.text;
    for (const mention of [...plan.mentions].sort((a, b) => b.start - a.start)) {
      const index = inputIds.indexOf(mention.assetId);
      text = text.slice(0, mention.start) + `参考图${index + 1}` + text.slice(mention.end);
    }
    return { ...attachment, text };
  });
  const providerPrompt = composeTextAttachmentPrompt(compiled, args.prompt);
  if (!providerPrompt.trim() || providerPrompt.length > COMPOSED_IMAGE_PROMPT_MAX_LENGTH) planError(plans[0]!.nodeId, plans[0]!.bindings, "标签转换后的提示词为空或超限");
  return { canvasVersion: args.version, plans: plans.map(({ nodeId, text, mentions }) => ({ nodeId, text, mentions })),
    images: inputIds.map(assetId => ({ assetId, url: resolved.find(a => a.id === assetId)!.url })), providerPrompt };
}
