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
    .map<ChatMessage>((job) => {
      const asset = generationAsset(snapshot, job);
      return {
        id: `generation-job-${String(job.job_id)}`,
        type: "card",
        text: generationPrompt(job.input),
        meta: "图片生成",
        status:
          job.status === "failed"
            ? "failed"
            : job.status === "succeeded"
              ? "normal"
              : "generating",
        ...(asset
          ? { assetId: String(asset.asset_id), imageUrl: asset.access_url }
          : {}),
      };
    });
  return [...messages, ...cards];
}

export function projectSnapshotToCanvasNodes(
  snapshot: ProjectSnapshot,
  persistedNodes: NodeItem[],
): NodeItem[] {
  const nodes = [...persistedNodes];
  snapshot.generation_jobs.forEach((job, index) => {
    if (
      (job.source !== "agent_run" && job.source !== "bottom_dock") ||
      job.type !== "image" ||
      job.status !== "succeeded" ||
      (typeof job.job_id !== "number" && typeof job.job_id !== "string")
    ) {
      return;
    }
    const asset = generationAsset(snapshot, job);
    if (!asset) return;
    const assetId = String(asset.asset_id);
    const nodeId = `generation-job-${String(job.job_id)}-slot-0`;
    const existingIndex = nodes.findIndex(
      (node) => node.assetId === assetId || node.id === nodeId,
    );
    if (existingIndex >= 0) {
      nodes[existingIndex] = {
        ...nodes[existingIndex],
        assetId,
        imageUrl: asset.access_url,
      };
      return;
    }
    const { width, height } = parseAspectRatio(
      generationAspectRatio(job.input),
    );
    nodes.push({
      id: nodeId,
      type: "image",
      position: { x: 48 + index * 32, y: 48 + index * 32 },
      width,
      height,
      content: generationPrompt(job.input),
      assetId,
      imageUrl: asset.access_url,
    });
  });
  return nodes;
}

function generationAsset(
  snapshot: ProjectSnapshot,
  job: Record<string, unknown>,
): ProjectSnapshot["assets"][string] | null {
  const outputs = Array.isArray(job.outputs) ? job.outputs : [];
  const output = outputs.find(
    (value) =>
      !!value &&
      typeof value === "object" &&
      (value as Record<string, unknown>).slot_index === 0,
  ) as Record<string, unknown> | undefined;
  const assetId = output?.asset_id;
  if (typeof assetId !== "number" && typeof assetId !== "string") return null;
  return snapshot.assets[String(assetId)] ?? null;
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
