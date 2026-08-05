/**
 * inboxMessages —— 收件箱 Snapshot → 对话消息流（ChatMessage[]）的纯映射。
 *
 * 与画布 conversationRecovery 的差别：收件箱是多对话容器，消息按当前
 * conversationId 过滤；生成卡片经 agent_run → conversation_id 归属过滤
 * （agent_run 缺失时无法判定归属，保守展示，不丢数据）。
 *
 * 仅做数据映射，不含请求/副作用，供 generate 页与组件测试直接复用。
 */
import type { ProjectSnapshot } from "@/lib/project-recovery";
import {
  isWireInteger,
  wireIntegersEqual,
  type WireInteger,
} from "@/lib/wire-integer";
import type { ChatMessage } from "@/app/canvas/_canvas/types";

export function inboxSnapshotToChatMessages(
  snapshot: ProjectSnapshot,
  conversationId: WireInteger,
): ChatMessage[] {
  const messages = snapshot.conversation_messages
    .filter(isConversationMessage)
    .filter((message) => {
      const owner = message.conversation_id;
      // 历史数据缺 conversation_id 时不过滤（不丢消息）；否则按当前对话过滤
      return !isWireInteger(owner) || wireIntegersEqual(owner, conversationId);
    })
    .sort((left, right) => left.sequence_no - right.sequence_no)
    .map<ChatMessage>((message) => ({
      id: `message-${message.message_id}`,
      type: message.role === "user" ? "user" : "agent",
      text: message.content,
    }));

  const runConversation = new Map<string, WireInteger>();
  for (const run of snapshot.agent_runs) {
    const runId = run.agent_run_id;
    const owner = run.conversation_id;
    if (isWireInteger(runId) && isWireInteger(owner)) {
      runConversation.set(String(runId), owner);
    }
  }

  const cards = snapshot.generation_jobs
    .filter((job) => {
      if (job.source !== "agent_run") return false;
      if (typeof job.job_id !== "number" && typeof job.job_id !== "string") {
        return false;
      }
      if (
        typeof job.agent_run_id !== "number" &&
        typeof job.agent_run_id !== "string"
      ) {
        return false;
      }
      const owner = runConversation.get(String(job.agent_run_id));
      return owner === undefined || wireIntegersEqual(owner, conversationId);
    })
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

/** 产品规范化失败文案：优先 output.error.message（槽级），回退 job.error.message（Job 级）。 */
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

function isConversationMessage(value: Record<string, unknown>): value is Record<
  string,
  unknown
> & {
  message_id: number | string;
  role: "user" | "assistant";
  content: string;
  sequence_no: number;
} {
  return (
    (typeof value.message_id === "number" ||
      typeof value.message_id === "string") &&
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
