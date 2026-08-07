import type { ProjectSnapshot } from "@/lib/project-recovery";
import {
  compareWireIntegers,
  isWireInteger,
  wireInteger,
  wireIntegersEqual,
  type WireInteger,
} from "@/lib/wire-integer";
import type { ChatMessage, NodeItem } from "./types";
import { parseAspectRatio } from "./aspectRatio";

export function projectSnapshotToChatMessages(
  snapshot: ProjectSnapshot,
): ChatMessage[] {
  const planCardByMessageId = new Map(
    (snapshot.plan_messages ?? [])
      .filter(isImageGeneratePlanMessage)
      .map((plan) => [String(plan.message_id), projectPlanCard(plan)] as const),
  );
  const messages = snapshot.conversation_messages
    .filter(isConversationMessage)
    .sort((left, right) => left.sequence_no - right.sequence_no)
    .map<ChatMessage>((message) => {
      // 后端对计划双写 conversation_messages(content_type=plan_message) 与 plan_messages（1:1）：
      // 命中计划行时在原序列位置投影计划卡并去重，避免正文重复（IK6KQ2 审查修订）。
      if (message.content_type === "plan_message") {
        const card = planCardByMessageId.get(String(message.message_id));
        if (card) {
          return card;
        }
      }
      return {
        id: `message-${message.message_id}`,
        type: message.role === "user" ? "user" : "agent",
        text: message.content,
      };
    });
  const runIds = new Set(
    snapshot.agent_runs
      .map((run) => run.agent_run_id)
      .filter(
        (id): id is number | string =>
          typeof id === "number" || typeof id === "string",
      )
      .map(String),
  );
  const cards = snapshot.generation_jobs
    .filter(
      (job) =>
        job.source === "agent_run" &&
        (typeof job.agent_run_id === "number" ||
          typeof job.agent_run_id === "string") &&
        runIds.has(String(job.agent_run_id)) &&
        (typeof job.job_id === "number" || typeof job.job_id === "string"),
    )
    .flatMap<ChatMessage>((job) =>
      generationOutputs(job).map((output) => {
        const asset = generationAsset(snapshot, output);
        const slotIndex = Number(output.slot_index);
        const errorMessage = publicErrorMessage(output, job);
        return {
          id: `generation-job-${String(job.job_id)}-slot-${slotIndex}`,
          type: "card",
          text: generationPrompt(job.input),
          meta: job.type === "video" ? "视频生成" : "图片生成",
          status: outputStatus(job, output),
          generationJobId: job.job_id as number | string,
          slotIndex,
          ...(asset
            ? { assetId: String(asset.asset_id), imageUrl: asset.access_url }
            : {}),
          ...(errorMessage ? { errorMessage } : {}),
        };
      }),
    );
  return [...messages, ...cards];
}

export function projectSnapshotToCanvasNodes(
  snapshot: ProjectSnapshot,
  persistedNodes: NodeItem[],
): NodeItem[] {
  const nodes = [...persistedNodes];
  let positionIndex = 0;
  snapshot.generation_jobs.forEach((job) => {
    const isStoryboardPreview = job.source === "storyboard_preview";
    if (
      (job.source !== "agent_run" &&
        job.source !== "bottom_dock" &&
        !isStoryboardPreview) ||
      (job.type !== "image" && job.type !== "video") ||
      (typeof job.job_id !== "number" && typeof job.job_id !== "string")
    ) {
      return;
    }
    generationOutputs(job).forEach((output) => {
      const asset = generationAsset(snapshot, output);
      if (!asset || !isSuccessfulOutput(job, output)) return;
      const assetId = String(asset.asset_id);
      const isVideo = job.type === "video";
      const slotIndex = Number(output.slot_index);
      const nodeId = `generation-job-${String(job.job_id)}-slot-${slotIndex}`;
      const existingIndex = nodes.findIndex(
        (node) => node.assetId === assetId || node.id === nodeId,
      );
      if (existingIndex >= 0) {
        const existing = { ...nodes[existingIndex] };
        delete existing.imageUrl;
        delete existing.assetAccessUrl;
        nodes[existingIndex] = {
          ...existing,
          type: isVideo ? "video" : "image",
          assetId,
          ...(isVideo
            ? { assetAccessUrl: asset.access_url }
            : { imageUrl: asset.access_url }),
        };
        return;
      }
      // 分镜节点必须先由 Canvas CAS 放置到 SceneCard 下方；此处只补资产地址，不能另建随机位置节点。
      if (isStoryboardPreview) return;
      const { width, height } = parseAspectRatio(
        generationAspectRatio(job.input),
      );
      nodes.push({
        id: nodeId,
        type: isVideo ? "video" : "image",
        position: {
          x: 48 + positionIndex * 32,
          y: 48 + positionIndex * 32,
        },
        width,
        height,
        content: generationPrompt(job.input),
        assetId,
        ...(isVideo
          ? { assetAccessUrl: asset.access_url }
          : { imageUrl: asset.access_url }),
      });
      positionIndex += 1;
    });
  });
  return nodes;
}

