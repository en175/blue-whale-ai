/* ============================================
 * agentSessions.mock — Agent 会话本地 mock（dev 交互驱动）
 * 与 agentSessions.ts 同签名。后端 /api/agent/v1 尚未实现（S4 补齐），
 * 本地 dev 下用本 mock 回放原型流程（docs/projects/agent-v0/prototype/app.js），
 * 驱动 AgentPanel 交互开发（S1 思考过程/追问/确认门，S2 生成卡由后续扩展）。
 * 事件类型与真实链路一致；S4 后端就绪后切换真实实现即可。
 * ============================================ */
import type {
  SessionMessage,
  SessionRecord,
  SessionRun,
  SessionSnapshot,
  SessionMessageAck,
  SessionContentBlock,
  SseEvent,
} from './agentSessions';

/** 会话本地存储 */
interface MockSession {
  record: SessionRecord;
  messages: SessionMessage[];
  seq: number;
  cursor: number;
  /** 当前演示流程类型（首条用户消息检测；video 视频 4 卡 / image 图片单卡） */
  flow: 'video' | 'image';
}

const sessions = new Map<string, MockSession>();
/** 事件监听器：key = projectId:sessionId */
const listeners = new Map<string, Set<(ev: SseEvent) => void>>();
let runSeq = 0;

