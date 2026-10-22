import { apiRequest } from '@/shared/api/http';
import { newIdempotencyKey } from '@/shared/api/idempotencyKey';
import { handleUnauthorized } from '@/shared/utils/auth';

export interface MentionPayload {
  type: 'asset' | 'scene_card';
  asset_id?: string;
  scene_card_id?: string;
  scene_card_version?: number;
  display_name: string;
}

export interface MentionData {
  mention_id: number;
  type: string;
  asset_id?: string;
  display_name: string;
}

export interface SendMessagePayload {
  client_message_id: string;
  content: string;
  reply_to_input_request_id?: number;
  mentions?: MentionPayload[];
  forced_creative_skill_id?: string;
  skill_summarize?: boolean;
}

export interface SendMessageData {
  message_id: number;
  agent_run_id: number;
  cursor: number;
  mentions: MentionData[];
}

export function newClientMessageId(): string {
  return crypto.randomUUID();
}

export interface MessageStreamFrame {
  type: string;
  event?: string;
  messageId?: number;
  content?: string;
  done?: boolean;
}

export async function sendConversationMessage(
  projectId: string,
  payload: Omit<SendMessagePayload, 'client_message_id'> & { client_message_id?: string },
  onFrame?: (frame: MessageStreamFrame) => void,
  signal?: AbortSignal,
): Promise<SendMessageData | null> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/conversation/messages`,
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': newIdempotencyKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ client_message_id: newClientMessageId(), ...payload }),
      signal,
    },
  );
  if (res.status === 401) {
    let errorCode: string | undefined;
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      const failure = (await res.clone().json().catch(() => undefined)) as { error_code?: unknown } | undefined;
      if (typeof failure?.error_code === 'string') errorCode = failure.error_code;
    }
    handleUnauthorized(errorCode);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await res.json().catch(() => undefined)) as
      | { code?: number; success?: boolean; msg?: string | null; data?: SendMessageData }
      | undefined;
    if (!res.ok || !(body?.code === 200 || body?.success === true)) {
      throw new Error(body?.msg ?? `发送消息失败（${res.status}）`);
    }
    return body?.data ?? null;
  }

  if (!res.ok || !res.body) {
    throw new Error(`发送消息失败（${res.status}）`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let legacy: SendMessageData | null = null;

  const handleLine = (line: string) => {
    let raw = line.trim();
    if (!raw) return;
    if (raw.startsWith('data:')) raw = raw.slice(5).trim();
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (obj && typeof obj === 'object' && ('code' in obj || 'success' in obj)) {
        legacy = (obj.data as SendMessageData) ?? null;
        return;
      }
      onFrame?.(obj as unknown as MessageStreamFrame);
    } catch {
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    lines.forEach(handleLine);
  }
  if (buffer) handleLine(buffer);
  return legacy;
}


export interface AgentRunData {
  agent_run_id: number;
  status: string;
  cursor: number;
  retry_count?: number;
}

export function stopAgentRun(
  projectId: string,
  runId: number | string,
): Promise<AgentRunData> {
  return apiRequest<AgentRunData>(
    `/api/projects/${encodeURIComponent(projectId)}/conversation/agent-runs/${runId}/stop`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: '{}',
    },
  );
}

export function retryAgentRun(
  projectId: string,
  runId: number | string,
): Promise<AgentRunData> {
  return apiRequest<AgentRunData>(
    `/api/projects/${encodeURIComponent(projectId)}/conversation/agent-runs/${runId}/retry`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: '{}',
    },
  );
}
