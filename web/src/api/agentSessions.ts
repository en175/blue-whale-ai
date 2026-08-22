/* ============================================
 * agentSessions 接口：Agent 会话（session 维度，唯一有 worker 执行 Run 的对话服务）
 * 基址 /api/agent/v1/projects/:id/sessions
 * - list/create/snapshot/messages/runs(cancel/retry)/events(SSE)
 * - 返回为裸 JSON（无 {code,msg,data} 包络），统一 fetch + 401 清会话
 * - 事件流为共享连接（引用计数）：StrictMode 双挂载/多处订阅不重复建连
 * ============================================ */
import { readSseResponse, type SseEvent } from './events';
import { ApiError } from './http';
import { newIdempotencyKey } from './jobs';
import { agentPath, agentUrl } from './agentRoutes';
import { getAccessToken, setSession } from '@/utils/auth';

export type { SseEvent };

/* ============ 类型 ============ */

/** 消息正文块 */
export interface SessionContentBlock {
  type: string;
  text?: string;
  /**
   * 思考过程块（可折叠展示）。
   *
   * `steps` 是服务端选的模板文案，`reasoning` 是模型自己的原话（assistant.reasoning.delta，
   * IKA3M6）。两个字段分开，因为可信度不一样：模板是我们的承诺，思考是模型随口说的。
   * `reasoning` 只活在当前会话的内存里——服务端不持久化它，刷新页面就没有了。
   */
  thinking?: { steps?: string[]; reasoning?: string };
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

/* ---- 生成卡批次（agent 侧 Prompt Card Revision Schema V3 的原样投影） ----
 * 这里刻意保留 agent 的字段名与结构，不在传输层改形状：翻译成侧边栏卡片模型的动作
 * 集中在 useAgentSession 的映射函数里，只有一处需要跟着协议变。 */

/** 单镜头（V3 $defs.shotCard） */
export interface PromptCardShot {
  shot_no: number;
  title: string;
  frame_description: string;
  prompt_text: string;
  asset_bindings: { asset_ref_id: string; role?: string; strength?: string; note?: string }[];
  generation_suggestions?: {
    target_media?: 'image' | 'video';
    aspect_ratio?: string;
    resolution?: string;
    size?: string;
    duration_seconds?: number;
    count?: number;
  };
}

/** 素材出处（V3 $defs.assetProvenance）：asset_ref_id → 可读名称的唯一来源 */
export interface PromptCardAssetProvenance {
  asset_ref_id: string;
  asset_id: string;
  asset_version: string;
  media_type: 'image' | 'video';
  display_label: string;
  accepted_summary?: string;
}

/** 修订版正文：一段总览 + 若干单镜头卡 */
export interface PromptCardRevisionPayload {
  schema_version: number;
  target_media: 'image' | 'video';
  overview: string;
  shots: PromptCardShot[];
  assets: PromptCardAssetProvenance[];
}

/** 快照里的生成卡组：一个 Session 一组，active_revision 是当前生效版本 */
export interface PromptCardRecord {
  card_id: string;
  session_id?: string;
  active_revision_id?: string;
  revision_count?: number;
  active_revision?: {
    revision_id: string;
    card_id: string;
    authoring_run_id?: string;
    revision_number: number;
    schema_version: number;
    payload: PromptCardRevisionPayload;
  } | null;
}

/** 会话快照（水合入口） */
export interface SessionSnapshot {
  session: SessionRecord & { title_source?: string; pending_message_count?: number };
  messages: SessionMessage[];
  active_run?: SessionRun | null;
  latest_terminal_run?: SessionRun | null;
  /** 生成卡正文只在快照里，事件只带 card_id / revision 引用，拿到事件后必须回查这里 */
  prompt_cards?: PromptCardRecord[];
  event_cursor?: string;
}

/** 发送消息返回（接纳回执） */
export interface SessionMessageAck {
  message?: SessionMessage;
  run?: SessionRun;
  [key: string]: unknown;
}

/* ============ 基础请求 ============ */

/** 会话维度裸 JSON 请求（401 清会话；非 2xx 抛 ApiError，供调用方按 status/code 分支） */
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
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      /* 非 JSON 保留原文 */
    }
  }
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  // Agent 的 capability_required 也使用 401，但它表示缺少 per-Run 能力券，不是用户登录失效。
  if (res.status === 401 && record?.code !== 'capability_required') setSession(null, null);
  if (!res.ok) {
    const message =
      (typeof record?.msg === 'string' ? record.msg : undefined) ??
      (typeof record?.message === 'string' ? record.message : undefined) ??
      `请求失败（${res.status}）`;
    const code =
      typeof record?.code === 'string' || typeof record?.code === 'number' ? record.code : res.status;
    throw new ApiError(res.status, message, code);
  }
  return body as T;
}

/* ============ 会话管理 ============ */

/** 在途去重：StrictMode 双挂载只发一次（创建/快照） */
const ensurePending = new Map<string, Promise<SessionRecord>>();
const snapshotPending = new Map<string, Promise<SessionSnapshot>>();

