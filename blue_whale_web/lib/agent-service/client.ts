import { apiFetch } from "@/lib/api-client";

export async function createAgentSession(projectId: string): Promise<string> {
  const response = await apiFetch(`/api/agent/v1/projects/${projectId}/sessions`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(`创建 Agent 会话失败 (${response.status})`);
  const body = (await response.json()) as { session_id?: unknown };
  if (typeof body.session_id !== "string") throw new Error("Agent 会话响应无效");
  return body.session_id;
}

export type AgentStreamEvent =
  | { event: "message.delta"; data: { delta: string; trace_id: string } }
  | { event: "message.completed"; data: { content: string; trace_id: string } }
  | { event: "run.failed"; data: { error: { message: string }; trace_id: string } };

export async function streamAgentMessage(
  projectId: string,
  sessionId: string,
  message: string,
  signal: AbortSignal,
  onEvent: (event: AgentStreamEvent) => void,
) {
  const response = await apiFetch(
    `/api/agent/v1/projects/${projectId}/sessions/${encodeURIComponent(sessionId)}/messages`,
    { method: "POST", body: JSON.stringify({ message }), signal },
  );
  if (!response.ok || !response.body) {
    throw new Error(`Agent 回复失败 (${response.status})`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const name = /^event: (.+)$/m.exec(block)?.[1];
      const raw = /^data: (.+)$/m.exec(block)?.[1];
      if (name && raw) onEvent({ event: name, data: JSON.parse(raw) } as AgentStreamEvent);
    }
  }
}
