import type { PromptPreviewSource } from '@lib/contracts/prompt-preview';
import { readSseResponse, type SseEvent } from './events';
import { ApiError, isApiError } from '@/shared/api/http';
import { newIdempotencyKey } from '@/shared/api/idempotencyKey';
import { agentPath, agentUrl, agentMethod } from './agentRoutes';
import { handleUnauthorized } from '@/shared/utils/auth';

export type { SseEvent };


export interface RunActionsRecord {
  actions: {
    tool: string;
    summary: string;
    started_ms: number;
    ended_ms: number | null;
    status: 'ok' | 'failed' | 'rejected';
    substeps?: { id: string; summary: string; started_ms: number; ended_ms: number | null }[];
  }[];
  total_ms: number;
  requirement_stage: boolean;
  outstanding_count: number | null;
}

export interface AskedQuestion {
  no: string;
  title: string;
  ask: string;
  options: { key: string; label: string; note?: string }[];
  recommended: string[];
  multiple: boolean;
  why: string;
}

export interface SessionContentBlock {
  type: string;
  text?: string;
  questions?: AskedQuestion[];
  run_actions?: RunActionsRecord;
  tool?: string;
  summary?: string;
  status?: 'ok' | 'failed' | 'rejected' | 'cancelled';
  started_ms?: number;
  ended_ms?: number | null;
  substeps?: { id: string; summary: string; started_ms: number; ended_ms: number | null }[];
  calls?: number;
  thinking?: { steps?: string[]; reasoning?: string };
  card?: GenerationCardBlock;

  url?: string;
  mime?: string;
  duration?: number;
  name?: string;
  node_id?: string;
  asset_id?: string;
  source?: 'card-ref' | 'card-image' | 'card-voice' | 'card-generation' | 'node';
  resource_type?:
    | '图片'
    | '视频'
    | '音频'
    | '文本节点'
    | '文本引用'
    | '商品卡'
    | '风格卡'
    | '角色卡'
    | '物体卡'
    | '环境卡'
    | '自定义卡'
    | '生成卡'
    | 'text_quote';
  chip_id?: string;

  resource_id?: string;
  media_type?: 'image' | 'video' | 'audio';
  resource_kind?: string;
  display_label?: string;
  resource_text?: string;
  shot_no?: number;
  quote_id?: string;
  prompt_source?: PromptPreviewSource | null;
}

export interface GenerationCardAssetRef {
  assetId: string;
  label: string;
  mediaType: 'image' | 'video';
  marker?: string;
  markerTexts?: string[];
}

export interface GenerationCardBlock {
  source?: PromptPreviewSource;
  shotTitle: string;
  timeRange?: string;
  visual?: string;
  prompt: string;
  assetRefs?: string[];
  assetRefItems?: GenerationCardAssetRef[];
  cardId?: string;
  shotNo?: number;
  targetMedia?: 'image' | 'video';
  aspectRatio?: string;
  targetModel?: string;
  durationSeconds?: number;
  taskLabel?: string;
}

export interface SessionRecord {
  session_id: string;
  context?: { kind?: string; external_project_id?: string };
  title?: string | null;
  phase?: string;
  lifecycle?: string;
  active_run_id?: string | null;
  active_creative_skill_ids?: string[];
  active_task_id?: string;
  created_at?: string;
  updated_at?: string;
  etag?: string;
}

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

export interface SessionRun {
  run_id: string;
  session_id?: string;
  input_batch_id?: string | null;
  status: string;
  failure?: { code?: string; message?: string; retryable?: boolean } | null;
  trace_id?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  token_usage?: unknown;
  context_capacity?: unknown;
  prompt_card_failure?: { code?: string; message?: string } | null;
}


export interface PromptCardShot {
  shot_no: number;
  title: string;
  frame_description?: string;
  prompt_text: string;
  asset_bindings: { asset_ref_id: string; role?: string; strength?: string; note?: string }[];
  prompt_mentions?: { start: number; end: number; index: number; asset_ref_id: string }[];
  generation_suggestions?: {
    target_media?: 'image' | 'video';
    aspect_ratio?: string;
    resolution?: string;
    size?: string;
    duration_seconds?: number;
    count?: number;
  };
}

export interface PromptCardAssetProvenance {
  asset_ref_id: string;
  asset_id: string;
  media_type: 'image' | 'video';
  display_label: string;
  accepted_summary?: string;
}

export interface PromptCardRevisionPayload {
  schema_version: number;
  target_media: 'image' | 'video';
  overview: string;
  shots: PromptCardShot[];
  assets: PromptCardAssetProvenance[];
  target_model?: { family: string; version?: string };
}

