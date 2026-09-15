import type { PromptPreviewSource } from '@lib/contracts/prompt-preview';
/* ============================================
 * agentSessions 接口：Agent 会话（session 维度，唯一有 worker 执行 Run 的对话服务）
 * 基址 /api/agent/v1/projects/:id/sessions
 * - list/create/snapshot/messages/runs(cancel/retry)/events(SSE)
 * - 返回为裸 JSON（无 {code,msg,data} 包络），统一 fetch + 401 走 handleUnauthorized
 * - 事件流为共享连接（引用计数）：StrictMode 双挂载/多处订阅不重复建连
 * ============================================ */
import { readSseResponse, type SseEvent } from './events';
import { ApiError, apiRequest, isApiError } from './http';
import { newIdempotencyKey } from './jobs';
import { agentPath, agentUrl, agentMethod } from './agentRoutes';
import { handleUnauthorized } from '@/utils/auth';

export type { SseEvent };

/* ============ 类型 ============ */

/** 消息正文块 */
/** 一轮的真实执行台账（IKB926，`run_actions` 块/事件的载荷）。服务端产出，客户端只读。 */
export interface RunActionsRecord {
  actions: {
    tool: string;
    /** 服务端模板句；入参永不出现（PRD §4.2）。 */
    summary: string;
    started_ms: number;
    ended_ms: number | null;
    /** rejected = 被业务门挡下（如产卡被 freeze 门拒），failed = 真失败。 */
    status: 'ok' | 'failed' | 'rejected';
    substeps?: { id: string; summary: string; started_ms: number; ended_ms: number | null }[];
  }[];
  total_ms: number;
  /** 本轮结束时会话是否仍在需求收集阶段。 */
  requirement_stage: boolean;
  /** 需求阶段「还差几项」；非需求阶段为 null。 */
  outstanding_count: number | null;
}