/** 会话列表 GET /projects/:id/sessions */
export function listSessions(projectId: string): Promise<{ items: SessionRecord[] }> {
  return sessionRequest(agentPath('list_sessions', projectId));
}

/** 创建会话 POST /projects/:id/sessions（context 自动绑定 blue_whale_project） */
export function createSession(projectId: string): Promise<SessionRecord> {
  const existed = ensurePending.get(projectId);
  if (existed) return existed;
  const p = sessionRequest<SessionRecord>(agentPath('create_session', projectId), {
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
    agentPath('session_snapshot', projectId, { session_id: sessionId }),
  ).finally(() => snapshotPending.delete(key));
  snapshotPending.set(key, p);
  return p;
}

/** 删除会话 DELETE /projects/:id/sessions/:sid（历史会话下拉「删除」，需二次确认） */
export function deleteSession(projectId: string, sessionId: string): Promise<unknown> {
  return sessionRequest(
    agentPath('delete_session', projectId, { session_id: sessionId }),
    { method: 'DELETE' },
  );
}

/* ============ 消息与运行控制 ============ */

/** 发送消息 POST /projects/:id/sessions/:sid/messages（回复经事件流 assistant.delta 下发）
 * options.forcedCreativeSkillId：一次性 Use——为该消息创建的目标 Run 强制激活该 Skill
 * （激活契约 §2：可缺省；缺省即普通消息，wire 字段名 forced_creative_skill_id）。 */
export function sendSessionMessage(
  projectId: string,
  sessionId: string,
  text: string,
  options?: { forcedCreativeSkillId?: string; signal?: AbortSignal },
): Promise<SessionMessageAck> {
  const { forcedCreativeSkillId, signal } = options ?? {};
  return sessionRequest(
    agentPath('send_message', projectId, { session_id: sessionId }),
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({
        content: [{ type: 'text', text }],
        ...(forcedCreativeSkillId ? { forced_creative_skill_id: forcedCreativeSkillId } : {}),
      }),
      signal,
    },
  );
}

/**
 * 取消本会话当前在做的事 POST /projects/:id/sessions/:sid/cancel（IKACCL）
 *
 * 会话级而非 Run 级：从点发送到拿到 runId 之间没有 id 可用，而那正是用户最想按取消的几秒。
 * 「当前哪个 Run 活着」是服务端的知识，不该要求客户端先持有它才能取消。
 *
 * 服务端会一并丢弃排在后面还没调度的输入——否则取消完那个 Run，队列里的输入会立刻被
 * 捞起来建新 Run，用户以为停住了却又跑起来。
 *
 * 幂等：没有在跑的东西时返回成功而非 404。
 */
export function cancelSession(projectId: string, sessionId: string): Promise<unknown> {
  return sessionRequest(
    agentPath('cancel_session', projectId, { session_id: sessionId }),
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({ action_id: newIdempotencyKey() }),
    },
  );
}

/**
 * 取消指定运行 POST /projects/:id/runs/:runId/cancel
 *
 * 路径**不含** /sessions/:sid：agent 的 Run 级路由挂在 /projects/:pid 之下、与 sessions 平级
 * （见 agent-rest-api-v1.md）。此前这里多写了一段 sessions 前缀，请求永远匹配不到路由；
 * body 也只有 `{}`，缺 `action_id`，即便路径对了也会被 422 拒掉。
 * 结果是取消按钮从来没有真正生效过——UI 变了形态，请求却打在 404 上。
 */
export function cancelSessionRun(projectId: string, runId: string): Promise<unknown> {
  return sessionRequest(
    agentPath('cancel_run', projectId, { run_id: runId }),
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({ action_id: newIdempotencyKey() }),
    },
  );
}

/** 重试运行 POST /projects/:id/runs/:runId/retry（仅失败运行可重试）。路径与 body 同上，此前同样两处都错。 */
export function retrySessionRun(
  projectId: string,
  runId: string,
): Promise<{ run?: SessionRun } & Record<string, unknown>> {
  return sessionRequest(
    agentPath('retry_run', projectId, { run_id: runId }),
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({ action_id: newIdempotencyKey() }),
    },
  );
}

/* ============ 需求理解确认门（ui_action 通道） ============ */

/** 需求理解投影（agent requirementUnderstandingView；确认门结构化 UI 数据源） */
export interface RequirementUnderstanding {
  understanding_id: string;
  version: number;
  session_id?: string;
  proposed_by_run_id?: string;
  target_media?: 'image' | 'video';
  proposed_summary: string;
  proposed_options?: { id: string; label: string }[];
  status: string;
  accepted_summary?: string | null;
  confirmed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** 待确认需求理解列表 GET .../requirement-understandings（确认门恢复水合用） */
export function fetchRequirementUnderstandings(
  projectId: string,
  sessionId: string,
): Promise<{ items: RequirementUnderstanding[] }> {
  return sessionRequest(
    agentPath('list_requirement_understandings', projectId, { session_id: sessionId }),
  );
}

/** 确认需求理解 POST .../requirement-understandings/:id/versions/:v/actions/confirm（ui_action 通道） */
export function confirmRequirementUnderstanding(
  projectId: string,
  sessionId: string,
  understandingId: string,
  version: number,
  actionId: string,
): Promise<{ understanding: RequirementUnderstanding }> {
  return sessionRequest(
    agentPath('confirm_requirement_understanding', projectId, { session_id: sessionId, understanding_id: understandingId, version }),
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({ action_id: actionId }),
    },
  );
}

