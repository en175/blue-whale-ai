/* ============================================
 * 生成任务运行时（IKJJR1，IKIXK9-SPEC-20261002 A 节）
 *
 * 职责分工：
 *  - 运行时（runtime.ts）：共同任务锁、轮询调度、归属检查（项目/加载身份/承接/删除）、
 *    保存确认（recoveryChanges 显式状态）、恢复扫描对账。不复制画布状态——全部节点/
 *    连线读写经 GenerationRuntimeHost 走画布宿主。
 *  - 类型定义（GenerationTaskDefinition）：一个任务类型一份——身份识别、冻结输入、
 *    创建/重试/取消请求、结果转换、恢复关联与落卡策略。R2-R6 迁移工具家族时新增
 *    定义文件并注册，不改运行时。
 *  - 会话状态/纪元/界面提交锁归 IKIXK8 工具会话运行时，本模块不重复管理。
 * ============================================ */
import type {
  CanvasBinding, GenerationRecoveryItem, GenerationRecoveryPage, GenerationRecoveryRecord,
} from '@/api/canvasRecovery';
import type { JobDetail } from '@/api/jobs';

/** 画布节点在运行时眼中的形状（宿主裁剪投影；position/尺寸为发送时快照来源）。 */
export interface RuntimeNodeView {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  data: Record<string, unknown>;
}

/** 受保护节点标记（B.4）：data.generationRecovery。 */
export interface GenerationRecoveryMarker {
  protocolVersion: 1;
  submissionId: string;
  outputKey: string;
}

/** 恢复种子目标快照（B.3）：发送时目标位置/尺寸/名称。 */
export interface RecoverySeedTarget {
  role: 'draft' | 'existing-media' | 'result-placeholder';
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
}

/** 恢复种子来源快照（B.3）：实际画布来源节点。 */
export interface RecoverySeedSource {
  node_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
}

/** 组装 canvas_binding 所需的目标事实（页面在提交前从画布捕获，运行时不重读）。 */
export interface BindingTargetFacts {
  targetNodeId: string;
  seedTarget: RecoverySeedTarget;
  seedSources: RecoverySeedSource[];
  /** 目标当前归属版本；未知（无关联）为 0。 */
  expectedBindingRevision: number;
}

/** 创建/重试的受理结果（普通生成两入口同形；新协议回执可空——历史兼容提交无）。 */
export interface CreateJobOutcome {
  jobId: string;
  cursor?: number;
  canvasBinding?: {
    protocol_version: number;
    submission_id: string;
    target_node_id: string;
    binding_revision: number;
    job_id: string;
    is_current: boolean;
  } | null;
}

/** 成功结果的落卡投影：运行时核对归属后应用（一对一/多结果/保留占位三态）。 */
export type SuccessProjection =
  /** 一对一：结果落目标卡（marker 切 $target → primary，保存带 replaceTarget+apply）。 */
  | { kind: 'one-to-one' }
  /** 多结果：移除占位并按输出扇出（slot:/segment:/track: 卡，保存带 replaceTarget+逐项 apply）。 */
  | { kind: 'multi-output'; outputs: Array<{ outputKey: string; nodeId: string; assetId: string; url: string; mediaType: 'image' | 'video' | 'audio' }> }
  /** 成功但保留占位卡（投影歧义等防御路径：服务端拒绝输出投影时）。 */
  | { kind: 'keep-target' };

/** 类型定义收到的成功上下文。 */
export interface SuccessContext {
  nodeId: string;
  jobId: string;
  detail: JobDetail;
  marker: GenerationRecoveryMarker | null;
}

/** 一次提交的输入（页面按工具提交时机组好；运行时不解释业务参数）。 */
export interface TaskSubmissionInput<TPayload = unknown> {
  /** 业务载荷（创建端点 body 的业务部分；canvas_binding 由运行时注入）。 */
  payload: TPayload;
  /** 结果承接目标；undefined = 该类型创建不承接画布节点（保持原路径，不入运行时）。 */
  target?: BindingTargetFacts;
}

/**
 * 生成任务类型定义——新增任务类型 = 写一份这个并 runtime.register。
 * 共同锁/调度/归属检查/保存确认在运行时；这里只放类型真实差异。
 */