/** 服务端替模型出的一道题（2026-09-15，`ask_questions`）：题号、字母都是服务端编的，前端按它画。 */
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
  /**
   * 这段正文是服务端替模型出的题（2026-09-15）：`text` 是它的 markdown（兜底），有 `questions` 就按数据画。
   * 老记录的题只有文字，前端认开头排版。
   */
  questions?: AskedQuestion[];
  /** 本轮动作台账块（IKB93G 的动作行由它渲染；服务端消息部件 `run_actions` 原样透传）。 */
  run_actions?: RunActionsRecord;
  /**
   * 一次工具调用在正文时间轴上的位置（IKD79E）。夹在两段正文之间，回答「它是在说完哪句话
   * 之后去做的」——与 `run_actions` 那份收起来的清单不重复，后者回答「调了什么、多久」。
   *
   * 只有真的交错过的轮次才有。老消息与没调过工具的轮次仍然是一整块正文，照旧渲染。
   */
  tool?: string;
  summary?: string;
  /**
   * `tool_call` 的终态（IKDK5F）：`ok` / `failed` / `rejected`、相对 Run 开始的起止毫秒、子步骤。
   * 前端据此把「正在读取图片」翻成「已读取图片 · 10.4s」。老记录没有这几个字段。
   */
  status?: 'ok' | 'failed' | 'rejected' | 'cancelled';
  started_ms?: number;
  ended_ms?: number | null;
  substeps?: { id: string; summary: string; started_ms: number; ended_ms: number | null }[];
  /** 模型一步里并发调了几次同一个工具，合成这一行（IKFLB9）。 */
  calls?: number;
  /*
   * `type: 'reasoning'`（IKFLB9）：模型的一段思考，按发生顺序夹在正文与工具行之间，原话在 `text`，
   * 起止在 `started_ms` / `ended_ms`。有了它，`thinking` 块里就不再带 `reasoning`。
   *
   * `type: 'waiting'`（IKFLB9）：两段之间没有任何输出的时间（例如工具返回之后模型读结果），
   * 名字在 `summary`。有了它，一轮里各段的时长加起来等于总时长。
   */
  /**
   * 思考过程块（可折叠展示）。
   *
   * `steps` 是服务端选的模板文案，`reasoning` 是模型自己的原话（assistant.reasoning.delta，
   * IKA3M6）。两个字段分开，因为可信度不一样：模板是我们的承诺，思考是模型随口说的。
   * 两截都落库（IKAI1A）：服务端在助手消息里就带上这个块，刷新之后思考还在。老 Run 没有
   * 落库过原话，它们只会有 `steps` 那一半——那是如实的，那些原话确实已经不存在了。
   */
  thinking?: { steps?: string[]; reasoning?: string };
  /**
   * 产卡之前的每一步都走自然语言：追问、需求理解总结与确认都是助手的正文文字，
   * 不再有 understanding / clarify 结构化块。生成卡是唯一的结构化交付物。
   */
  /** 生成卡块（分镜提示词，按 04-侧边栏规范 §5.1） */
  card?: GenerationCardBlock;

  // ---- 媒体类型扩展（image / video / audio） ----
  /** 永久访问 URL（上传完成后获得） */
  url?: string;
  /** MIME 类型，如 "image/jpeg" */
  mime?: string;
  /** 时长秒（视频/音频） */
  duration?: number;
  /** 展示名/文件名 */
  name?: string;
  /** 画布节点 ID */
  node_id?: string;
  /**
   * 资产库 ID。**有它和没它，模型看到的东西不一样**（IKAL46）。
   *
   * 带 `asset_id` 的块序列化成 `asset_ref` 部件，agent 据此建立 Session Asset Grant，
   * 模型能真的读到这张图/这段视频；不带的块只能序列化成 `resource_ref`，模型拿到的是
   * 一个占位标签。所以上传来的素材务必带上它，不要只留 `url`。
   */
  asset_id?: string;
  /** 来源：card-ref 卡片参考图、card-image 商品图、card-voice 角色音色、card-generation 生成卡、node 独立节点 */
  source?: 'card-ref' | 'card-image' | 'card-voice' | 'card-generation' | 'node';
  /** 资源来源类型：区分从哪种卡片/节点带出的媒体数据；
   *  'text_quote' 是文本引用快照（IKDLQJ）的契约判别值，只在 round-trip 回来的部件上出现 */
  resource_type?:
    | '图片'       // 独立图片节点
    | '视频'       // 独立视频节点
    | '音频'       // 独立音频节点
    | '文本节点'   // 文本节点
    | '文本引用'   // 对话引用快照（IKDLQJ）
    | '商品卡'     // 商品卡
    | '风格卡'     // 风格卡
    | '角色卡'     // 角色卡
    | '物体卡'     // 物体卡
    | '环境卡'     // 环境卡
    | '自定义卡'   // 自定义卡
    | '生成卡'     // 生成卡
    | 'text_quote'; // 文本引用快照契约值（IKDLQJ，agent round-trip 回填）
  /** 关联的 chip ID（用于删除 chip 时同步移除媒体数据） */
  chip_id?: string;

  // ---- 封装参数（给后端消费的统一字段） ----
  /** 资源 ID，对应画布节点 id；文本引用快照（IKDLQJ）为 quoteId */
  resource_id?: string;
  /** 媒体类型：image / video / audio */
  media_type?: 'image' | 'video' | 'audio';
  /**
   * 画布中文分类的 round-trip 字段（如「视频」）。
   * 上线时 `resource_type` 会被改写成契约的 asset/card，历史快照靠这个认出独立视频节点。
   */
  resource_kind?: string;
  /** 展示标签（对外展示的名称） */
  display_label?: string;
  /** 资源文本描述（如商品卡的商品详情）；文本引用快照为冻结正文 */
  resource_text?: string;
  /** 生成卡胶囊指向的镜号：`resource_id` 是 revision，配上它才定位到具体那一镜。 */
  shot_no?: number;
  /** 对话引用快照 id（IKDLQJ）：服务端 `conversation_quote_snapshots` 主键，刷新后按它回读引用事实 */
  quote_id?: string;
  /** 引用节点的预览来源三件套（IKDLQE）；普通无预览来源文本不携带 */
  prompt_source?: PromptPreviewSource | null;
}

/** 生成卡里的一条素材引用（IKAFSQ）。
 *
 * 从前这里只留下一个 `@名称` 字符串，`asset_id` 与 `media_type` 在翻译时被丢掉了——于是
 * 拿不到缩略图、做不了悬浮预览，素材改名或删除也只会静默失效。引用要成立，得带着身份。 */