/** 修改需求理解 POST .../actions/correct（以用户替换文本重新提议，需 action_id + accepted_summary） */
export function correctRequirementUnderstanding(
  projectId: string,
  sessionId: string,
  understandingId: string,
  version: number,
  actionId: string,
  acceptedSummary: string,
): Promise<{ understanding: RequirementUnderstanding }> {
  return sessionRequest(
    agentPath('correct_requirement_understanding', projectId, { session_id: sessionId, understanding_id: understandingId, version }),
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({ action_id: actionId, accepted_summary: acceptedSummary }),
    },
  );
}

/* ============ 事件流（共享连接，引用计数） ============ */

/** 断线重连基准延时（ms）：实际延时按尝试次数指数退避并叠加抖动 */
const RETRY_BASE_DELAY = 1000;
/** 重连延时上限（ms） */
const RETRY_MAX_DELAY = 15000;
/**
 * 空闲看门狗（ms）：agent 每 15s 发一次心跳，超过这个时长仍无任何字节到达，
 * 就判定连接已经半死——中间层掐流却没给 EOF 时，reader 既不 resolve 也不 reject，
 * 仅靠「流结束」回调永远等不到重连（IKA2V3）。此时主动断开并带游标重连。
 */
const IDLE_TIMEOUT = 40000;
/** 订阅全部释放后延迟关闭（ms）：覆盖 StrictMode 清理→重建的间隙，避免重复建连/中断请求 */
const IDLE_CLOSE_DELAY = 200;

/** 共享连接句柄 */
interface SessionEventHub {
  /** hub 生命周期信号：仅在最后一个订阅者离开、hub 销毁时 abort */
  controller: AbortController;
  /** 当前这一次连接尝试的信号：看门狗超时或 hub 销毁时 abort，不影响后续重连 */
  attemptController: AbortController | null;
  listeners: Set<(ev: SseEvent) => void>;
  cursor: string;
  closeTimer: number;
  retryTimer: number;
  /** 连续失败次数，用于指数退避；收到任何数据即归零 */
  attempt: number;
  idleTimer: number;
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
    attemptController: null,
    listeners: new Set(),
    cursor: initialCursor,
    closeTimer: 0,
    retryTimer: 0,
    attempt: 0,
    idleTimer: 0,
    dead: false,
  };
  hubs.set(key, hub);

  const base = agentUrl('session_events', projectId, { session_id: sessionId });

  const scheduleRetry = () => {
    if (hub.dead || hub.retryTimer) return;
    // 指数退避 + 抖动：上游持续不可用时不再每 3s 敲一次，同时避免多标签页同时重连
    const backoff = Math.min(RETRY_BASE_DELAY * 2 ** hub.attempt, RETRY_MAX_DELAY);
    hub.attempt += 1;
    hub.retryTimer = window.setTimeout(() => {
      hub.retryTimer = 0;
      void connect();
    }, backoff * (0.5 + Math.random() * 0.5));
  };

  const connect = async (): Promise<void> => {
    if (hub.dead || hub.controller.signal.aborted) return;
    const attempt = new AbortController();
    hub.attemptController = attempt;
    const abortAttempt = () => attempt.abort();
    hub.controller.signal.addEventListener('abort', abortAttempt, { once: true });
    /** 每次收到字节（含心跳）重置；超时视为连接半死，断开后走带游标重连 */
    const armIdleWatchdog = () => {
      window.clearTimeout(hub.idleTimer);
      hub.idleTimer = window.setTimeout(() => attempt.abort(), IDLE_TIMEOUT);
    };
    try {
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const after = hub.cursor ? `?after=${encodeURIComponent(hub.cursor)}` : '';
      armIdleWatchdog();
      const res = await fetch(`${base}${after}`, { headers, signal: attempt.signal });
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
      armIdleWatchdog();
      await readSseResponse(
        res,
        (ev) => {
          if (ev.id) hub.cursor = ev.id;
          hub.listeners.forEach((l) => l(ev));
        },
        () => {
          // 有字节到达即认定连接健康：重置看门狗并让退避归零
          hub.attempt = 0;
          armIdleWatchdog();
        },
      );
    } catch {
      /* 流结束/网络错误/看门狗超时：未销毁且有订阅者时延时重连 */
    } finally {
      window.clearTimeout(hub.idleTimer);
      hub.controller.signal.removeEventListener('abort', abortAttempt);
      if (hub.attemptController === attempt) hub.attemptController = null;
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
      window.clearTimeout(hub.idleTimer);
      // abort hub 信号会连带中止进行中的那次连接尝试（connect 里已挂监听）
      hub.controller.abort();
      hubs.delete(`${projectId}:${sessionId}`);
    }, IDLE_CLOSE_DELAY);
  };
}
