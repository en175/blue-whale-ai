/* ============================================
 * conversation 接口：Agent 对话消息发送 + Agent 运行停止/重试 + 计划应用
 * 写操作均携带 Idempotency-Key 幂等头
 * 发送消息兼容两种返回：
 * - 旧版 JSON 包络 {code:200, data:{message_id, agent_run_id,...}}（202 接纳，消息列表由 SSE 驱动）
 * - 新版 NDJSON 流式返回（每行一个 JSON 帧：init/delta/result/system，回复直接随响应体流式下发）
 * ============================================ */
import { apiRequest } from './http';
import { newIdempotencyKey } from './idempotencyKey';
import { handleUnauthorized } from '@/utils/auth';

/** @提及项（发送时可携带） */
export interface MentionPayload {
  /** 引用类型：asset 资产 / scene_card 场景卡 */
  type: 'asset' | 'scene_card';
  /** 资产ID（type=asset 时） */
  asset_id?: string;
  /** 场景卡ID（type=scene_card 时） */
  scene_card_id?: string;
  /** 场景卡版本（type=scene_card 时） */
  scene_card_version?: number;
  /** 显示名称（content 中 @[display_name] 占位符对应） */
  display_name: string;
}

/** 发送消息返回的 @提及 */
export interface MentionData {
  mention_id: number;
  type: string;
  asset_id?: string;
  display_name: string;
}

/** POST 请求体 */
export interface SendMessagePayload {
  /** 客户端消息ID（UUID），幂等去重 */
  client_message_id: string;
  /** 消息文本内容 */
  content: string;
  /** 回复澄清请求ID（Agent 反问时） */
  reply_to_input_request_id?: number;
  /** @提及的资产列表 */
  mentions?: MentionPayload[];
  /** 强制指定创作技能ID */
  forced_creative_skill_id?: string;
  /** 是否为对话总结意图 */
  skill_summarize?: boolean;
}

/** 发送消息返回（HTTP 202 表示已接纳） */
export interface SendMessageData {
  /** 服务端消息ID */
  message_id: number;
  /** Agent 运行ID */
  agent_run_id: number;
  /** 事件游标 */
  cursor: number;
  mentions: MentionData[];
}

/** 生成客户端消息ID */
export function newClientMessageId(): string {
  return crypto.randomUUID();
}

/** 流式返回帧（NDJSON 每行一个 JSON） */
export interface MessageStreamFrame {
  /** 帧类型：init 首帧 / delta 增量 / result 终帧 / system 系统帧 */
  type: string;
  /** 事件名：message.init / message.delta / message.result 等 */
  event?: string;
  /** 服务端消息ID（system 帧可能为 0） */
  messageId?: number;
  /** 消息正文（可能为累积全量，也可能为增量片段） */
  content?: string;
  /** 是否结束 */
  done?: boolean;
}

/**
 * 发送 Agent 对话消息（client_message_id + Idempotency-Key 双重幂等）
 * POST /api/projects/:id/conversation/messages
 * - Content-Type 为 application/json：按旧版包络解析返回 data
 * - 其余（NDJSON 流）：逐行解析帧并经 onFrame 回调派发，流内出现包络对象时仍回退旧结构
 * 返回旧版 data（流式返回时为 null，回复内容已经 onFrame 投影）
 */
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
  // 凭证失效：与 http 层一致——已登录弹窗续接，未登录清会话
  if (res.status === 401) handleUnauthorized();

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    // 旧版 JSON 包络：{code:200, msg, data}
    const body = (await res.json().catch(() => undefined)) as
      | { code?: number; success?: boolean; msg?: string | null; data?: SendMessageData }
      | undefined;
    if (!res.ok || !(body?.code === 200 || body?.success === true)) {
      throw new Error(body?.msg ?? `发送消息失败（${res.status}）`);
    }
    return body?.data ?? null;
  }

  // NDJSON 流式返回：逐行解析派发帧
  if (!res.ok || !res.body) {
    throw new Error(`发送消息失败（${res.status}）`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let legacy: SendMessageData | null = null;

  /** 解析单行：包络对象回退旧结构，其余作为流式帧派发（兼容 SSE data: 前缀） */
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
      /* 无法解析的行跳过 */
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

/* ============ Agent 运行控制 ============ */

/** 停止/重试 Agent 运行返回 */
export interface AgentRunData {
  /** Agent 运行ID（重试时为新运行ID） */
  agent_run_id: number;
  /** 运行状态：queued/stopping 等 */
  status: string;
  /** 事件游标 */
  cursor: number;
  /** 重试次数（retry 返回） */
  retry_count?: number;
}

/** 停止 Agent 运行 POST /api/projects/:id/conversation/agent-runs/:runId/stop */
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

/** 重试 Agent 运行 POST /api/projects/:id/conversation/agent-runs/:runId/retry（仅 failed 状态可重试） */
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