export interface GenerationCardAssetRef {
  /** 资产库里的素材 id：缩略图与预览由它查出来 */
  assetId: string;
  /** 展示名（不带 @ 前缀，前缀是展示层的事） */
  label: string;
  mediaType: 'image' | 'video';
  /** 记号的显示名「图1」「视频3」：卡上和正文里都用它，和画布 `#N` 同一个号。老卡没有，就显示 label。 */
  marker?: string;
  /** 这份素材在提示词正文里的记号原文（`@图1`，照包写的模型也会写 `@图片1`），正文按它换成胶囊。 */
  markerTexts?: string[];
}

/** 生成卡：单镜头分镜提示词卡（S2 渲染，S3 手动应用） */
export interface GenerationCardBlock {
  source?: PromptPreviewSource;
  /** 卡片标题 / 镜头编号，如「镜头 1」 */
  shotTitle: string;
  /** 时间范围，如 0-4s */
  timeRange?: string;
  /** 画面描述。只有 V3 旧卡有；V4 起画面并进了提示词（IKEV0K）。 */
  visual?: string;
  /** 分镜提示词 */
  prompt: string;
  /** 素材引用（@名称）。保留给旧数据与纯文本场景；有身份的引用走 assetRefItems。 */
  assetRefs?: string[];
  /** 带身份的素材引用：胶囊靠它渲染缩略图与悬浮预览 */
  assetRefItems?: GenerationCardAssetRef[];
  /** 卡片唯一标识（应用动作追踪） */
  cardId?: string;
  /** 镜号（协议里的 `shot_no`，schema 强制 1..N 连续）→ 卡头的 `#3` */
  shotNo?: number;
  /** 本批次形态：image / video → 卡头的 `SCENE` 徽标 */
  targetMedia?: 'image' | 'video';
  /** 画幅，如 `16:9`（`generation_suggestions.aspect_ratio`） */
  aspectRatio?: string;
  /** 这张卡按哪套写法编的，如 `Seedance 2.5`（批次级的 `target_model`，每张卡都标）。 */
  targetModel?: string;
  /** 单镜时长秒数原值（`duration_seconds`）。与 timeRange 并存：那个是累加出的区间，这个是本镜自己的长度。 */
  durationSeconds?: number;
}