export interface PromptCardRevision {
  revision_id: string;
  card_id: string;
  authoring_run_id?: string;
  revision_number: number;
  schema_version: number;
  payload: PromptCardRevisionPayload;
}

export interface PromptCardRevisionSummary {
  revision_id: string;
  revision_number: number;
  authoring_run_id: string;
  created_at: string;
}

export interface PromptCardRecord {
  card_id: string;
  task_id?: string;
  session_id?: string;
  active_revision_id?: string;
  revision_count?: number;
  active_revision?: PromptCardRevision | null;
  revisions?: PromptCardRevisionSummary[];
}



export interface SolutionExecutionRoute {
  model_family: string;
  model_version?: string;
  reason?: string;
  alternatives?: { route: string; tradeoff: string }[];
}

export interface SolutionDeliverySpec {
  aspect_ratio?: string;
  duration_seconds?: number;
  resolution?: string;
}

export interface SolutionCard {
  goal: string;
  target_media: 'image' | 'video';
  direction?: string;
  constraints?: string[];
  asset_roles?: { asset_ref_id: string; role: string }[];
  assumptions: string[];
  execution_route?: SolutionExecutionRoute;
  delivery_spec?: SolutionDeliverySpec;
  next_steps?: string;
  scope?: { kind: 'whole' | 'continuation' | 'new_task' | 'change' | 'revise'; label: string; derived_from?: string; effect?: string };
  segments?: SolutionSegment[];
}

export interface SolutionSegment {
  content: string;
  seconds?: number;
  segment_id?: string;
}

export interface RequirementUnderstanding {
  understanding_id: string;
  task_id?: string;
  derived_from_task_id?: string | null;
  version: number;
  session_id: string;
  proposed_by_run_id: string;
  target_media: 'image' | 'video';
  proposed_summary: string;
  solution_card?: SolutionCard | null;
  status: 'awaiting_confirmation' | 'accepted' | 'superseded';
  accepted_summary?: string | null;
  confirmation_evidence?: { action: 'confirm' | 'correct'; channel: string } | null;
  created_at?: string;
  updated_at?: string;
  confirmed_at?: string | null;
}

export interface SessionSnapshot {
  session: SessionRecord & { title_source?: string; pending_message_count?: number };
  messages: SessionMessage[];
  active_run?: SessionRun | null;
  latest_terminal_run?: SessionRun | null;
  prompt_cards?: PromptCardRecord[];
  requirement_understandings?: RequirementUnderstanding[];
  event_cursor?: string;
}

export interface SessionMessageAck {
  message?: SessionMessage;
  run?: SessionRun;
  [key: string]: unknown;
}


function describeFailure(
  record: Record<string, unknown> | undefined,
  status: number,
): { message: string; code: number | string } {
  const nested = record?.error;
  const source = nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : record;
  const message =
    (typeof source?.msg === 'string' && source.msg ? source.msg : undefined) ??
    (typeof source?.message === 'string' && source.message ? source.message : undefined) ??
    `请求失败（${status}）`;
  const code =
    typeof source?.code === 'string' || typeof source?.code === 'number' ? source.code : status;
  return { message, code };
}

async function sessionRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/agent/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
    }
  }
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  const failure = res.ok ? null : describeFailure(record, res.status);
  const errorCode = typeof record?.error_code === 'string' ? record.error_code : undefined;
  if (errorCode === 'account_disabled' || (res.status === 401 && failure?.code !== 'capability_required')) {
    handleUnauthorized(errorCode);
  }
  if (failure) throw new ApiError(res.status, failure.message, failure.code);
  return body as T;
}


const ensurePending = new Map<string, Promise<SessionRecord>>();
const snapshotPending = new Map<string, Promise<SessionSnapshot>>();

export function listSessions(projectId: string): Promise<{ items: SessionRecord[] }> {
  return sessionRequest(agentPath('list_sessions', projectId));
}

export function createSession(projectId: string): Promise<SessionRecord> {
  const existed = ensurePending.get(projectId);
  if (existed) return existed;
  const p = sessionRequest<SessionRecord>(agentPath('create_session', projectId), {
    method: agentMethod('create_session'),
    headers: { 'Idempotency-Key': newIdempotencyKey() },
    body: '{}',
  }).finally(() => ensurePending.delete(projectId));
  ensurePending.set(projectId, p);
  return p;
}

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

const REVISION_IDS_PER_READ = 20;