export interface GenerationTaskDefinition<TPayload = unknown> {
  /** 恢复记录分派键：覆盖的服务端 task_type 值（普通生成 = image/video/audio 三值）。 */
  readonly taskTypes: readonly string[];
  /** 身份识别：卡片 → 本类型？retry/cancel/remove 与水合恢复按此分派。
   *  必须排除已由其他家族承接的卡（节点 id 前缀家族 + data 身份键）。 */
  identify(nodeId: string, nodeData: Record<string, unknown>): boolean;
  /**
   * 冻结输入：失败卡重试需要客户端原输入时提供。null = 不可信（保留失败卡并提示
   * 重新编辑，不猜参数）；undefined = 冻结输入在服务端（retry 端点按原任务读取）。
   */
  frozenInput?(nodeId: string, nodeData: Record<string, unknown>): unknown | null;
  /**
   * 创建请求。canvas_binding 非空时运行时已保证：Idempotency-Key = submission_id。
   * 返回新协议回执（canvasBinding 字段）供台账登记。
   * IKJP8B：ownsExecution 由运行时传入的归属判定（项目/加载身份/当前执行/删除状态）；
   * 创建响应返回时已失效，或回执 is_current=false（意图被替代），定义方不得以 accepted
   * 唤醒会话等待者——受理身份不交给失效意图，等待者以失效失败收尾。
   */
  create(projectId: string, input: TaskSubmissionInput<TPayload>, binding: CanvasBinding | null, key: string, ownsExecution?: () => boolean): Promise<CreateJobOutcome>;
  /**
   * 失败卡重试请求：新 submission_id（独立提交身份），可复用 jobId（专属重试）或新建。
   *  不提供 = 该类型失败卡不支持服务端重试（运行时保留卡片并提示重新编辑）。
   *  IKJJR3：第三参为重试上下文（nodeData + 本卡 nodeId——客户端组冻结输入的工具
   *  （HD/插帧）需要以本卡 id 作为重发 target_node_id；服务端冻结输入的类型忽略 nodeId）。
   */
  retry?(projectId: string, jobId: string, ctx: { nodeId: string; nodeData: Record<string, unknown> }, binding: CanvasBinding | null, key: string): Promise<CreateJobOutcome>;
  /** 取消能力；无取消端点的类型不提供（remove 退化为直接移除）。 */
  cancel?(projectId: string, jobId: string): Promise<unknown>;
  /**
   * 恢复对账：恢复页一条记录 → 卡片规划。返回 'none' = 无画布动作。
   *  运行时负责判重、轮询续链与保存，不重复建卡。
   */
  planRecovery?(record: GenerationRecoveryRecord, host: GenerationRuntimeHost): RecoveryCardPlan;
  /**
   * 成功终态的多结果判定（可选；缺省 output_assets.length > 1）。多结果家族按可信终态
   * 数据判定：场景切分 1 段仍为 segment:1 多结果路径，不落入一对一 primary 转换。
   */
  isMultiOutputSuccess?(detail: JobDetail): boolean;
  /**
   * 多结果扇出落卡定制（可选；缺省横排 320 + 「生成-<jobId>-N」无来源线）。返回按输出
   * 的 position 与 data 基座 + 来源线；运行时强制覆盖 src/assetId/generationRecovery
   * marker（协议权威字段），并按规范 node_id 判重防重复建卡。
   */
  planFanoutCards?(ctx: FanoutContext): FanoutCardPlan;
}

/** 扇出落卡上下文（planFanoutCards 输入）：投影输出（产物已按可信 asset_id 匹配）+ 锚点。 */
export interface FanoutContext {
  jobId: string;
  submissionId: string;
  /** 扇出锚点 = 占位卡（扇出后移除）；位置/几何/入边（来源线反查）读取用。 */
  anchor: RuntimeNodeView | null;
  host: GenerationRuntimeHost;
  outputs: FanoutOutputView[];
  detail: JobDetail;
}

/** 扇出输出视图：恢复页投影项 + 任务详情产物（url 按可信 asset_id 匹配，缺失回落数组序）。 */
export interface FanoutOutputView {
  outputKey: string;
  nodeId: string;
  assetId: string | null;
  url: string;
  mediaType: 'image' | 'video' | 'audio';
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}