/** 会话记录（列表/创建返回） */
export interface SessionRecord {
  session_id: string;
  context?: { kind?: string; external_project_id?: string };
  title?: string | null;
  phase?: string;
  lifecycle?: string;
  active_run_id?: string | null;
  /**
   * 本会话已载入的创作套路（`creative_skill_id`，0028）。
   *
   * 会话级而不是逐条消息：用户点「直接使用」表达的是「接下来按这个来」，所以载入一次之后
   * 每一轮都注入，直到显式取消。只有 id——名称在技能目录里，前端本来就有那一份。
   */
  active_creative_skill_ids?: string[];
  /**
   * 本会话选定的 Agent 模型（IKE0II）。`null` 表示用户从没选过，这条会话跟着服务端默认走。
   *
   * 服务端**故意不**在这里填它自己的默认值：前端要能分出「用户选过 MiniMax」和「没选过、
   * 跟着服务端」——服务端默认哪天变了，这两种的表现就不一样了。
   */
  model?: string | null;
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

/** 运行记录（事件内嵌 / 快照内嵌）。
 *
 * 时间与用量字段 agent 一直在送（`runView` 的原样投影），只是此前这里没声明，于是
 * 刷新后没人去读——输入框上方那条"这一轮花了多久、多少 token"的状态行因此一刷新就消失。 */
export interface SessionRun {
  run_id: string;
  session_id?: string;
  /** 这个 Run 回答的输入批次（IKDK5C）。回答按它挂回自己的问题下面。 */
  input_batch_id?: string | null;
  status: string;
  failure?: { code?: string; message?: string } | null;
  trace_id?: string | null;
  /** 入队时刻（ISO）。状态行的起点：它量的是用户从提交到拿到结果等了多久，不是模型跑了多久。 */
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  /** 终态真实用量；缺失时状态行退回按字符数估算。 */
  token_usage?: unknown;
  context_capacity?: unknown;
  /**
   * 这一轮要写生成卡、但没写出来（IKEV0V）。只在聊天里改卡时出现：那一轮照常 completed，
   * 只是没有新卡，侧边栏还挂着上一版——不把这句显示出来，用户会把旧卡当成这次改出来的。
   * 确认后首次写卡失败不走这里，那一轮是 failed，失败说明在 `failure` 里。
   */
  prompt_card_failure?: { code?: string; message?: string } | null;
}

/* ---- 生成卡批次（agent 侧 Prompt Card Revision Schema V3 的原样投影） ----
 * 这里刻意保留 agent 的字段名与结构，不在传输层改形状：翻译成侧边栏卡片模型的动作
 * 集中在 useAgentSession 的映射函数里，只有一处需要跟着协议变。 */

/** 单镜头（V4 $defs.shotCard） */
export interface PromptCardShot {
  shot_no: number;
  title: string;
  /**
   * 画面描述。卡结构 V4 起删除（IKEV0K）：每一镜只留一段提示词，画面、时长、口播字幕都写在里面。
   * 只有 V3 的旧卡还带着它。
   */
  frame_description?: string;
  prompt_text: string;
  asset_bindings: { asset_ref_id: string; role?: string; strength?: string; note?: string }[];
  /**
   * 正文里素材记号（`@图1`）的位置，服务端算（IKFLD1）。`index` 是本会话素材清单里的全局序号，
   * 和画布上的 `#N` 同一个号。老卡没有。
   */
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

/** 素材出处（V3 $defs.assetProvenance）：asset_ref_id → 可读名称的唯一来源 */
export interface PromptCardAssetProvenance {
  asset_ref_id: string;
  asset_id: string;
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
  /**
   * 这一批提示词是按哪套写法编的（F32）。服务端按用户确认的出片路线填，模型不经手。
   *
   * 粒度到路线为止（`Seedance 2.5` / `Seedream`），不是目录里具体那一行——按 F34 它**不下传
   * 生成面板**，用户最后在面板里点哪一行是他的事。只做展示与核对。老卡没有这一项。
   */
  target_model?: { family: string; version?: string };
}

/** 一个修订版：快照的 active_revision 与按版本号读取接口返回的元素是同一个形状 */
export interface PromptCardRevision {
  revision_id: string;
  card_id: string;
  authoring_run_id?: string;
  revision_number: number;
  schema_version: number;
  payload: PromptCardRevisionPayload;
}

/** 修订版的身份与出处，不带正文（IKEV0V）。正文用 fetchPromptCardRevisions 按版本号取。 */
export interface PromptCardRevisionSummary {
  revision_id: string;
  revision_number: number;
  /** 写这一版的那一轮：卡挂到 source_run_id 与它相同的那条助手消息下面 */
  authoring_run_id: string;
  created_at: string;
}

/** 快照里的生成卡组：一个 Session 一组，active_revision 是当前生效版本 */
export interface PromptCardRecord {
  card_id: string;
  session_id?: string;
  active_revision_id?: string;
  revision_count?: number;
  active_revision?: PromptCardRevision | null;
  /**
   * 这组卡的每一版，旧的在前（IKEV0V）。改过卡之后，上一版要留在写它的那一轮下面——PRD 要求
   * 旧卡保留在对话历史中、刷新后仍可查看。老版本的 agent 不发这个字段。
   */
  revisions?: PromptCardRevisionSummary[];
}


/* ============ 方案卡（IKF3KE） ============ */

/**
 * 这次的提示词按哪套写法编——图片到家族，视频要到大版本（2.0 与 2.5 是两套写法）。
 *
 * 服务端按平台模型目录核过：不在「当前可用」里的写不进来。`reason` / `alternatives` **不在
 * 卡上显示**——理由和取舍在对话正文里跟用户说更清楚，卡上只留他能核对的那一层。
 */
export interface SolutionExecutionRoute {
  model_family: string;
  model_version?: string;
  reason?: string;
  alternatives?: { route: string; tradeoff: string }[];
}

/**
 * 出片参数：画幅、时长、分辨率。
 *
 * 值由模型从访谈里带出来，服务端按平台目录的值域核过——**用户判断不了「5.0 Pro 还是 4.5」，
 * 但判断得了「30 秒」**，而平台上限只有 15 秒这件事，他有权在点确认之前看见。
 * 没聊到的项整项不写，界面也就不显示。
 */
export interface SolutionDeliverySpec {
  aspect_ratio?: string;
  duration_seconds?: number;
  resolution?: string;
}

/**
 * 用户在任何一张生成卡被写出来之前，唯一读到并需要表态的东西。
 *
 * 八项，其中三项服务端保证非空（goal / target_media / assumptions）；
 * 其余没聊到就整项不写，界面也就不显示——空壳小标题比没有更糟。
 *
 * `execution_route` 2026-09-12 起可选：它曾经是第四项必填，而必填逼出来的是模型凭记忆写的
 * 模型名——服务端手里没有平台模型目录、核不了它，写错了也没有下游会拦（生成时用户在 dock
 * 手动选，这个标注不下传）。绑目录之后由服务端按平台当前可用的模型填。
 */
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
  /**
   * 这张卡管的范围（决策十六）。没写就是整条；会话已经交付过卡之后再提的每一张都是续写，
   * 只管接下来要追加的那一段或那几镜，`label` 是用户读到的「第 2 段」「补 1 镜」。
   */
  scope?: { kind: 'whole' | 'continuation'; label: string };
}

/** 方案卡所在的版本记录。一个会话一条血脉，一版一次提出或修改，同时最多一版 accepted。 */
export interface RequirementUnderstanding {
  understanding_id: string;
  version: number;
  session_id: string;
  proposed_by_run_id: string;
  target_media: 'image' | 'video';
  proposed_summary: string;
  /** 老版本（产卡门顺手提的那种）没有这一项，界面退回只显示摘要。 */
  solution_card?: SolutionCard | null;
  status: 'awaiting_confirmation' | 'accepted' | 'superseded';
  accepted_summary?: string | null;
  confirmation_evidence?: { action: 'confirm' | 'correct'; channel: string } | null;
  created_at?: string;
  updated_at?: string;
  confirmed_at?: string | null;
}

/** 会话快照（水合入口） */
export interface SessionSnapshot {
  session: SessionRecord & { title_source?: string; pending_message_count?: number };
  messages: SessionMessage[];
  active_run?: SessionRun | null;
  latest_terminal_run?: SessionRun | null;
  /** 生成卡正文只在快照里，事件只带 card_id / revision 引用，拿到事件后必须回查这里 */
  prompt_cards?: PromptCardRecord[];
  /**
   * 方案卡的全部版本，新的在前（IKF3KE）。刷新之后那张待确认的卡还要在、按钮还要能点，
   * 所以它随快照回来，不另发一次请求。已确认或已作废的版本也在里面——它们在对话里置灰留着。
   */
  requirement_understandings?: RequirementUnderstanding[];
  event_cursor?: string;
}

/** 发送消息返回（接纳回执） */
export interface SessionMessageAck {
  message?: SessionMessage;
  run?: SessionRun;
  [key: string]: unknown;
}

/* ============ 基础请求 ============ */

/**
 * 从错误响应体里取出 code 与 message。
 *
 * 这条链上有两种错误形状，必须都读得懂：
 * - **agent 原样透传**：`{ error: { code, message, retryable, trace_id } }`——嵌套在 `error` 下
 *   （agent 侧 `http/app.ts` 的 `jsonError`），BFF 代理是逐字节透传的，不重新包封
 * - **蓝鲸后端自己的**：`{ code, msg, data }`——平铺
 *
 * 之前只读平铺形状，于是 agent 的每一个错误码在浏览器里都读不到，一律降级成「请求失败（409）」。
 * 调用方想按 code 分支（例如把「已经确认过了」与真正的失败区分开）就无从下手。
 */
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

/** 会话维度裸 JSON 请求（401 走 handleUnauthorized；非 2xx 抛 ApiError） */
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
      /* 非 JSON 保留原文 */
    }
  }
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  const failure = res.ok ? null : describeFailure(record, res.status);
  // Agent 的 capability_required 也使用 401，但它表示缺少 per-Run 能力券，不是用户登录失效。
  if (res.status === 401 && failure?.code !== 'capability_required') handleUnauthorized();
  if (failure) throw new ApiError(res.status, failure.message, failure.code);
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
    method: agentMethod('create_session'),
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