export type SceneCardView = {
  scene_card_id: WireInteger;
  title: string;
  summary: string | null;
  content_markdown: string;
  version: number;
};

/** SceneCard 列表投影（IK67HB/T13）：从 snapshot 派生可展示的视频场景卡，按 scene_card_id 升序。 */
export function projectSnapshotToSceneCards(
  snapshot: ProjectSnapshot,
): SceneCardView[] {
  return (snapshot.scene_cards ?? [])
    .filter(isSceneCard)
    .sort((left, right) =>
      compareWireIntegers(left.scene_card_id, right.scene_card_id),
    )
    .map<SceneCardView>((card) => ({
      scene_card_id: card.scene_card_id,
      title: card.title,
      summary: typeof card.summary === "string" ? card.summary : null,
      content_markdown: card.content_markdown,
      version: card.version,
    }));
}

function isSceneCard(value: Record<string, unknown>): value is Record<
  string,
  unknown
> & {
  scene_card_id: WireInteger;
  title: string;
  content_markdown: string;
  version: number;
} {
  return (
    isWireInteger(value.scene_card_id) &&
    typeof value.title === "string" &&
    typeof value.content_markdown === "string" &&
    typeof value.version === "number"
  );
}

function generationAsset(
  snapshot: ProjectSnapshot,
  output: Record<string, unknown>,
): ProjectSnapshot["assets"][string] | null {
  const assetId = output.asset_id;
  if (typeof assetId !== "number" && typeof assetId !== "string") return null;
  return snapshot.assets[String(assetId)] ?? null;
}

function generationOutputs(
  job: Record<string, unknown>,
): Record<string, unknown>[] {
  const source = Array.isArray(job.output_slots)
    ? job.output_slots
    : Array.isArray(job.outputs)
      ? job.outputs
      : [];
  const outputs = source.filter(
    (output): output is Record<string, unknown> =>
      !!output &&
      typeof output === "object" &&
      typeof (output as Record<string, unknown>).slot_index === "number",
  );
  if (outputs.length > 0) {
    return [...outputs].sort(
      (left, right) => Number(left.slot_index) - Number(right.slot_index),
    );
  }
  return [{ slot_index: 0 }];
}

function outputStatus(
  job: Record<string, unknown>,
  output: Record<string, unknown>,
): "normal" | "generating" | "failed" | "cancelled" {
  if (output.status === "succeeded") return "normal";
  if (output.status === "failed") return "failed";
  if (output.status === "cancelled") return "cancelled";
  if (output.asset_id !== null && output.asset_id !== undefined)
    return "normal";
  if (job.status === "failed") return "failed";
  if (job.status === "cancelled") return "cancelled";
  return "generating";
}

/**
 * 取产品规范化失败文案：优先 output.error.message（槽级），回退 job.error.message（Job 级）。
 * 后端 GenerationPublicError 已把内部错误映射为稳定公开文案（如"图像生成失败"），
 * 故此处理论上不会泄漏内部信息；非 string 保守不投影。
 */
function publicErrorMessage(
  output: Record<string, unknown>,
  job: Record<string, unknown>,
): string | null {
  const fromOutput = errorMessageOf(output.error);
  if (fromOutput) return fromOutput;
  return errorMessageOf(job.error);
}

function errorMessageOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.trim() ? message : null;
}

function isSuccessfulOutput(
  job: Record<string, unknown>,
  output: Record<string, unknown>,
): boolean {
  return (
    output.status === "succeeded" ||
    (output.status === undefined &&
      job.status === "succeeded" &&
      output.asset_id !== null &&
      output.asset_id !== undefined)
  );
}

