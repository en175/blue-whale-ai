import type { ProjectSnapshot } from "@/lib/project-recovery";
import type { ChatMessage, NodeItem } from "./types";
import { parseAspectRatio } from "./aspectRatio";

export function projectSnapshotToChatMessages(
  snapshot: ProjectSnapshot,
): ChatMessage[] {
  const messages = snapshot.conversation_messages
    .filter(isConversationMessage)
    .sort((left, right) => left.sequence_no - right.sequence_no)
    .map<ChatMessage>((message) => ({
      id: `message-${message.message_id}`,
      type: message.role === "user" ? "user" : "agent",
      text: message.content,
    }));
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
    if (
      (job.source !== "agent_run" && job.source !== "bottom_dock") ||
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
  const outputs = Array.isArray(job.outputs)
    ? job.outputs.filter(
        (output): output is Record<string, unknown> =>
          !!output &&
          typeof output === "object" &&
          typeof (output as Record<string, unknown>).slot_index === "number",
      )
    : [];
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
): "normal" | "generating" | "failed" {
  if (output.status === "succeeded") return "normal";
  if (output.status === "failed") return "failed";
  if (output.asset_id !== null && output.asset_id !== undefined)
    return "normal";
  if (job.status === "failed") return "failed";
  return "generating";
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

function generationAspectRatio(input: unknown): string {
  if (input && typeof input === "object") {
    const aspectRatio = (input as Record<string, unknown>).aspect_ratio;
    if (typeof aspectRatio === "string") return aspectRatio;
  }
  return "1:1";
}