/** 按版本号读取接口一次最多接受的 id 数（agent 侧 MAX_REVISION_IDS_PER_READ）。 */
const REVISION_IDS_PER_READ = 20;

/**
 * 按版本号取生成卡的历史修订 GET /projects/:id/sessions/:sid/prompt-card-revisions?revision_ids=（IKDOF0）。
 *
 * 快照只带当前生效的那一版正文；之前的版本要在这里取，否则改过一次卡，上一版就从对话里消失了
 * （IKEV0V）。修订一旦提交就不会再变，调用方可以放心缓存。超过单次上限时分批取。
 */
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

/**
 * 会话的 Run 列表 GET /projects/:id/sessions/:sid/runs（IKDK5L）。
 *
 * 快照只带 `active_run` 与 `latest_terminal_run`，历史轮的账（耗时、token、上下文）只有这里有。
 * 连上会话后拉一次，失败不影响对话——账只是少显示几行小字。
 */
export function listSessionRuns(
  projectId: string,
  sessionId: string,
): Promise<{ items: SessionRun[]; next_cursor?: string | null }> {
  return sessionRequest(agentPath('session_runs', projectId, { session_id: sessionId }));
}

/**
 * 读一次会话，取它当前的 etag。
 *
 * 响应体里没有 etag 是契约破了，不是"再试试"能解决的事，所以直接抛而不是兜一个假值下去
 * ——拿 `"missing"` 这类占位去发 If-Match，只会把 400 从 if_match_required 换成
 * invalid_etag，用户看到的还是一句失败。
 */
