import type { ProjectSnapshot } from "@/lib/project-recovery";
import type { ChatMessage } from "./types";

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
    .map<ChatMessage>((job) => ({
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
    }));
  return [...messages, ...cards];
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
