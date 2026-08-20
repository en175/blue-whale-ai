/* ============================================
 * agentSessions 接口：Agent 会话（session 维度，唯一有 worker 执行 Run 的对话服务）
 * 基址 /api/agent/v1/projects/:id/sessions
 * - list/create/snapshot/messages/runs(cancel/retry)/events(SSE)
 * - 返回为裸 JSON（无 {code,msg,data} 包络），统一 fetch + 401 清会话
 * - 事件流为共享连接（引用计数）：StrictMode 双挂载/多处订阅不重复建连
 * ============================================ */
import { readSseResponse, type SseEvent } from './events';
import { newIdempotencyKey } from './jobs';
import { getAccessToken, setSession } from '@/utils/auth';

export type { SseEvent };

/* ============ 类型 ============ */

/** 消息正文块 */
export interface SessionContentBlock {
  type: string;
  text?: string;
  /** 思考过程块（可折叠展示）：steps 为顺序步骤文案 */
  thinking?: { steps?: string[] };
  /**
   * 产卡之前的每一步都走自然语言：追问、需求理解总结与确认都是助手的正文文字，
   * 不再有 understanding / clarify 结构化块。生成卡是唯一的结构化交付物。
   */
  /** 生成卡块（分镜提示词，按 04-侧边栏规范 §5.1） */
  card?: GenerationCardBlock;
}

/** 生成卡：单镜头分镜提示词卡（S2 渲染，S3 手动应用） */
export interface GenerationCardBlock {
  /** 卡片标题 / 镜头编号，如「镜头 1」 */
  shotTitle: string;
  /** 时间范围，如 0-4s */
  timeRange?: string;
  /** 画面描述 */
  visual: string;
  /** 分镜提示词 */
  prompt: string;
  /** 素材引用（@名称） */
  assetRefs?: string[];
  /** 卡片唯一标识（应用动作追踪） */
  cardId?: string;
}

/** 会话记录（列表/创建返回） */
export interface SessionRecord {
  session_id: string;
  context?: { kind?: string; external_project_id?: string };
  title?: string | null;
  phase?: string;
  lifecycle?: string;
  active_run_id?: string | null;
  created_at?: string;
  updated_at?: string;
  etag?: string;
}

/** 会话消息（快照/事件内嵌） */
export interface SessionMessage {
  message_id: string;
  session_id?: string;
  sequence: number;
  role: 'user' | 'assistant' | string;
  content: SessionContentBlock[];
  input_batch_id?: string | null;
  source_run_id?: string | null;
  created_at?: string;
}

/** 运行记录（事件内嵌） */
export interface SessionRun {
  run_id: string;
  session_id?: string;
  status: string;
  failure?: { code?: string; message?: string } | null;
  trace_id?: string | null;
}

/** 会话快照（水合入口） */
export interface SessionSnapshot {
  session: SessionRecord & { title_source?: string; pending_message_count?: number };
  messages: SessionMessage[];
  active_run?: SessionRun | null;
  latest_terminal_run?: SessionRun | null;
  event_cursor?: string;
}

/** 发送消息返回（接纳回执） */
export interface SessionMessageAck {
  message?: SessionMessage;
  run?: SessionRun;
  [key: string]: unknown;
}

/* ============ 基础请求 ============ */

/** 会话维度裸 JSON 请求（401 清会话；非 2xx 抛 Error） */
async function sessionRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`/api/agent/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 401) setSession(null, null);
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      /* 非 JSON 保留原文 */
    }
  }
  if (!res.ok) {
    const msg =
      body && typeof body === 'object'
        ? ((body as Record<string, unknown>).msg as string | undefined) ??
          ((body as Record<string, unknown>).message as string | undefined)
        : undefined;
    const err = new Error(msg ?? `请求失败（${res.status}）`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

/* ============ 会话管理 ============ */

/** 在途去重：StrictMode 双挂载只发一次（创建/快照） */
const ensurePending = new Map<string, Promise<SessionRecord>>();
const snapshotPending = new Map<string, Promise<SessionSnapshot>>();

/** 会话列表 GET /projects/:id/sessions */
export function listSessions(projectId: string): Promise<{ items: SessionRecord[] }> {
  return sessionRequest(`/projects/${encodeURIComponent(projectId)}/sessions`);
}

/** 创建会话 POST /projects/:id/sessions（context 自动绑定 blue_whale_project） */
export function createSession(projectId: string): Promise<SessionRecord> {
  const existed = ensurePending.get(projectId);
  if (existed) return existed;
  const p = sessionRequest<SessionRecord>(`/projects/${encodeURIComponent(projectId)}/sessions`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey() },
    body: '{}',
  }).finally(() => ensurePending.delete(projectId));
  ensurePending.set(projectId, p);
  return p;
}

/** 会话快照 GET /projects/:id/sessions/:sid/snapshot（消息历史 + 事件游标） */
export function fetchSessionSnapshot(projectId: string, sessionId: string): Promise<SessionSnapshot> {
  const key = `${projectId}:${sessionId}`;
  const existed = snapshotPending.get(key);
  if (existed) return existed;
  const p = sessionRequest<SessionSnapshot>(
    `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/snapshot`,
  ).finally(() => snapshotPending.delete(key));
  snapshotPending.set(key, p);
  return p;
}

/** 删除会话 DELETE /projects/:id/sessions/:sid（历史会话下拉「删除」，需二次确认） */
export function deleteSession(projectId: string, sessionId: string): Promise<unknown> {
  return sessionRequest(
    `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
}