async function readSessionEtag(projectId: string, sessionId: string): Promise<string> {
  const session = await sessionRequest<SessionRecord>(
    agentPath('get_session', projectId, { session_id: sessionId }),
  );
  if (!session?.etag) throw new ApiError(500, '读取会话版本失败，请刷新页面重试', 'missing_etag');
  return session.etag;
}

/** 删除会话 DELETE /projects/:id/sessions/:sid（历史会话下拉「删除」，需二次确认）
 *
 * agent 对会话写操作有**两道**门，缺任何一样都是 400，而在界面上都长成同一句「删除失败」：
 *
 * - `Idempotency-Key`：`http/app.ts` 的 idempotentMutation 缺则 400 idempotency_key_required
 * - `If-Match: W/"session-N"`：同文件 expectedVersion 缺则 400 if_match_required
 *
 * 这个删除从上线起一次都没成功过，而且是同一处连错两次——先漏 Idempotency-Key，补上之后
 * 又漏 If-Match。两道门是一起的，别再只补一半。
 *
 * `etag` 让调用方传：历史会话列表里每一条都带着自己的 etag（`GET /sessions` 逐条经服务端
 * sessionView 序列化），删哪条就用哪条的，不必为此多打一次请求。没传才回去读一次。
 *
 * 412 是"手里的 etag 旧了"——另一个端在这中间改了标题之类。重读一次再来，只重一次：
 * 真的在并发改动中，无限重试也追不上，那时候该让用户刷新。
 */
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

/* ============ 消息与运行控制 ============ */

/** 本地上传完成、准备随消息发出的素材引用（IKAL46）。
 *
 * `media_type` 是「这是一条完整引用」的判据——agent 侧据此建立 Session Asset Grant；只给
 * `asset_id` 的裸引用会被原样 round-trip 但不建立授权，于是模型读不到这张图。
 *
 * 这里只传身份，不传任何访问材料：签名 URL、对象键、字节都不进消息体。 */
export interface OutboundAssetRef {
  asset_id: string;
  media_type: 'image' | 'video';
  display_label?: string;
}

/** 随消息发出的技能引用（胶囊契约 §3）。 */
export interface OutboundSkillRef {
  skill_id: string;
  name: string;
  /** 技能库里的分类（如「全部」）。展示用，不是契约判别字段。 */
  type?: string;
}