export async function fetchPromptCardRevisions(
  projectId: string,
  sessionId: string,
  revisionIds: string[],
): Promise<PromptCardRevision[]> {
  const batches: string[][] = [];
  for (let i = 0; i < revisionIds.length; i += REVISION_IDS_PER_READ) {
    batches.push(revisionIds.slice(i, i + REVISION_IDS_PER_READ));
  }
  const results = await Promise.all(
    batches.map((ids) =>
      sessionRequest<{ revisions?: PromptCardRevision[] }>(
        `${agentPath('list_prompt_card_revisions', projectId, { session_id: sessionId })}?revision_ids=${encodeURIComponent(ids.join(','))}`,
      ),
    ),
  );
  return results.flatMap((result) => result.revisions ?? []);
}

export function listSessionRuns(
  projectId: string,
  sessionId: string,
): Promise<{ items: SessionRun[]; next_cursor?: string | null }> {
  return sessionRequest(agentPath('session_runs', projectId, { session_id: sessionId }));
}

async function readSessionEtag(projectId: string, sessionId: string): Promise<string> {
  const session = await sessionRequest<SessionRecord>(
    agentPath('get_session', projectId, { session_id: sessionId }),
  );
  if (!session?.etag) throw new ApiError(500, '读取会话版本失败，请刷新页面重试', 'missing_etag');
  return session.etag;
}

export async function deleteSession(projectId: string, sessionId: string, etag?: string): Promise<void> {
  const path = agentPath('delete_session', projectId, { session_id: sessionId });
  const method = agentMethod('delete_session');
  const submit = (tag: string) =>
    sessionRequest<void>(path, {
      method,
      headers: { 'Idempotency-Key': newIdempotencyKey(), 'If-Match': tag },
    });

  try {
    await submit(etag ?? (await readSessionEtag(projectId, sessionId)));
  } catch (e) {
    if (!isApiError(e) || e.status !== 412) throw e;
    await submit(await readSessionEtag(projectId, sessionId));
  }
}


export interface OutboundAssetRef {
  asset_id: string;
  media_type: 'image' | 'video';
  display_label?: string;
}

export interface OutboundSkillRef {
  skill_id: string;
  name: string;
  type?: string;
}

const TRANSPORT_STRIP_FIELDS = ['chip_id', 'name', 'type', 'mime', 'duration'] as const;

function stripInternalFields(block: SessionContentBlock): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block)) {
    if (!TRANSPORT_STRIP_FIELDS.includes(key as typeof TRANSPORT_STRIP_FIELDS[number])) {
      result[key] = value;
    }
  }
  return result;
}

const RESOURCE_KIND_TO_CONTRACT: Record<string, 'asset' | 'card'> = {
  图片: 'asset',
  视频: 'asset',
  音频: 'asset',
  商品卡: 'card',
  风格卡: 'card',
  角色卡: 'card',
  物体卡: 'card',
  环境卡: 'card',
  自定义卡: 'card',
  生成卡: 'card',
};

function toReferencePart(block: SessionContentBlock): Record<string, unknown> | null {
  const rest = stripInternalFields(block);
  if (block.quote_id) {
    return {
      ...rest,
      type: 'resource_ref',
      resource_type: 'text_quote',
      resource_kind: block.resource_type ?? '文本引用',
      resource_id: block.quote_id,
    };
  }
  if (block.asset_id && (block.media_type === 'image' || block.media_type === 'video')) {
    const restWithoutUrl = { ...rest };
    delete restWithoutUrl.url;
    return { ...restWithoutUrl, type: 'asset_ref', asset_id: block.asset_id, media_type: block.media_type };
  }
  const resourceId = block.resource_id || block.node_id || block.asset_id;
  if (!resourceId) return null;
  const kind = block.resource_type;
  return {
    ...rest,
    type: 'resource_ref',
    resource_type: kind ? RESOURCE_KIND_TO_CONTRACT[kind] ?? 'card' : 'asset',
    resource_id: resourceId,
    ...(kind ? { resource_kind: kind } : {}),
  };
}

export function sendSessionMessage(
  projectId: string,
  sessionId: string,
  content: SessionContentBlock[],
  options?: {
    forcedCreativeSkillId?: string;
    signal?: AbortSignal;
    resourceRef?: SessionContentBlock[];
    skillRef?: OutboundSkillRef;
  },
): Promise<SessionMessageAck> {
  const { forcedCreativeSkillId: forcedSkillId, signal, resourceRef, skillRef } = options ?? {};
  const hasInlineReferences = content.some((block) => block.type !== 'text' || block.quote_id);
  const parts: Record<string, unknown>[] = [
    ...content.flatMap((block): Record<string, unknown>[] => {
      if (block.type === 'text' && !block.quote_id) {
        return (block.text ?? '').trim()
          ? [{ type: 'text', text: hasInlineReferences ? block.text! : block.text!.trim() }]
          : [];
      }
      const part = toReferencePart(block);
      return part ? [part] : [];
    }),
    ...(resourceRef ?? []).map(toReferencePart).filter((part): part is Record<string, unknown> => part !== null),
    ...(skillRef ? [{ type: 'skill_ref', skill_id: skillRef.skill_id, name: skillRef.name }] : []),
  ];
  const body: Record<string, unknown> = { content: parts };
  if (forcedSkillId) {
    body.forced_creative_skill_id = forcedSkillId;
  }
  return sessionRequest<SessionMessageAck>(
    agentPath('send_message', projectId, { session_id: sessionId }),
    {
      method: agentMethod('send_message'),
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify(body),
      signal,
    },
  ).then((resp) => {
    console.log('[agent messages] response:', resp);
    return resp;
  });
}