/** 扇出落卡计划：节点 data 基座（家族命名/尺寸/形态）+ 来源线（origin 标记）。 */
export interface FanoutCardPlan {
  nodes: Array<{ id: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ source: string; target: string; origin?: string }>;
}

/** 恢复规划：缺卡补卡 / 成功输出落卡 / 续轮询，由类型定义决定落卡策略。 */
export type RecoveryCardPlan =
  /** 目标卡缺失 → 按恢复种子/原目标快照补一张卡（受理回执丢失场景）。 */
  | { kind: 'restore-target'; node: RuntimeNodeView; edges?: Array<{ source: string; target: string }> }
  /** 成功且有未应用输出 → 按投影落卡（运行时拉详情取产物 URL 后扇出并带 apply 保存）。 */
  | { kind: 'apply-outputs'; projection: Extract<SuccessProjection, { kind: 'multi-output' }>; unavailableTarget?: RuntimeNodeView }
  /** 进行中 → 续轮询（卡已在或刚补）。 */
  | { kind: 'resume-polling' }
  /** 无画布动作（终态已收敛/被接管/历史关联）。 */
  | { kind: 'none' };

/** 运行时宿主：画布宿主（CanvasPage）注入的窄接口——运行时不复制画布状态。 */
export interface GenerationRuntimeHost {
  /** 当前项目；null = 未选中。 */
  getProjectId(): string | null;
  /** 文档加载身份：每次成功水合（doc 更替）推进；普通重渲染/移动/保存不变。 */
  getLoadEpoch(): object;
  // ── 画布读写 ──
  getMediaNodes(): RuntimeNodeView[];
  findNode(nodeId: string): RuntimeNodeView | null;
  patchNode(nodeId: string, patch: Record<string, unknown>): void;
  /** 插入媒体节点（宿主负责回调注入/撤销登记按宿主口径）。 */
  insertMediaNode(node: RuntimeNodeView): void;
  removeMediaNode(nodeId: string): void;
  getEdges(): Array<{ source: string; target: string }>;
  addEdge(source: string, target: string, role?: unknown, marker?: Record<string, unknown>): void;
  // ── 任务锁（页面共享登记 activeJobByNodeRef，未迁移家族同源） ──
  getActiveJob(nodeId: string): string | undefined;
  setActiveJob(nodeId: string, token: string): void;
  clearActiveJob(nodeId: string): void;
  // ── 迟到防线与删除意图（页面共享集合） ──
  isLocallyRemoved(nodeId: string): boolean;
  markLocallyRemoved(nodeId: string): void;
  registerPendingDelete(nodeId: string): void;
  isPendingDelete(nodeId: string): boolean;
  // ── 终态收敛器（页面共享实现，未迁移家族复用同一路径） ──
  applyTerminal(nodeId: string, jobId: string, detail: JobDetail): 'terminal' | 'processing';
  settleCancelled(nodeId: string): void;
  // ── 保存 ──
  saveCanvas(projectId: string): Promise<boolean>;
  // ── 恢复扫描取页（IKJKU9：扫描数据源 Query 化）──
  /** 恢复页读取经 Query 生命周期（资源旁 generationRecoveryPageOptions，按项目+游标
   *  key 隔离）：页面实现为 QueryClient.fetchQuery，再由运行时扫描编排对账推进游标。
   *  运行时内部定向读取（扇出投影/resolve）不经此，保持注入 Promise。 */
  fetchRecoveryPage(
    projectId: string,
    options: { limit?: number; cursor?: string | null },
  ): Promise<GenerationRecoveryPage>;
  // ── 反馈与账号 ──
  toast(kind: 'success' | 'warn' | 'error', message: string): void;
  openRechargeForCreditsError(e: unknown): boolean;
  addAuthResume(fn: () => void): void;
  // ── 资产字典 ──
  rememberAsset(asset: unknown, fallbackType: 'image' | 'video' | 'audio'): void;
}

/** 按卡只读在途状态（运行时公开）。 */
export interface InFlightTaskState {
  /** submitting = 创建请求在途；generating = 已受理轮询中；checking = 提交结果不明核对锁定。 */
  phase: 'submitting' | 'generating' | 'checking';
  jobId?: string;
  submissionId?: string;
}