function key(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

function ensure(projectId: string, sessionId: string): MockSession {
  const k = key(projectId, sessionId);
  let s = sessions.get(k);
  if (!s) {
    s = {
      record: {
        session_id: sessionId,
        context: { kind: 'blue_whale_project', external_project_id: projectId },
        title: 'Agent v0 演示会话',
        phase: 'mock',
        lifecycle: 'active',
        created_at: new Date().toISOString(),
      },
      messages: [],
      seq: 0,
      cursor: 0,
      flow: 'video',
    };
    sessions.set(k, s);
  }
  return s;
}

function emit(projectId: string, sessionId: string, type: string, data: unknown): void {
  const list = listeners.get(key(projectId, sessionId));
  if (!list || list.size === 0) return;
  const s = ensure(projectId, sessionId);
  s.cursor += 1;
  const ev: SseEvent = { type, id: String(s.cursor), data };
  list.forEach((fn) => fn(ev));
}

/** 延时派发（mock 用 window.setTimeout 模拟流式节奏） */
function at(ms: number, fn: () => void): number {
  return window.setTimeout(fn, ms);
}

/* ============ 内容块构造 ============ */

function textBlock(text: string): SessionContentBlock {
  return { type: 'text', text };
}
function thinkingBlock(steps: string[]): SessionContentBlock {
  return { type: 'thinking', thinking: { steps } };
}
function clarifyBlock(questions: string[]): SessionContentBlock {
  return { type: 'clarify', clarify: { questions } };
}
function understandingBlock(u: NonNullable<SessionContentBlock['understanding']>): SessionContentBlock {
  return { type: 'understanding', understanding: u };
}

function userMessage(s: MockSession, text: string): SessionMessage {
  s.seq += 1;
  return {
    message_id: `mu-${s.seq}`,
    session_id: s.record.session_id,
    sequence: s.seq,
    role: 'user',
    content: [textBlock(text)],
    created_at: new Date().toISOString(),
  };
}

function assistantMessage(
  projectId: string,
  sessionId: string,
  content: SessionContentBlock[],
  runId: string,
): SessionMessage {
  const s = ensure(projectId, sessionId);
  s.seq += 1;
  const msg: SessionMessage = {
    message_id: `ma-${s.seq}`,
    session_id: sessionId,
    sequence: s.seq,
    role: 'assistant',
    content,
    source_run_id: runId,
    created_at: new Date().toISOString(),
  };
  s.messages.push(msg);
  return msg;
}

/** 单次运行的事件序列（runId 唯一，供事件流对齐） */
function runFlow(projectId: string, sessionId: string, turn: 'intent' | 'summary' | 'confirm'): void {
  const runId = `run-${++runSeq}`;
  const s = ensure(projectId, sessionId);
  const flow = s.flow;
  const push = (type: string, data: Record<string, unknown>) => emit(projectId, sessionId, type, data);

  /* ---- turn: intent（用户首条需求 → 判断 + 追问） ---- */
  if (turn === 'intent') {
    push('message.accepted', {
      payload: {
        message: s.messages[s.messages.length - 1],
        scheduling: { run_id: runId },
      },
      run_id: runId,
    });
    at(120, () => push('run.queued', { payload: { run: { run_id: runId, status: 'queued' } }, run_id: runId }));
    at(240, () => push('run.started', { payload: { run: { run_id: runId, status: 'started' } }, run_id: runId }));
    at(360, () =>
      push('reasoning_trace.updated.v1', {
        payload: {
          run_id: runId,
          steps: [
            flow === 'image'
              ? '正在识别任务类型：这是图片生成需求，不是立即生成动作。'
              : '正在识别任务类型：这是商品展示视频需求，不是立即生成动作。',
          ],
        },
        run_id: runId,
      }),
    );
    at(480, () =>
      push('assistant.delta', {
        payload: {
          text:
            flow === 'image'
              ? '我会先确认你要的图片方向和素材使用方式。确认前不会生成生成卡，也不会触发生成。'
              : '我会先确认你要做的视频方向和素材使用方式。确认前不会生成分镜提示词生成卡，也不会触发生成。',
          stream_id: `assistant_run_${runId}`,
        },
        run_id: runId,
      }),
    );
    const clarify = flow === 'image'
      ? ['用途：电商主图 / 详情页 / 海报 / 插画', '画面比例：9:16 / 1:1 / 16:9', '风格倾向：高级 / 简约 / 插画风 / 写实']
      : [
          '投放平台：小红书 / 抖音 / 淘宝 / 京东',
          '画面比例：9:16 / 1:1 / 16:9',
          '视频时长：15 秒 / 30 秒',
          '核心卖点：保温、材质、容量、外观等',
        ];
    const reply = assistantMessage(projectId, sessionId, [
      textBlock(
        flow === 'image'
          ? '我会先确认你要的图片方向和素材使用方式。确认前不会生成生成卡，也不会触发生成。'
          : '我会先确认你要做的视频方向和素材使用方式。确认前不会生成分镜提示词生成卡，也不会触发生成。',
      ),
      thinkingBlock([
        flow === 'image'
          ? '正在识别任务类型：这是图片生成需求，不是立即生成动作。'
          : '正在识别任务类型：这是商品展示视频需求，不是立即生成动作。',
      ]),
      clarifyBlock(clarify),
    ], runId);
    at(720, () =>
      push('run.completed', {
        payload: { run: { run_id: runId, status: 'completed' }, assistant_message: reply },
        run_id: runId,
      }),
    );
    return;
  }

  /* ---- turn: summary（用户补充 → 需求理解总结 + 确认门） ---- */
  if (turn === 'summary') {
    push('message.accepted', {
      payload: {
        message: s.messages[s.messages.length - 1],
        scheduling: { run_id: runId },
      },
      run_id: runId,
    });
    at(120, () => push('run.started', { payload: { run: { run_id: runId, status: 'started' } }, run_id: runId }));
    at(240, () =>
      push('reasoning_trace.updated.v1', {
        payload: {
          run_id: runId,
          steps: [
            flow === 'image'
              ? '正在把图片需求整理成需求理解，等待明确确认。'
              : '正在把用户补充内容整理成需求理解，等待明确确认。',
          ],
        },
        run_id: runId,
      }),
    );
    at(360, () =>
      push('assistant.delta', {
        payload: {
          text:
            flow === 'image'
              ? '生成一张高级干净的保温杯产品图，突出哑光深灰杯身、黑色旋盖和商业摄影质感。请确认以下需求理解。'
              : '做一条 15 秒小红书竖版保温杯产品展示视频，整体风格高级、干净、商业产品摄影感。请确认以下需求理解。',
          stream_id: `assistant_run_${runId}`,
        },
        run_id: runId,
      }),
    );
    const reply = assistantMessage(projectId, sessionId, [
      textBlock(
        flow === 'image'
          ? '生成一张高级干净的保温杯产品图，突出哑光深灰杯身、黑色旋盖和商业摄影质感。请确认以下需求理解。'
          : '做一条 15 秒小红书竖版保温杯产品展示视频，整体风格高级、干净、商业产品摄影感。请确认以下需求理解。',
      ),
      thinkingBlock([
        flow === 'image'
          ? '正在把图片需求整理成需求理解，等待明确确认。'
          : '正在把用户补充内容整理成需求理解，等待明确确认。',
      ]),
      flow === 'image'
        ? understandingBlock({
            goal: '生成一张高级干净的保温杯产品图',
            assets: ['@保温杯主图'],
            direction: '高端不锈钢保温杯产品摄影，哑光深灰杯身，黑色旋盖，浅灰渐变背景，柔和棚拍灯光',
            specs: ['图片', '9:16', '商品广告'],
            uncertainties: ['是否突出保温杯品牌 Logo（默认不突出，可在确认前调整）'],
          })
        : understandingBlock({
            goal: '生成一条 15 秒小红书竖版保温杯产品展示视频',
            assets: ['@保温杯主图', '@杯盖材质细节', '@生活场景图'],
            direction: '高级、干净、商业产品摄影感，突出哑光金属质感、杯盖细节和日常生活场景',
            specs: ['小红书', '9:16', '15 秒', '商品广告'],
            uncertainties: ['核心卖点倾向（保温 / 材质 / 容量）以默认展开，可在确认前调整'],
          }),
    ], runId);
    at(560, () =>
      push('run.completed', {
        payload: { run: { run_id: runId, status: 'completed' }, assistant_message: reply },
        run_id: runId,
      }),
    );
    return;
  }

  /* ---- turn: confirm（用户确认需求理解 → 产出多张生成卡，S2 渲染） ---- */
  push('message.accepted', {
    payload: {
      message: s.messages[s.messages.length - 1],
      scheduling: { run_id: runId },
    },
    run_id: runId,
  });
  at(120, () => push('run.started', { payload: { run: { run_id: runId, status: 'started' } }, run_id: runId }));
  at(240, () =>
    push('reasoning_trace.updated.v1', {
      payload: {
        run_id: runId,
        steps: [
          flow === 'image'
            ? '需求理解已确认，正在把图片需求整理成可手动应用的生成卡。'
            : '需求理解已确认，正在按镜头 1 / 2 / 3 / 4 生成分镜提示词生成卡。',
        ],
      },
      run_id: runId,
    }),
  );
  at(360, () =>
    push('assistant.delta', {
      payload: {
        text:
          flow === 'image'
            ? '需求理解已确认。下面展示图片生成卡，可自然语言修改或手动应用。'
            : '需求理解已确认。下面按视频时间顺序展示 4 张分镜提示词生成卡，每张卡都可单独自然语言修改或手动应用。',
        stream_id: `assistant_run_${runId}`,
      },
      run_id: runId,
    }),
  );
  const cards: SessionContentBlock['card'][] =
    flow === 'image'
      ? [
          {
            cardId: 'igc-1',
            shotTitle: '图片生成卡 · 保温杯产品图',
            visual: '高端不锈钢保温杯产品摄影，哑光深灰杯身，黑色旋盖，浅灰渐变背景，柔和棚拍灯光。',
            prompt: '高端不锈钢保温杯产品摄影，哑光深灰杯身，黑色旋盖，浅灰渐变背景，柔和棚拍灯光，商业广告摄影风格，主体清晰居中，无水印无 Logo。',
            assetRefs: ['@保温杯主图'],
          },
        ]
      : [
          {
            cardId: 'gc-1',
            shotTitle: '镜头 1 · 光影揭幕',
            timeRange: '0-4s',
            visual: '纯黑背景中侧光扫过，保温杯轮廓逐渐显现。',
            prompt: '哑光深灰不锈钢保温杯，黑色旋盖，纯黑背景，单侧柔光扫过杯身，轮廓从暗部显现，商业产品摄影，9:16，无字幕无水印。',
            assetRefs: ['@保温杯主图'],
          },
    {
      cardId: 'gc-2',
      shotTitle: '镜头 2 · 材质微距',
      timeRange: '4-8s',
      visual: '贴近杯身磨砂金属纹理，焦点转移到杯盖螺纹。',
      prompt: '超微距展示磨砂金属颗粒和杯盖螺纹，浅景深，暖灰虚化背景，镜头缓慢推进，质感清晰稳定。',
      assetRefs: ['@杯盖材质细节'],
    },
    {
      cardId: 'gc-3',
      shotTitle: '镜头 3 · 生活美学',
      timeRange: '8-12s',
      visual: '大理石桌面、咖啡蒸汽、清晨自然光。',
      prompt: '保温杯放在大理石桌面，旁边有咖啡蒸汽和晨光，干净高级生活方式广告，柔和自然光，画面稳定。',
      assetRefs: ['@生活场景图'],
    },
    {
      cardId: 'gc-4',
      shotTitle: '镜头 4 · 英雄收尾',
      timeRange: '12-15s',
      visual: '45 度产品特写，浅灰渐变背景，品牌信息预留。',
      prompt: '45 度保温杯英雄特写，浅灰渐变背景，杯身高光清晰，居中构图，商业收尾镜头，预留品牌文字空间。',
      assetRefs: ['@包装品牌占位图'],
    },
  ];
  const reply = assistantMessage(projectId, sessionId, [
    textBlock(
      flow === 'image'
        ? '需求理解已确认。下面展示图片生成卡，可自然语言修改或手动应用。'
        : '需求理解已确认。下面按视频时间顺序展示 4 张分镜提示词生成卡，每张卡都可单独自然语言修改或手动应用。',
    ),
    thinkingBlock([
      flow === 'image'
        ? '需求理解已确认，正在把图片需求整理成可手动应用的生成卡。'
        : '需求理解已确认，正在按镜头 1 / 2 / 3 / 4 生成分镜提示词生成卡。',
    ]),
    ...cards.map((c) => ({ type: 'card' as const, card: c })),
  ], runId);
  at(560, () =>
    push('run.completed', {
      payload: { run: { run_id: runId, status: 'completed' }, assistant_message: reply },
      run_id: runId,
    }),
  );
}

/* ---- turn: revision（自然语言修改某张卡 → 重新整理生成卡组） ---- */
function runRevision(projectId: string, sessionId: string): void {
  const runId = `run-${++runSeq}`;
  const s = ensure(projectId, sessionId);
  const push = (type: string, data: Record<string, unknown>) => emit(projectId, sessionId, type, data);

  push('message.accepted', {
    payload: {
      message: s.messages[s.messages.length - 1],
      scheduling: { run_id: runId },
    },
    run_id: runId,
  });
  at(120, () => push('run.started', { payload: { run: { run_id: runId, status: 'started' } }, run_id: runId }));
  at(240, () =>
    push('reasoning_trace.updated.v1', {
      payload: { run_id: runId, steps: ['正在根据你的修改要求重新整理镜头 2 的分镜提示词。'] },
      run_id: runId,
    }),
  );
  at(360, () =>
    push('assistant.delta', {
      payload: {
        text: '已按你的修改要求更新镜头 2。下面重新展示整组分镜提示词生成卡。',
        stream_id: `assistant_run_${runId}`,
      },
      run_id: runId,
    }),
  );
  const reply = assistantMessage(projectId, sessionId, [
    textBlock('已按你的修改要求更新镜头 2。下面重新展示整组分镜提示词生成卡。'),
    thinkingBlock(['正在根据你的修改要求重新整理镜头 2 的分镜提示词。']),
    {
      type: 'card',
      card: {
        cardId: 'gc-1',
        shotTitle: '镜头 1 · 光影揭幕',
        timeRange: '0-4s',
        visual: '纯黑背景中侧光扫过，保温杯轮廓逐渐显现。',
        prompt: '哑光深灰不锈钢保温杯，黑色旋盖，纯黑背景，单侧柔光扫过杯身，轮廓从暗部显现，商业产品摄影，9:16，无字幕无水印。',
        assetRefs: ['@保温杯主图'],
      },
    },
    {
      type: 'card',
      card: {
        cardId: 'gc-2r',
        shotTitle: '镜头 2 · 材质微距（已修改）',
        timeRange: '4-8s',
        visual: '贴近杯身磨砂金属纹理，焦点转移到杯盖螺纹，加入晨光反射点缀。',
        prompt: '超微距展示磨砂金属颗粒和杯盖螺纹，浅景深，暖灰虚化背景，镜头缓慢推进，杯身带一点晨光反射，质感清晰稳定。',
        assetRefs: ['@杯盖材质细节'],
      },
    },
    {
      type: 'card',
      card: {
        cardId: 'gc-3',
        shotTitle: '镜头 3 · 生活美学',
        timeRange: '8-12s',
        visual: '大理石桌面、咖啡蒸汽、清晨自然光。',
        prompt: '保温杯放在大理石桌面，旁边有咖啡蒸汽和晨光，干净高级生活方式广告，柔和自然光，画面稳定。',
        assetRefs: ['@生活场景图'],
      },
    },
    {
      type: 'card',
      card: {
        cardId: 'gc-4',
        shotTitle: '镜头 4 · 英雄收尾',
        timeRange: '12-15s',
        visual: '45 度产品特写，浅灰渐变背景，品牌信息预留。',
        prompt: '45 度保温杯英雄特写，浅灰渐变背景，杯身高光清晰，居中构图，商业收尾镜头，预留品牌文字空间。',
        assetRefs: ['@包装品牌占位图'],
      },
    },
  ], runId);
  at(560, () =>
    push('run.completed', {
      payload: { run: { run_id: runId, status: 'completed' }, assistant_message: reply },
      run_id: runId,
    }),
  );
}

/** 判断当前回复回合（按会话消息轮次推进） */
function nextTurn(s: MockSession): 'intent' | 'summary' | 'confirm' | 'revision' {
  const assistantCount = s.messages.filter((m) => m.role === 'assistant').length;
  if (assistantCount === 0) return 'intent';
  if (assistantCount === 1) return 'summary';
  // 已产出过生成卡（confirm 之后）→ 自然语言修改/继续 → 重新整理生成卡组
  return 'revision';
}

/* ============ 会话管理（与真实签名一致） ============ */

export function listSessions(projectId: string): Promise<{ items: SessionRecord[] }> {
  const s = ensure(projectId, `mock-${projectId}`);
  return Promise.resolve({ items: [s.record] });
}

export function createSession(projectId: string): Promise<SessionRecord> {
  const s = ensure(projectId, `mock-${projectId}`);
  return Promise.resolve(s.record);
}

export function fetchSessionSnapshot(projectId: string, sessionId: string): Promise<SessionSnapshot> {
  const s = ensure(projectId, sessionId);
  return Promise.resolve({
    session: s.record,
    messages: [...s.messages],
    active_run: null,
    latest_terminal_run: null,
    event_cursor: String(s.cursor),
  });
}

export function sendSessionMessage(
  projectId: string,
  sessionId: string,
  text: string,
): Promise<SessionMessageAck> {
  const s = ensure(projectId, sessionId);
  // 首条用户消息：检测流程类型（图片/插画/海报/产品图/照片 → image；其余默认 video）
  if (s.messages.filter((m) => m.role === 'user').length === 0) {
    s.flow = /(图片|插画|海报|产品图|照片|图像|一张|个图)/.test(text) ? 'image' : 'video';
  }
  const msg = userMessage(s, text);
  s.messages.push(msg);
  const turn = nextTurn(s);
  // 下一轮事件在 resolve 后延时派发，保证 POST 回执先返回
  window.setTimeout(() => {
    if (turn === 'revision') runRevision(projectId, sessionId);
    else runFlow(projectId, sessionId, turn);
  }, 40);
  const run: SessionRun = { run_id: `run-${runSeq + 1}`, session_id: sessionId, status: 'queued' };
  return Promise.resolve({ message: msg, run });
}

export function cancelSessionRun(
  projectId: string,
  sessionId: string,
  runId: string,
): Promise<unknown> {
  void runId;
  emit(projectId, sessionId, 'run.cancelled', { payload: { run: { run_id: runId, status: 'cancelled' } } });
  return Promise.resolve({});
}

export function retrySessionRun(
  projectId: string,
  sessionId: string,
  runId: string,
): Promise<{ run?: SessionRun } & Record<string, unknown>> {
  void projectId;
  void sessionId;
  void runId;
  return Promise.resolve({});
}

export function subscribeSessionEvents(
  projectId: string,
  sessionId: string,
  _initialCursor: string,
  onEvent: (ev: SseEvent) => void,
): () => void {
  void projectId;
  void sessionId;
  const k = key(projectId, sessionId);
  let list = listeners.get(k);
  if (!list) {
    list = new Set();
    listeners.set(k, list);
  }
  list.add(onEvent);
  return () => {
    list?.delete(onEvent);
    if (list?.size === 0) listeners.delete(k);
  };
}