/* ============ 消息与运行控制 ============ */

/** 发送消息 POST /projects/:id/sessions/:sid/messages（回复经事件流 assistant.delta 下发） */
export function sendSessionMessage(
  projectId: string,
  sessionId: string,
  text: string,
  signal?: AbortSignal,
): Promise<SessionMessageAck> {
  return sessionRequest(
    `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({ content: [{ type: 'text', text }] }),
      signal,
    },
  );
}

/** 取消运行 POST /projects/:id/sessions/:sid/runs/:runId/cancel */
export function cancelSessionRun(
  projectId: string,
  sessionId: string,
  runId: string,
): Promise<unknown> {
  return sessionRequest(
    `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/cancel`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: '{}',
    },
  );
}

/** 重试运行 POST /projects/:id/sessions/:sid/runs/:runId/retry（仅失败运行可重试） */
export function retrySessionRun(
  projectId: string,
  sessionId: string,
  runId: string,
): Promise<{ run?: SessionRun } & Record<string, unknown>> {
  return sessionRequest(
    `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/retry`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: '{}',
    },
  );
}

/* ============ 事件流（共享连接，引用计数） ============ */

/** 断线重连延时（ms） */
const RETRY_DELAY = 3000;
/** 订阅全部释放后延迟关闭（ms）：覆盖 StrictMode 清理→重建的间隙，避免重复建连/中断请求 */
const IDLE_CLOSE_DELAY = 200;

/** 共享连接句柄 */
interface SessionEventHub {
  controller: AbortController;
  listeners: Set<(ev: SseEvent) => void>;
  cursor: string;
  closeTimer: number;
  retryTimer: number;
  dead: boolean;
}

const hubs = new Map<string, SessionEventHub>();

/** 建立/复用共享连接并循环重连（游标接续；409 游标过期时重新取快照游标） */
function ensureHub(projectId: string, sessionId: string, initialCursor: string): SessionEventHub {
  const key = `${projectId}:${sessionId}`;
  const existed = hubs.get(key);
  if (existed && !existed.dead) {
    if (existed.cursor === '' && initialCursor) existed.cursor = initialCursor;
    return existed;
  }

  const hub: SessionEventHub = {
    controller: new AbortController(),
    listeners: new Set(),
    cursor: initialCursor,
    closeTimer: 0,
    retryTimer: 0,
    dead: false,
  };
  hubs.set(key, hub);

  const base = `/api/agent/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/events`;

  const scheduleRetry = () => {
    if (hub.dead || hub.retryTimer) return;
    hub.retryTimer = window.setTimeout(() => {
      hub.retryTimer = 0;
      void connect();
    }, RETRY_DELAY);
  };

  const connect = async (): Promise<void> => {
    try {
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const after = hub.cursor ? `?after=${encodeURIComponent(hub.cursor)}` : '';
      const res = await fetch(`${base}${after}`, { headers, signal: hub.controller.signal });
      if (res.status === 409) {
        // 游标过期：取最新快照游标后重连
        try {
          const snap = await fetchSessionSnapshot(projectId, sessionId);
          hub.cursor = snap.event_cursor ?? '';
        } catch {
          /* 快照失败维持原游标延时重试 */
        }
        scheduleRetry();
        return;
      }
      if (!res.ok) throw new Error(`SSE 连接失败（${res.status}）`);
      await readSseResponse(res, (ev) => {
        if (ev.id) hub.cursor = ev.id;
        hub.listeners.forEach((l) => l(ev));
      });
    } catch {
      /* 流结束/网络错误/abort：未销毁且有订阅者时延时重连 */
    }
    if (!hub.dead && !hub.controller.signal.aborted && hub.listeners.size > 0) scheduleRetry();
  };

  void connect();
  return hub;
}

/**
 * 订阅会话事件流，返回取消订阅函数
 * 同一会话共享一条连接；最后一个订阅者离开后延时关闭（StrictMode 双挂载零中断）
 */
export function subscribeSessionEvents(
  projectId: string,
  sessionId: string,
  initialCursor: string,
  onEvent: (ev: SseEvent) => void,
): () => void {
  const hub = ensureHub(projectId, sessionId, initialCursor);
  window.clearTimeout(hub.closeTimer);
  hub.listeners.add(onEvent);

  return () => {
    hub.listeners.delete(onEvent);
    if (hub.listeners.size > 0 || hub.dead) return;
    hub.closeTimer = window.setTimeout(() => {
      if (hub.listeners.size > 0) return;
      hub.dead = true;
      window.clearTimeout(hub.retryTimer);
      hub.controller.abort();
      hubs.delete(`${projectId}:${sessionId}`);
    }, IDLE_CLOSE_DELAY);
  };
}