/** 台账条目：恢复项的客户端已知服务端状态（受理回执/恢复页/保存回执/resolve 更新）。 */
export interface LedgerEntry {
  recoveryItemId: string;
  submissionId: string;
  outputKey: string;
  nodeId: string;
  state: GenerationRecoveryItem['state'];
  revision: number;
  /** 目标项的节点归属版本（新提交 expected_binding_revision 取它）。 */
  nodeBindingRevision?: number;
}

/** 运行时公开接口（测试接缝 = 这里；不测私有变量/Hook 顺序）。 */
export interface GenerationRuntime {
  register(def: GenerationTaskDefinition): void;
  /** 卡片是否归运行时处理（retry/cancel/remove/水合恢复分派）。 */
  claims(nodeId: string, nodeData: Record<string, unknown>): boolean;
  /** 五动作。submit 返回 false = 未发出（无项目/无承接目标/防重入）。 */
  submit<TPayload>(def: GenerationTaskDefinition<TPayload>, input: TaskSubmissionInput<TPayload>, options?: SubmitOptions): boolean;
  /** 返回 false = 卡不归运行时（调用方走原路径）；true = 已处理。
   *  IKJJR3：可选 options 与 submit 同形——重试受理成功的页面挂点（受理值写卡，如插帧
   *  frozenParams 的「受理即冻结」语义对重试路径同样成立）。 */
  retry(nodeId: string, options?: SubmitOptions): boolean;
  cancel(nodeId: string): boolean;
  remove(nodeId: string): boolean;
  /** 水合后恢复扫描（分页对账 v1；重复扫描不双轮询/不重复建卡）。 */
  recover(projectId: string): Promise<void>;
  /** 水合即时续轮询（扫描前乐观恢复，避免扫描延迟期间卡停摆）。
   *  nodeData 由水合调用方直供（水合 effect 期宿主 ref 尚未同步，不能反查节点）。 */
  resumeFromHydration(nodeId: string, jobId: string, nodeData?: Record<string, unknown>): void;
  /** 按卡只读在途状态。 */
  statusOf(nodeId: string): InFlightTaskState | null;
  /** 节点当前已知归属版本（提交 target facts 的 expected_binding_revision 来源；未知 0）。 */
  bindingRevisionOf(nodeId: string): number;
  /** 保存接缝：推导本笔保存的显式恢复字段；null = 普通保存（无待确认状态）。 */
  composeSaveFields(): { commandId: string; recoveryChanges: import('@/api/canvasRecovery').RecoveryChange[] } | null;
  /** 保存成功回执回填台账（含回放：仅确认，不覆盖新编辑）。 */
  onSaveReceipt(receipt: { commandId: string; replayed: boolean; changes: Array<{ recoveryItemId: string; revision: number; nodeBindingRevision: number; state: string }> }): void;
  /** 保存撞 409 项冲突后的定向对账（resolve 只读）：读回服务端现状进台账，不重发文档。 */
  reconcileConflictItems(projectId: string): Promise<void>;
  /** 项目切换/水合更替：清在途与台账（旧执行链由归属检查自行消亡）。 */
  reset(): void;
}

/** submit 选项（页面保留的提交时机差异）。 */
export interface SubmitOptions {
  /** 创建失败（受理前）页面特有收敛（余额不足/401 续跑/原位回退）。
   *  返回 true = 已处理，运行时跳过通用失败落卡。 */
  onCreateFailure?(e: unknown, ctx: { nodeId: string; target?: BindingTargetFacts }): boolean;
  /** IKJJR3：受理成功（POST 200、轮询启动前）页面挂点——受理值写卡（如插帧 frozenParams、
   *  HD lastParams 的「受理即冻结」语义）。运行时已 patchNode(jobId)，回调只补家族字段。 */
  onAccepted?(ctx: { nodeId: string; jobId: string; submissionId: string | null }): void;
  /** IKJP8B：本次提交不会受理到底——预保存返回时执行已失效（重载/切换/reset/删除）、
   *  回执被替代（is_current=false）、创建未发出（保存失败）或创建迟到失效。
   *  等待受理结果的会话必须在此收尾自己的等待与锁（旧 watcher Promise settle），
   *  不落任何画布状态。 */
  onStale?(ctx: { nodeId: string }): void;
}