export function confirmSolutionCard(
  projectId: string,
  sessionId: string,
  understandingId: string,
  version: number,
): Promise<{ understanding: RequirementUnderstanding; scheduling?: { state: string; run?: SessionRun } | null }> {
  return sessionRequest(
    agentPath('confirm_requirement_understanding', projectId, {
      session_id: sessionId,
      understanding_id: understandingId,
      version: String(version),
    }),
    {
      method: agentMethod('confirm_requirement_understanding'),
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({ action_id: newIdempotencyKey() }),
    },
  );
}

export function voidSolutionCard(
  projectId: string,
  sessionId: string,
  understandingId: string,
  version: number,
  note?: string,
): Promise<{ understanding: RequirementUnderstanding; scheduling?: { state: string; run?: SessionRun } | null }> {
  return sessionRequest(
    agentPath('void_requirement_understanding', projectId, {
      session_id: sessionId,
      understanding_id: understandingId,
      version: String(version),
    }),
    {
      method: agentMethod('void_requirement_understanding'),
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({ action_id: newIdempotencyKey(), ...(note ? { note } : {}) }),
    },
  );
}

export function cancelSession(projectId: string, sessionId: string): Promise<unknown> {
  return sessionRequest(
    agentPath('cancel_session', projectId, { session_id: sessionId }),
    {
      method: agentMethod('cancel_session'),
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({ action_id: newIdempotencyKey() }),
    },
  );
}

export function setSessionCreativeSkills(
  projectId: string,
  sessionId: string,
  creativeSkillIds: string[],
  etag: string,
): Promise<SessionRecord> {
  return sessionRequest(
    agentPath('set_session_creative_skills', projectId, { session_id: sessionId }),
    {
      method: agentMethod('set_session_creative_skills'),
      headers: { 'Idempotency-Key': newIdempotencyKey(), 'If-Match': etag },
      body: JSON.stringify({ creative_skill_ids: creativeSkillIds }),
    },
  );
}

export function cancelSessionRun(projectId: string, runId: string): Promise<unknown> {
  return sessionRequest(
    agentPath('cancel_run', projectId, { run_id: runId }),
    {
      method: agentMethod('cancel_run'),
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({ action_id: newIdempotencyKey() }),
    },
  );
}

export function retrySessionRun(
  projectId: string,
  runId: string,
): Promise<{ run?: SessionRun } & Record<string, unknown>> {
  return sessionRequest(
    agentPath('retry_run', projectId, { run_id: runId }),
    {
      method: agentMethod('retry_run'),
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({ action_id: newIdempotencyKey() }),
    },
  );
}



const RETRY_BASE_DELAY = 1000;
const RETRY_MAX_DELAY = 15000;
const IDLE_TIMEOUT = 40000;
const IDLE_CLOSE_DELAY = 200;

interface SessionEventHub {
  controller: AbortController;
  attemptController: AbortController | null;
  listeners: Set<(ev: SseEvent) => void>;
  cursor: string;
  closeTimer: number;
  retryTimer: number;
  attempt: number;
  idleTimer: number;
  dead: boolean;
}

const hubs = new Map<string, SessionEventHub>();

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
    const armIdleWatchdog = () => {
      window.clearTimeout(hub.idleTimer);
      hub.idleTimer = window.setTimeout(() => attempt.abort(), IDLE_TIMEOUT);
    };
    try {
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      const after = hub.cursor ? `?after=${encodeURIComponent(hub.cursor)}` : '';
      armIdleWatchdog();
      const res = await fetch(`${base}${after}`, { headers, signal: attempt.signal });
      if (res.status === 409) {
        try {
          const snap = await fetchSessionSnapshot(projectId, sessionId);
          hub.cursor = snap.event_cursor ?? '';
        } catch {
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
          hub.attempt = 0;
          armIdleWatchdog();
        },
      );
    } catch {
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
      hub.controller.abort();
      hubs.delete(`${projectId}:${sessionId}`);
    }, IDLE_CLOSE_DELAY);
  };
}