/** 前端内部字段，不上线：要么是渲染态，要么是 agent 侧不认识的噪音。 */
const TRANSPORT_STRIP_FIELDS = ['chip_id', 'name', 'type', 'mime', 'duration'] as const;

/** 从 SessionContentBlock 中剔除前端内部字段，得到传给后端的纯数据 */
function stripInternalFields(block: SessionContentBlock): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block)) {
    if (!TRANSPORT_STRIP_FIELDS.includes(key as typeof TRANSPORT_STRIP_FIELDS[number])) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 画布侧的中文资源分类 → 契约里的 `resource_type`。
 *
 * 两者不是一个东西，此前被当成了一个：画布用「商品卡 / 图片 / 音频」这类中文分类做渲染分支，
 * 契约的 `resource_type` 是 agent 的判别字段。中文分类照旧随包带过去（挂在 `resource_kind` 上，
 * agent 原样 round-trip），但判别位必须是契约值。
 *
 * 契约值现有三个：`asset` / `card`（本表映射），以及 `text_quote`（IKDLQJ 文本引用快照，
 * 不走本表——`toReferencePart` 在 quote_id 分支直接给出）。
 */
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

/**
 * 把一个画布媒体块序列化成契约里的引用部件。
 *
 * 分两路，差别是**模型到底能不能读到内容**：
 *
 * - 有资产库身份（`asset_id` + image/video）→ `asset_ref`。agent 据此建立 Session Asset
 *   Grant，模型经受控理解真的读到这张图。音频走不了这条路——agent 的 asset_ref 校验只认
 *   image / video，塞 audio 进去整条消息会被 400 掉。
 * - 其余（画布节点、各种卡）→ `resource_ref`。模型当下只看到一个占位标签，完整内容由 agent
 *   按 id 解析（契约 §5）。
 *
 * 没有任何可用 id 的块直接丢掉：`resource_ref` 缺 `resource_id` 会让 agent 400，一个渲染
 * 残块不值得把用户整条消息打掉。
 */
function toReferencePart(block: SessionContentBlock): Record<string, unknown> | null {
  const rest = stripInternalFields(block);
  // 文本引用快照（IKDLQJ）：身份是服务端 quoteId，正文随部件走（resource_text），不按 id 解析、不用旧 revision 指针。
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

/** 发送消息 POST /projects/:id/sessions/:sid/messages（回复经事件流 assistant.delta 下发）
 *
 * **胶囊一律进 `content` 数组**，不走并列的顶层字段。这不是风格问题：agent 的
 * `parseInboundParts` 只读 `input.content`，顶层的 `resource_ref` / `skill_ref` 会被静默
 * 丢弃——实测过，带图带技能发过去，落库的 content 只剩那条 text；而一个字不打只带胶囊时，
 * `content` 为空，整条消息直接 400。契约 §4 与 §5 说的就是这两件事。
 *
 * options.resourceRef：本条消息携带的画布媒体 / 卡片，序列化为 `asset_ref` 或 `resource_ref`
 * 部件（见 {@link toReferencePart}）。
 * options.skillRef：用户点选的创作套路，序列化为 `skill_ref` 部件（契约 §3）。
 * options.forcedCreativeSkillId：同一件事的老写法（顶层 `forced_creative_skill_id`）。契约 §4
 * 已把它标为废弃，这里仍然一起发，只为不依赖 agent 与 web 的上线先后；agent 侧以 `skill_ref`
 * 优先。两端都发布后删掉这个参数。
 *
 * options.model：这一条消息用哪个 Agent 模型（IKE0II）。带了就载入会话、之后一直生效，
 * 与创作套路同一种黏性；agent 侧还会把它冻到这一轮的 Run 上，于是回复、产卡、读图、标题
 * 全用同一个模型。老版本 agent 会忽略这个字段，所以前端可以先上，不依赖两端上线先后。
 *
 * 纯附件消息（一个字不打、只带图）是合法的：`content` 里可以没有 text 部件，agent 会把引用
 * 投影成 `[图片：标签]` 之类的占位符。 */
export function sendSessionMessage(
  projectId: string,
  sessionId: string,
  content: SessionContentBlock[],
  options?: {
    forcedCreativeSkillId?: string;
    signal?: AbortSignal;
    resourceRef?: SessionContentBlock[];
    skillRef?: OutboundSkillRef;
    model?: string;
  },
): Promise<SessionMessageAck> {
  const { forcedCreativeSkillId: forcedSkillId, signal, resourceRef, skillRef, model } = options ?? {};
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
  // 空串不发：模型列表还没加载完时 `selectedModel` 就是空串，发过去会被 agent 当成
  // 「没选」——行为虽然一样，但让请求体带一个空字段只会让抓包的人多猜一轮。
  if (model) {
    body.model = model;
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
/**
 * 用户点了方案卡上的「确认」（IKF3KE）。
 *
 * 这一下同时做两件事：把这一版记成用户确认过的，并起一轮把生成卡写出来。返回里的
 * `scheduling` 就是那一轮——界面据此接上流，不然它不知道该等谁。
 */
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

/**
 * 用户点了「取消」或「补充」：这一版作废。
 *
 * 一个动作两个按钮，差别只在 `note`：点「补充」时带上他写的话，它当普通消息进下一轮，模型据此
 * 重提一版；点「取消」不带，服务端替他说一句「先不按这个方案来」。
 */
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

/**
 * 整份替换会话已载入的创作套路 PUT /projects/:id/sessions/:sid/creative-skills（0028）。
 *
 * 载入与取消是同一条路由：空数组即全部取消。发整份而不是增删单条，因为界面手里本来就有
 * 完整的一份（它正在渲染那排胶囊），发整份是幂等的，也不存在「一个端删掉、另一个端又加
 * 回来」这种只有增量接口才有的中间态。
 *
 * `etag` 走 If-Match，与本服务其余会话写操作一致。会话每次变化都经 `session.updated` 事件
 * 带回新的 etag，所以界面手里的那个总是最新的；真撞上并发改动时 412，重读再来。
 */
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
      method: agentMethod('cancel_run'),
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
      method: agentMethod('retry_run'),
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify({ action_id: newIdempotencyKey() }),
    },
  );
}

/* 需求理解的三个客户端封装（列表 / confirm / correct）在 IKAI14 随确认门 UI 一并删除。
 *
 * agent 侧的端点仍然在，路由清单里也仍然有——后端那一层是刻意保留的。删的是**前端调用方**：
 * 确认这件事回到对话里由模型判断，浏览器不再自己发确认动作。留着三个没有调用方的封装，
 * 只会让下一个人以为那条路还活着。要恢复的话，从 AGENT_ROUTES 里的对应路由重新写即可。 */

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
      // 登录态走 HttpOnly 会话 cookie，浏览器自动携带
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
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

/* ============ 本会话累计消耗积分（IKAFPC） ============ */

/**
 * 本会话累计消耗。
 *
 * 三种「不是确切值」的情况分别有自己的字段，不要混：
 * - `credits === null`：**查不到**。有 Run 却一张能力券都没记下（多半是 agent 版本还没带上
 *   回写 `capability_id` 的那次改动）。这与「真的花了 0」是两回事，**不许显示成 0**。
 * - `matched === 0 && runCount > 0`：券号有，但上游账单还没写进去。计费日志是 post-billing
 *   才落库的，等一会儿再拉就有了。
 * - `truncated`：数是**下界**而非确切值（翻页到顶，或只有一部分 Run 留下了券号）。
 */
export interface SessionCredits {
  /** null = 查不到，不是 0。 */
  credits: number | null;
  quota: number | null;
  /** 命中的账单条数：0 且 runCount>0 说明账还没写进上游，不是真的没花钱 */
  matched: number;
  runCount: number;
  truncated: boolean;
}

/**
 * 取本会话累计消耗积分。
 *
 * 走 `/api/agent/billing/*` 而非 `/api/agent/v1/*`：后者是到 agent 服务的透传代理，
 * 这个端点的活儿（拿用户凭证去上游查账、按券号筛）只能在 BFF 做，agent 手里没有用户凭证。
 */
export function fetchSessionCredits(projectId: string, sessionId: string): Promise<SessionCredits> {
  return apiRequest<SessionCredits>(
    `/api/agent/billing/sessions/${encodeURIComponent(sessionId)}?project_id=${encodeURIComponent(projectId)}`,
    { silent: true },
  );
}
