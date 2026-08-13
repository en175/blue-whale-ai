import { apiFetch } from "@/lib/api-client";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "payment_required"
  | "completed"
  | "failed"
  | "cancelled"
  | "outcome_unknown";

export type AgentSessionSummary = {
  session_id: string;
  title: string;
  title_source: string;
  phase: string;
  lifecycle: "active" | "archived";
  active_run_id: string | null;
  pending_message_count: number;
  created_at: string;
  updated_at: string;
  etag: string;
};

export type AgentMessage = {
  message_id: string;
  session_id: string;
  sequence: number;
  role: "user" | "assistant";
  content: Array<{ type: "text"; text: string }>;
  input_batch_id: string | null;
  source_run_id: string | null;
  created_at: string;
};

export type AgentRun = {
  run_id: string;
  session_id: string;
  input_batch_id: string;
  attempt_no: number;
  retry_of_run_id: string | null;
  status: AgentRunStatus;
  failure: { code: string; message: string | null } | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  trace_id: string;
};

export type AgentSnapshot = {
  session: AgentSessionSummary;
  messages: AgentMessage[];
  active_run: AgentRun | null;
  latest_terminal_run: AgentRun | null;
  event_cursor: string | null;
};

export type AgentEventEnvelope = {
  schema_version: 1;
  event_id: string;
  cursor: string;
  type: string;
  occurred_at: string;
  session_id: string;
  run_id: string | null;
  payload: Record<string, unknown>;
};

export class AgentClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AgentClientError";
  }
}

async function checkedJson<T>(response: Response, action: string): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new AgentClientError(
      body?.error?.message || `${action}失败 (${response.status})`,
      response.status,
      body?.error?.code,
    );
  }
  return response.json() as Promise<T>;
}

export async function listAgentSessions(
  projectId: string,
): Promise<AgentSessionSummary[]> {
  const response = await apiFetch(
    `/api/agent/v1/projects/${projectId}/sessions`,
  );
  const body = await checkedJson<{ items?: AgentSessionSummary[] }>(
    response,
    "加载 Agent 会话",
  );
  return Array.isArray(body.items) ? body.items : [];
}

export async function createAgentSession(
  projectId: string,
  idempotencyKey: string,
): Promise<AgentSessionSummary> {
  const response = await apiFetch(
    `/api/agent/v1/projects/${projectId}/sessions`,
    {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
    },
  );
  return checkedJson<AgentSessionSummary>(response, "创建 Agent 会话");
}

export async function getAgentSnapshot(
  projectId: string,
  sessionId: string,
): Promise<AgentSnapshot> {
  const response = await apiFetch(
    `/api/agent/v1/projects/${projectId}/sessions/${encodeURIComponent(sessionId)}/snapshot`,
  );
  return checkedJson<AgentSnapshot>(response, "恢复 Agent 会话");
}

export async function acceptAgentMessage(input: {
  projectId: string;
  sessionId: string;
  message: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<{
  message: AgentMessage;
  scheduling: {
    state: "run_created" | "pending";
    input_batch_id: string | null;
    run_id: string | null;
  };
}> {
  const response = await apiFetch(
    `/api/agent/v1/projects/${input.projectId}/sessions/${encodeURIComponent(input.sessionId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        content: [{ type: "text", text: input.message }],
      }),
      headers: { "idempotency-key": input.idempotencyKey },
      signal: input.signal,
    },
  );
  return checkedJson(response, "发送 Agent 消息");
}

export async function runAgentCommand(input: {
  projectId: string;
  sessionId: string;
  runId: string;
  command: "cancel" | "retry" | "resume" | "skip";
  idempotencyKey: string;
}): Promise<unknown> {
  const response = await apiFetch(
    `/api/agent/v1/projects/${input.projectId}/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/${input.command}`,
    {
      method: "POST",
      headers: {
        "idempotency-key": input.idempotencyKey,
        "x-agent-action-id": input.idempotencyKey,
      },
      body: "{}",
    },
  );
  return checkedJson(response, `${input.command} Agent Run`);
}

function parseEventBlock(block: string): AgentEventEnvelope | null {
  const lines = block.replaceAll("\r\n", "\n").split("\n");
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as AgentEventEnvelope;
    return parsed &&
      parsed.schema_version === 1 &&
      typeof parsed.cursor === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function streamAgentEvents(input: {
  projectId: string;
  sessionId: string;
  after: string | null;
  signal: AbortSignal;
  onEvent(event: AgentEventEnvelope): void;
}): Promise<void> {
  const query = input.after ? `?after=${encodeURIComponent(input.after)}` : "";
  const response = await apiFetch(
    `/api/agent/v1/projects/${input.projectId}/sessions/${encodeURIComponent(input.sessionId)}/events${query}`,
    {
      method: "GET",
      signal: input.signal,
      headers: { accept: "text/event-stream" },
    },
  );
  if (!response.ok || !response.body) {
    await checkedJson(response, "连接 Agent 会话事件");
    return;
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (!input.signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value.replaceAll("\r\n", "\n");
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const event = parseEventBlock(block);
      if (event) input.onEvent(event);
    }
  }
}