type ImageGeneratePlanMessage = Record<string, unknown> & {
  message_id: WireInteger;
  content_markdown: string;
  sequence_label: string | null;
  applied_at: string | null;
  first_generation_job_id: WireInteger | null;
  application_availability: "available" | "requires_new_plan";
};

function isImageGeneratePlanMessage(
  value: Record<string, unknown>,
): value is ImageGeneratePlanMessage {
  return (
    value.application_kind === "image_generate" &&
    isWireInteger(value.message_id) &&
    (value.first_generation_job_id === null ||
      isWireInteger(value.first_generation_job_id)) &&
    typeof value.content_markdown === "string" &&
    (value.sequence_label === null ||
      typeof value.sequence_label === "string") &&
    (value.applied_at === null || typeof value.applied_at === "string") &&
    (value.application_availability === "available" ||
      value.application_availability === "requires_new_plan")
  );
}

function projectPlanCard(
  plan: ImageGeneratePlanMessage,
): Extract<ChatMessage, { type: "plan-card" }> {
  return {
    id: `plan-message-${String(plan.message_id)}`,
    type: "plan-card",
    text: plan.content_markdown,
    meta: "图片生成计划",
    planMessageId: plan.message_id,
    sequenceLabel: plan.sequence_label,
    appliedAt: plan.applied_at,
    applicationAvailability: plan.application_availability,
    firstGenerationJobId: plan.first_generation_job_id,
  };
}

function isConversationMessage(value: Record<string, unknown>): value is Record<
  string,
  unknown
> & {
  message_id: number | string;
  role: "user" | "assistant";
  content: string;
  sequence_no: number;
  content_type?: string;
} {
  return (
    (typeof value.message_id === "number" ||
      typeof value.message_id === "string") &&
    (value.content_type === undefined ||
      typeof value.content_type === "string") &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    typeof value.sequence_no === "number"
  );
}

function generationPrompt(input: unknown): string {
  if (input && typeof input === "object") {
    const prompt = (input as Record<string, unknown>).prompt;
    if (typeof prompt === "string" && prompt.trim()) return prompt;
  }
  return "图片生成任务";
}

function generationAspectRatio(input: unknown): string {
  if (input && typeof input === "object") {
    const aspectRatio = (input as Record<string, unknown>).aspect_ratio;
    if (typeof aspectRatio === "string") return aspectRatio;
  }
  return "1:1";
}

/**
 * 取当前 Run 的 agent_run_id（数值最大者）。
 *
 * 当前 Run 语义：新消息创建的 run id 严格递增取最大，supersede 产生更高 id 接管。
 * 空数组 / 无有效 id 返回 null。
 */
export function selectCurrentRunId(
  runs: Array<Record<string, unknown>>,
): WireInteger | null {
  if (!Array.isArray(runs) || runs.length === 0) return null;
  let latestId: WireInteger | null = null;
  for (const run of runs) {
    const id = run.agent_run_id;
    if (!isWireInteger(id)) continue;
    const normalized = wireInteger(String(id));
    if (latestId === null || compareWireIntegers(normalized, latestId) > 0) {
      latestId = normalized;
    }
  }
  return latestId;
}

/**
 * 取当前 Run（agent_run_id 最大）已激活的 Creative Skill 稳定身份。
 *
 * activated_creative_skill_versions 是 0/1 数组（契约 §3）；取首项 creative_skill_id。
 * 非数组 / 空 / 缺字段返回 null。当前 Run 语义：新消息创建的 run id 严格递增取最大，
 * supersede 产生更高 id 接管，用户下一条非 forced 消息创建更高 id 无激活 run → 返回 null。
 */
export function selectCurrentRunCreativeSkillId(
  runs: Array<Record<string, unknown>>,
): string | null {
  const currentRunId = selectCurrentRunId(runs);
  if (currentRunId === null) return null;
  const latest = runs.find(
    (run) =>
      isWireInteger(run.agent_run_id) &&
      wireIntegersEqual(run.agent_run_id, currentRunId),
  );
  if (!latest) return null;
  const versions = latest.activated_creative_skill_versions;
  if (!Array.isArray(versions) || versions.length === 0) return null;
  const first = versions[0];
  if (!first || typeof first !== "object") return null;
  const skillId = (first as Record<string, unknown>).creative_skill_id;
  return typeof skillId === "string" ? skillId : null;
}
