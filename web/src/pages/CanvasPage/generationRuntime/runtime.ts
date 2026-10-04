/* ============================================
 * 生成任务运行时（IKJJR1）：从提交开始统一管理任务后续生命周期。
 * 共同任务锁（按卡操作轮次）、轮询调度、归属检查（项目/文档加载身份/当前承接/删除状态）、
 * 保存确认（recoveryChanges 显式状态推导）与恢复扫描对账集中在此；任务差异在类型定义。
 * 复用画布宿主（GenerationRuntimeHost）与既有 API 客户端，不复制画布状态。
 * ============================================ */
import { fetchJobStatus, type JobDetail } from '@/api/jobs';
import { isApiError, envelopeErrorCode } from '@/api/http';
import {
  fetchGenerationRecoveryPage, resolveGenerationRecovery,
  type GenerationRecoveryRecord, type RecoveryChange,
} from '@/api/canvasRecovery';
import { newIdempotencyKey } from '@/api/idempotencyKey';
import type {
  GenerationRuntime, GenerationRuntimeHost, GenerationTaskDefinition, InFlightTaskState,
  LedgerEntry, SubmitOptions, TaskSubmissionInput, RuntimeNodeView, CreateJobOutcome,
} from './types';
import { seedTargetOfNode, seedSourcesOfNode } from './seedFacts';

export type { GenerationRuntime, GenerationRuntimeHost, GenerationTaskDefinition, InFlightTaskState } from './types';

/** 轮询间隔：处理中 2.5s，传输失败退避 5s（口径同页面旧轮询）。 */
const POLL_INTERVAL_MS = 2500;
const POLL_ERROR_INTERVAL_MS = 5000;
const TARGET_OUTPUT_KEY = '$target';
const PRIMARY_OUTPUT_KEY = 'primary';

/** 运行时可注入依赖（测试接缝：可控 API 响应与时钟）。 */
export interface GenerationRuntimeDeps {
  fetchJobStatus?: typeof fetchJobStatus;
  fetchRecoveryPage?: typeof fetchGenerationRecoveryPage;
  resolveItems?: typeof resolveGenerationRecovery;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  newId?: () => string;
}

/** 在途执行登记（内部）。 */
interface ActiveExecution {
  round: string;
  projectId: string;
  loadEpoch: object;
  nodeId: string;
  phase: 'submitting' | 'generating' | 'checking';
  jobId?: string;
  submissionId?: string;
  /** 提交目标角色（取消回退 settleTarget 判定用）。 */
  targetRole?: 'draft' | 'existing-media' | 'result-placeholder';
  /** 分派来源类型（ensureExecution/水合恢复登记用）。 */
  def?: GenerationTaskDefinition;
}

/** 转换/回退意图：在场差分表达不了、需显式动作的状态。 */
type ExplicitIntent =
  | { kind: 'convert' } // 成功转换：replaceTarget($target) + apply(primary/逐输出)
  | { kind: 'settle' }; // 取消保留卡：settleTarget（角色 draft/existing-media）

export function createGenerationRuntime(host: GenerationRuntimeHost, deps: GenerationRuntimeDeps = {}): GenerationRuntime {
  const doFetchJobStatus = deps.fetchJobStatus ?? fetchJobStatus;
  const doFetchRecoveryPage = deps.fetchRecoveryPage ?? fetchGenerationRecoveryPage;
  const doResolveItems = deps.resolveItems ?? resolveGenerationRecovery;
  const schedule = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const unschedule = deps.clearTimeout ?? ((id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>));
  const newId = deps.newId ?? newIdempotencyKey;

  const defs: GenerationTaskDefinition[] = [];
  /** 按卡在途登记（共同任务锁的运行时半边；页面 activeJobByNodeRef 为共享登记处）。 */
  const active = new Map<string, ActiveExecution>();
  const timers = new Map<string, unknown>();
  /** 恢复台账：recoveryItemId → 服务端已知状态。 */
  const ledger = new Map<string, LedgerEntry>();
  /** 已完成对账的提交（删除差分只对已对账条目发出，防扫描窗口误删补卡）。 */
  const reconciledSubmissions = new Set<string>();
  /** 产物不可用而未落卡的项，不得将素材缺失推断为用户删除。 */
  const unavailableOutputItems = new Set<string>();
  const intents = new Map<string, ExplicitIntent>();
  /** 已知节点归属版本（nodeId → binding_revision）。 */
  const nodeBindings = new Map<string, number>();
  /** 已知「有受理关联」的 jobId（重试是否可携 canvas_binding 的判据）。 */
  const boundJobIds = new Set<string>();
  const deleting = new Set<string>();
  /** 重试意图窗口：nodeId → 未受理重试（幂等键 = submission_id）。 */
  const retryAttempts = new Map<string, { jobId: string; key: string; bound: boolean }>();
  /** 重试在途同步防重（IKJJR3）：React state 异步窗口内的连点兜底，受理/失败收敛即解锁。 */
  const retryInFlight = new Set<string>();
  /** 提交意图窗口：nodeId → 未受理提交（同载荷签名复用同一把 submission_id——双击/401 续跑/
   *  响应丢失原样重发；载荷一改即换新，受理即作废。口径同页面旧 jobSubmitKeys 台账）。 */
  const submitAttempts = new Map<string, { signature: string; key: string }>();
  let roundCounter = 0;
  const nextRound = () => `grt-${++roundCounter}-${newId().slice(0, 8)}`;

  // ── 工具 ──
  const recoveryItemIdOf = (submissionId: string, outputKey: string) => `gcr:${submissionId}:${outputKey}`;
  const readMarker = (data: Record<string, unknown> | undefined): { protocolVersion: number; submissionId: string; outputKey: string } | null => {
    const marker = data?.generationRecovery;
    if (marker == null || typeof marker !== 'object') return null;
    const { protocolVersion, submissionId, outputKey } = marker as Record<string, unknown>;
    if (protocolVersion !== 1 || typeof submissionId !== 'string' || typeof outputKey !== 'string') return null;
    return { protocolVersion: 1, submissionId, outputKey };
  };
  const defForNode = (nodeId: string): { def: GenerationTaskDefinition; node: RuntimeNodeView } | null => {
    const node = host.findNode(nodeId);
    if (!node) return null;
    const def = defs.find((candidate) => candidate.identify(node.id, node.data ?? {}));
    return def ? { def, node } : null;
  };
  const defForRecord = (record: GenerationRecoveryRecord): GenerationTaskDefinition | undefined =>
    defs.find((candidate) => candidate.taskTypes.includes(record.task_type));
  /** 归属检查（A.8）：每次异步返回核对项目、加载身份、当前承接与删除状态。 */
  const owns = (execution: ActiveExecution, jobId?: string): boolean => {
    // 水合恢复的执行 projectId=''：只以加载身份守卫（epoch 随 doc 更替推进，已覆盖切项目/重载）
    if (execution.projectId !== '' && host.getProjectId() !== execution.projectId) return false;
    if (host.getLoadEpoch() !== execution.loadEpoch) return false;
    if (host.isLocallyRemoved(execution.nodeId)) return false;
    const entry = active.get(execution.nodeId);
    if (entry !== execution) return false;
    if (jobId !== undefined && entry.jobId !== undefined && entry.jobId !== jobId) return false;
    return true;
  };
  const clearTimer = (nodeId: string) => {
    const timer = timers.get(nodeId);
    if (timer !== undefined) {
      unschedule(timer);
      timers.delete(nodeId);
    }
  };
  const setLedger = (entry: LedgerEntry) => { ledger.set(entry.recoveryItemId, entry); };
  /** 受理回执（创建/重试）落入台账：$target pending/1 + 归属版本。 */
  const adoptBindingView = (view: { submission_id: string; target_node_id: string; binding_revision: number; job_id: string }) => {
    nodeBindings.set(view.target_node_id, view.binding_revision);
    boundJobIds.add(String(view.job_id));
    reconciledSubmissions.add(view.submission_id);
    setLedger({
      recoveryItemId: recoveryItemIdOf(view.submission_id, TARGET_OUTPUT_KEY),
      submissionId: view.submission_id,
      outputKey: TARGET_OUTPUT_KEY,
      nodeId: view.target_node_id,
      state: 'pending',
      revision: 1,
      nodeBindingRevision: view.binding_revision,
    });
  };
  /** 新协议受控错误判别（B.8）。 */
  const recoveryReason = (e: unknown): string | null => {
    if (!isApiError(e) || typeof (e.data as { reason?: unknown } | null)?.reason !== 'string') return null;
    return (e.data as { reason: string }).reason;
  };

  /** 取消保留卡（草稿/既有素材角色）的回退意图：下次保存以 settleTarget 显式确认。 */
  const queueSettleIntent = (execution: ActiveExecution) => {
    if (host.findNode(execution.nodeId) == null || execution.submissionId == null) return;
    if (execution.targetRole !== 'draft' && execution.targetRole !== 'existing-media') return;
    intents.set(execution.submissionId, { kind: 'settle' });
  };

  // ── 轮询与终态 ──
  const poll = (execution: ActiveExecution, jobId: string) => {
    clearTimer(execution.nodeId);
    const tick = () => {
      doFetchJobStatus(jobId)
        .then((detail) => {
          if (!owns(execution, jobId)) return; // 迟到旧任务响应——丢弃且不续链
          if (detail.status === 'succeeded' || detail.status === 'failed' || detail.status === 'cancelled') {
            timers.delete(execution.nodeId);
            converge(execution, jobId, detail);
            return;
          }
          if (detail.status === 'checking') {
            execution.phase = 'checking';
            host.patchNode(execution.nodeId, { genStatus: 'checking', progress: undefined });
          } else {
            execution.phase = 'generating';
            host.patchNode(execution.nodeId, { progress: detail.progress });
          }
          timers.set(execution.nodeId, schedule(tick, POLL_INTERVAL_MS));
        })
        .catch(() => {
          if (!owns(execution, jobId)) return; // 旧执行不清新锁：只有自己仍在途才续链
          timers.set(execution.nodeId, schedule(tick, POLL_ERROR_INTERVAL_MS));
        });
    };
    tick();
  };

  /** 终态收敛：经页面共享收敛器落卡，再按类型投影写 marker + 显式意图 + 保存确认。 */
  const converge = (execution: ActiveExecution, jobId: string, detail: JobDetail) => {
    const nodeId = execution.nodeId;
    clearTimer(nodeId);
    const mediaType = detail.asset?.type === 'video' || detail.asset?.type === 'audio' ? detail.asset.type : 'image';
    if (detail.status === 'succeeded') host.rememberAsset(detail.asset, mediaType);
    host.applyTerminal(nodeId, jobId, detail); // 失败/取消/删除意图接管在收敛器内
    if (detail.status === 'cancelled') {
      active.delete(nodeId);
      host.clearActiveJob(nodeId);
      queueSettleIntent(execution); // 取消保留卡：下次保存 settleTarget（草稿/既有素材角色）
      return;
    }
    if (detail.status === 'failed') {
      active.delete(nodeId);
      host.clearActiveJob(nodeId);
      return;
    }
    const finishExecution = () => {
      if (active.get(nodeId) !== execution) return; // 已被新执行接管：不清新锁
      active.delete(nodeId);
      host.clearActiveJob(nodeId);
    };
    if (host.findNode(nodeId) == null) { finishExecution(); return; } // 终态前卡已被删（删除意图接管）
    // IKJJR3：成功终态回写 jobId——水合/恢复接续的执行链（卡上仍是持久化的旧任务 id）
    // 由本行收敛为当前任务；提交/重试路径已写同值，幂等。
    if (detail.status === 'succeeded') host.patchNode(nodeId, { jobId });
    const submissionId = execution.submissionId ?? readMarker(host.findNode(nodeId)!.data)?.submissionId ?? null;
    if (submissionId == null) { finishExecution(); return; } // 历史兼容任务：无受理关联，不写 marker/不确认
    const outputs = detail.output_assets ?? [];
    // 多结果判定先问类型定义（多结果家族按可信终态数据：场景切分 1 段仍为 segment 路径）
    const multi = execution.def?.isMultiOutputSuccess?.(detail) ?? outputs.length > 1;
    if (multi) {
      // 多结果扇出的首个 await 后仍需通过归属检查：在途登记保留至扇出收尾
      void fanOutOutputs(execution, submissionId, jobId, detail).finally(finishExecution);
      return;
    }
    // 一对一：结果落目标卡，marker 切 $target → primary；保存带 replaceTarget + apply(primary)。
    finishExecution();
    host.patchNode(nodeId, { generationRecovery: { protocolVersion: 1, submissionId, outputKey: PRIMARY_OUTPUT_KEY } });
    intents.set(submissionId, { kind: 'convert' });
    setLedger({
      recoveryItemId: recoveryItemIdOf(submissionId, PRIMARY_OUTPUT_KEY),
      submissionId, outputKey: PRIMARY_OUTPUT_KEY, nodeId,
      state: 'pending', revision: 0,
    });
  };

  /** 多结果扇出（输出槽/场景切分/人声分离家族）：输出键经恢复页投影取规范 node_id（B.4/B.5），
   *  再建卡落 apply。落卡细节（排列/命名/来源线）可由类型定义 planFanoutCards 定制；运行时
   *  强制写协议权威字段（src/assetId/marker）并按规范 node_id 判重——重复返回/重复扫描不重复建卡。
   *  IKJKU4（F5）：knownRecord 为已核验恢复记录（恢复扫描直供），扇出不再重拉恢复页；
   *  无已知记录（轮询终态）时按游标遍历后续页找回该提交——不把首屏查询当成按提交查询
   *  （恢复页排序与游标编码是契约行为，遍历整本的页数成本与恢复扫描同阶）。 */
  const fanOutOutputs = async (execution: ActiveExecution, submissionId: string, jobId: string, knownDetail?: JobDetail, knownRecord?: GenerationRecoveryRecord) => {
    const nodeId = execution.nodeId;
    try {
      if (!owns(execution, jobId)) return; // 过期执行零请求零写入（含降级占位 patch）
      let record = knownRecord ?? null;
      if (record == null) {
        let cursor: string | null = null;
        do {
          const page = await doFetchRecoveryPage(execution.projectId, { cursor });
          if (!owns(execution, jobId)) return; // 翻页间隙归属过期：零写入
          record = page.records.find((item) => item.submission_id === submissionId) ?? null;
          cursor = page.next_cursor;
        } while (record == null && cursor != null);
      }
      const outputs = record?.items.filter((item) => item.output_key !== TARGET_OUTPUT_KEY
        && item.state !== 'removed' && item.state !== 'transferred') ?? [];
      if (outputs.length === 0) {
        // 投影缺失（服务端歧义拒绝 recovery_projection_invalid）：保留目标卡为成功占位（无 marker），不扇出不丢卡
        host.patchNode(nodeId, { genStatus: undefined, progress: 100 });
        return;
      }
      const detail = knownDetail ?? await doFetchJobStatus(jobId).catch(() => null);
      if (!owns(execution, jobId)) return; // 详情返回（成功/失败均含）复核：过期执行零宿主写入（A.8）
      const assets = detail?.output_assets ?? (detail?.asset ? [detail.asset] : []);
      // 非空资产引用严格匹配；只有无引用的一对一 primary 允许同源结果回退。
      const views = outputs.flatMap((item) => {
        const asset = item.asset_id != null
          ? assets.find((a) => String(a.id) === String(item.asset_id))
          : outputs.length === 1 && item.output_key === PRIMARY_OUTPUT_KEY && item.node_id === nodeId && assets.length === 1
            ? assets[0] : undefined;
        if (asset == null || !asset.id || typeof asset.url !== 'string' || !asset.url.trim()
          || (asset.type !== 'video' && asset.type !== 'audio' && asset.type !== 'image')) return [];
        return [{
          outputKey: item.output_key,
          nodeId: item.node_id,
          assetId: asset.id,
          url: asset.url,
          mediaType: asset.type,
          ...(asset.width != null ? { width: asset.width } : {}),
          ...(asset.height != null ? { height: asset.height } : {}),
          ...(asset.duration != null ? { duration: asset.duration } : {}),
        }];
      });
      if (views.length !== outputs.length) {
        for (const item of outputs) unavailableOutputItems.add(item.recovery_item_id);
        if (host.findNode(nodeId) == null) {
          const seed = record?.recovery_seed?.target;
          const snapshot = record?.previous_target_snapshot as Partial<RuntimeNodeView> | null;
          const plan = record && execution.def?.planRecovery?.(record, host);
          const plannedTarget = plan?.kind === 'apply-outputs' ? plan.unavailableTarget : undefined;
          host.insertMediaNode({
            id: nodeId, type: 'mediaNode',
            position: snapshot?.position ?? plannedTarget?.position ?? { x: seed?.x ?? 0, y: seed?.y ?? 0 },
            data: {
              ...plannedTarget?.data,
              fileName: seed?.name || plannedTarget?.data.fileName || '生成结果',
              mediaType: plannedTarget?.data.mediaType ?? (record?.task_type === 'video_scene_split' || record?.task_type === 'video' ? 'video'
                : record?.task_type === 'vocal_split' || record?.task_type === 'audio' ? 'audio' : 'image'),
              ...(seed ? { width: seed.width, height: seed.height } : {}),
              ...(snapshot?.width != null ? { width: snapshot.width } : {}),
              ...(snapshot?.height != null ? { height: snapshot.height } : {}),
              ...snapshot?.data, jobId,
            },
          });
          for (const source of record?.recovery_seed?.sources ?? []) {
            if (host.findNode(source.node_id) != null) host.addEdge(source.node_id, nodeId);
          }
        }
        host.patchNode(nodeId, { genStatus: undefined, progress: 100 });
        host.toast('warn', '生成结果当前不可用，原卡已保留，请核对素材');
        active.delete(nodeId);
        host.clearActiveJob(nodeId);
        return; // 整批零转换，不将其余产物作为全部完成。
      }
      for (const item of outputs) unavailableOutputItems.delete(item.recovery_item_id);
      const anchor = host.findNode(nodeId);
      const anchorPos = anchor?.position ?? { x: 0, y: 0 };
      const def = execution.def;
      const plan = def?.planFanoutCards
        ? def.planFanoutCards({ jobId, submissionId, anchor, host, outputs: views, detail: detail ?? ({} as JobDetail) })
        : {
          nodes: views.map((item, index) => ({
            id: item.nodeId,
            position: { x: Math.round(anchorPos.x + index * 320), y: Math.round(anchorPos.y + 260) },
            data: { fileName: `生成-${jobId}-${index + 1}`, mediaType: item.mediaType, jobId },
          })),
          edges: [],
        };
      const cardByNodeId = new Map(plan.nodes.map((card) => [card.id, card]));
      // 一对一家族 primary 复用 target node_id：占位卡即结果卡，跳过移除重建
      //（恢复扫描扇出时保住已成功保存的卡与用户编辑，R7/B.3）。
      const reusesTarget = outputs.some((item) => item.node_id === nodeId);
      if (!reusesTarget) {
        host.markLocallyRemoved(nodeId);
        host.removeMediaNode(nodeId);
      }
      outputs.forEach((item) => {
        const card = cardByNodeId.get(item.node_id);
        if (card == null) return; // 定制未覆盖该输出（防御）：不建卡，台账仍登记
        const view = views.find((candidate) => candidate.nodeId === item.node_id);
        const existing = host.findNode(item.node_id);
        const existingMarker = readMarker(existing?.data);
        const applied = existing != null && existingMarker != null
          && existingMarker.submissionId === submissionId && existingMarker.outputKey === item.output_key;
        if (existing == null) { // 判重：规范 node_id 确定性 = 扇出幂等
          host.insertMediaNode({
            id: item.node_id,
            type: 'mediaNode',
            position: card.position,
            data: {
              ...card.data,
              src: view?.url ?? '',
              ...(view?.assetId != null ? { assetId: view.assetId } : {}),
              generationRecovery: { protocolVersion: 1, submissionId, outputKey: item.output_key },
            },
          });
        } else if (!applied) {
          // IKJKU3 原位写入已有卡（一对一原卡在场、受理回执丢失）：写可信素材（src/assetId）、
          // 任务身份（jobId）与 primary 标记；不重建卡、不覆盖用户已保存的名称/位置/尺寸
          // （B.3/B.6 普通编辑优先），转换以同笔 replaceTarget/apply 保存确认。
          host.patchNode(item.node_id, {
            src: view?.url ?? '',
            ...(view?.assetId != null ? { assetId: view.assetId } : {}),
            jobId,
            ...(view?.mediaType != null ? { mediaType: view.mediaType } : {}),
            ...(view?.duration != null ? { duration: view.duration } : {}),
            generationRecovery: { protocolVersion: 1, submissionId, outputKey: item.output_key },
            genStatus: undefined,
            progress: 100,
          });
        }
        // applied：已应用成品卡零写入（重复恢复/他端已扇出，幂等）
        setLedger({
          recoveryItemId: item.recovery_item_id,
          submissionId, outputKey: item.output_key, nodeId: item.node_id,
          state: item.state, revision: item.revision, // 已 present 的项保持原状态（不置回 pending 重复 apply）
        });
      });
      for (const edge of plan.edges) {
        host.addEdge(edge.source, edge.target, undefined, edge.origin != null ? { origin: edge.origin } : undefined);
      }
      intents.set(submissionId, { kind: 'convert' });
      const fanOutProject = host.getProjectId() ?? execution.projectId;
      if (fanOutProject) void host.saveCanvas(fanOutProject).catch(() => {}); // 扇出同笔落盘（家族先例：防刷新占位卡复活）
    } catch (e) {
      console.warn('[generation-runtime] 多结果投影失败，占位卡保留:', e);
      if (!owns(execution, jobId)) return; // 异常路径同守卫：过期执行不 patch 当前画布
      host.patchNode(nodeId, { genStatus: undefined, progress: 100 });
    }
  };

  // ── 五动作 ──
  const submit = <TPayload,>(def: GenerationTaskDefinition<TPayload>, input: TaskSubmissionInput<TPayload>, options?: SubmitOptions): boolean => {
    const projectId = host.getProjectId();
    if (!projectId) return false;
    const target = input.target;
    if (!target) return false; // 本运行时承载画布承接型任务；无目标提交保持原路径
    const nodeId = target.targetNodeId;
    const existing = active.get(nodeId);
    if (existing && existing.phase === 'submitting') return false; // 创建窗口防重入（重复点击）
    const execution: ActiveExecution = {
      round: nextRound(), projectId, loadEpoch: host.getLoadEpoch(), nodeId,
      phase: 'submitting', targetRole: target.seedTarget.role, def,
    };
    host.setActiveJob(nodeId, execution.round);
    active.set(nodeId, execution);

    const signature = JSON.stringify(input.payload);
    const previousAttempt = submitAttempts.get(nodeId);
    const key = previousAttempt && previousAttempt.signature === signature
      ? previousAttempt.key
      : newId(); // submission_id = Idempotency-Key（新协议承载一致性）
    submitAttempts.set(nodeId, { signature, key });
    const buildBinding = (expectedRevision: number) => ({
      protocol_version: 1 as const,
      submission_id: key,
      target_node_id: target.targetNodeId,
      expected_binding_revision: expectedRevision,
      recovery_seed: { target: target.seedTarget, sources: target.seedSources },
    });
    nodeBindings.set(nodeId, Math.max(nodeBindings.get(nodeId) ?? 0, target.expectedBindingRevision));

    /** 恢复种子角色为 draft/existing-media：目标必须已在服务端画布（B.3），先落盘再提交。 */
    const sendOnce = async (binding: ReturnType<typeof buildBinding> | null) => {
      if (binding && binding.recovery_seed.target.role !== 'result-placeholder') {
        const saved = await host.saveCanvas(projectId).catch(() => false);
        if (!saved) return null; // 保存失败不发：防服务端按未保存目标 400 拒绝（下轮水合/用户重试接续）
      }
      return def.create(projectId, input, binding, key);
    };
    const send = (): Promise<CreateJobOutcome | null> => sendOnce(buildBinding(target.expectedBindingRevision));
    send()
      .then(async (created) => {
        if (created === null) {
          throw Object.assign(new Error('画布保存失败，未提交生成任务'), { _skipped: true });
        }
        if (!owns(execution)) return;
        const view = created.canvasBinding ?? null;
        if (view && view.is_current === false) {
          // 意图已被替代（他端接管）：不用同 jobId 状态更新旧意图，卡由新承接收敛
          active.delete(nodeId);
          host.clearActiveJob(nodeId);
          submitAttempts.delete(nodeId);
          return;
        }
        if (view) {
          execution.submissionId = view.submission_id;
          adoptBindingView(view);
        }
        // 回执无 canvas_binding 视图 = 绑定未被服务端确认（部署窗口/兼容端点）：不落台账、
        // 不写 marker——该次按历史兼容任务追踪，恢复扫描按服务端事实纠偏。
        submitAttempts.delete(nodeId); // 受理即作废：之后再提交是另一次意图
        execution.jobId = String(created.jobId);
        execution.phase = 'generating';
        host.patchNode(nodeId, { jobId: created.jobId });
        options?.onAccepted?.({ nodeId, jobId: String(created.jobId), submissionId: execution.submissionId ?? null });
        poll(execution, String(created.jobId));
      })
      .catch((e: unknown) => {
        if (!owns(execution)) return; // 旧执行不得改当前归属版本或画布
        // 受理冲突（他端先一步推进归属，IKJKU1）：不采纳服务端版本重发——保留用户输入
        // 与画布内容按创建失败收敛；服务端版本进归属台账，复核后的新意图用新 submission_id。
        const bindingConflict = isApiError(e) && e.status === 409 && recoveryReason(e) === 'canvas_binding_conflict';
        if (bindingConflict) {
          const current = (e.data as { currentBindingRevision?: unknown }).currentBindingRevision;
          if (typeof current === 'number' && current > (nodeBindings.get(nodeId) ?? 0)) {
            nodeBindings.set(nodeId, current);
          }
        }
        active.delete(nodeId);
        if (bindingConflict) submitAttempts.delete(nodeId); // 意图已被服务端拒绝：复核后再发是独立新意图
        if ((e as { _skipped?: boolean })._skipped) {
          host.toast('error', '画布保存失败，生成任务未提交，请重试保存后再发送');
          options?.onCreateFailure?.(e, { nodeId, target });
          return;
        }
        const handled = options?.onCreateFailure?.(e, { nodeId, target });
        if (handled) return;
        if (host.findNode(nodeId) == null) return;
        host.patchNode(nodeId, {
          genStatus: 'failed',
          errorText: bindingConflict ? '卡片归属已变化，请复核后再发送' : (isApiError(e) ? e.message : '创建任务失败'),
          errorCode: isApiError(e) ? envelopeErrorCode(e) : undefined,
        });
      });
    return true;
  };

  const retry = (nodeId: string, options?: SubmitOptions): boolean => {
    const claimed = defForNode(nodeId);
    if (!claimed) return false;
    const { def, node } = claimed;
    const data = node.data ?? {};
    if (data.genStatus === 'generating' || data.genStatus === 'checking') return true; // 防重入
    // IKJJR3：同步防重（用户故事 5 同款保护覆盖重试路径）——patchNode 经 React state 异步
    // 生效，同一事件循环内的连点（React 18 批处理窗口）读不到新 genStatus，需同步登记兜底。
    if (retryInFlight.has(nodeId)) return true;
    retryInFlight.add(nodeId);
    // IKJJR3：jobId 可缺——冻结输入重发家族（视频处理七类）重试 = 原样重发创建端点，
    // 不依赖原任务 id（草稿/受理回执丢失形态的失败卡）；服务端冻结输入的类型（普通生成）
    // 卡必有 jobId（identify 前提），不受影响。
    const jobIdRaw = data.jobId;
    const projectId = host.getProjectId();
    if (!projectId) { host.toast('warn', '未选中项目，无法重试'); return true; }
    const jobId = jobIdRaw == null ? '' : String(jobIdRaw);
    const frozen = def.frozenInput?.(nodeId, data);
    if (frozen === null) {
      // 不可信冻结输入（A.6）：保留失败卡并提示重新编辑，不猜参数
      host.toast('warn', '原任务输入已不可信，请重新编辑后再发送');
      return true;
    }
    if (!def.retry) {
      host.toast('warn', '该任务暂不支持失败重试，请重新发送');
      return true;
    }
    const marker = readMarker(data);
    const canBind = marker != null || (jobId !== '' && boundJobIds.has(jobId));
    const targetEntry = marker != null ? ledger.get(recoveryItemIdOf(marker.submissionId, TARGET_OUTPUT_KEY)) : undefined;
    const expectedRevision = nodeBindings.get(nodeId) ?? targetEntry?.nodeBindingRevision ?? 0;
    const previous = retryAttempts.get(nodeId);
    const key = previous && previous.jobId === jobId && previous.bound === canBind ? previous.key : newId();
    retryAttempts.set(nodeId, { jobId, key, bound: canBind });

    const seedTarget = seedTargetOfNode(node);
    const seedSources = seedSourcesOfNode(nodeId, host);
    const binding = canBind
      ? {
        protocol_version: 1 as const,
        submission_id: key,
        target_node_id: nodeId,
        expected_binding_revision: expectedRevision,
        recovery_seed: { target: seedTarget, sources: seedSources },
      }
      : null;
    const execution: ActiveExecution = {
      round: nextRound(), projectId, loadEpoch: host.getLoadEpoch(), nodeId,
      phase: 'submitting', targetRole: seedTarget.role, def,
    };
    host.setActiveJob(nodeId, execution.round);
    active.set(nodeId, execution);
    host.patchNode(nodeId, { genStatus: 'generating', progress: 0, errorText: '', errorCode: undefined });

    // 重试不前置保存（IKDMQV 契约「不读画布不落盘」）：目标卡在提交时已按角色落盘或经水合在服务端。
    def.retry!(projectId, jobId, { nodeId, nodeData: data }, binding, key)
      .then((created) => {
        if (!owns(execution)) return;
        retryInFlight.delete(nodeId);
        retryAttempts.delete(nodeId);
        const view = created.canvasBinding ?? null;
        if (view && view.is_current === false) { active.delete(nodeId); host.clearActiveJob(nodeId); return; }
        if (view) { execution.submissionId = view.submission_id; adoptBindingView(view); }
        execution.jobId = String(created.jobId);
        execution.phase = 'generating';
        host.patchNode(nodeId, { jobId: created.jobId });
        options?.onAccepted?.({ nodeId, jobId: String(created.jobId), submissionId: execution.submissionId ?? null });
        poll(execution, String(created.jobId));
      })
      .catch((e: unknown) => {
        if (!owns(execution)) return;
        retryInFlight.delete(nodeId);
        active.delete(nodeId);
        if (host.openRechargeForCreditsError(e)) {
          host.patchNode(nodeId, {
            genStatus: 'failed',
            errorText: isApiError(e) ? e.message : '余额不足',
            errorCode: isApiError(e) ? envelopeErrorCode(e) : undefined,
          });
          return;
        }
        if (isApiError(e) && e.status === 401) {
          host.patchNode(nodeId, { genStatus: 'failed', errorText: '', errorCode: undefined });
          host.addAuthResume(() => { runtime.retry(nodeId); });
          return;
        }
        if (host.findNode(nodeId) == null) return;
        host.patchNode(nodeId, {
          genStatus: 'failed',
          errorText: isApiError(e) ? e.message : '重试失败',
          errorCode: isApiError(e) ? envelopeErrorCode(e) : undefined,
        });
      });
    return true;
  };

  const cancel = (nodeId: string): boolean => {
    const claimed = defForNode(nodeId);
    if (!claimed) return false;
    const cancelMarker = readMarker(claimed.node.data);
    if (cancelMarker != null && cancelMarker.outputKey !== TARGET_OUTPUT_KEY) return true; // 结果成品卡无可取消任务
    const jobIdRaw = claimed.node.data?.jobId;
    if (jobIdRaw == null || !host.getProjectId() || !claimed.def.cancel) return true;
    const projectId = host.getProjectId()!;
    const jobId = String(jobIdRaw);
    const execution = ensureExecution(nodeId, claimed.def, jobId);
    claimed.def.cancel(projectId, jobId)
      .then(() => doFetchJobStatus(jobId).catch(() => null))
      .then((detail) => {
        if (!owns(execution, jobId)) return; // 迟到响应：已删除/已被新任务接管
        if (detail && (detail.status === 'succeeded' || detail.status === 'failed')) {
          converge(execution, jobId, detail); // 权威终态优先于取消确认：成功抢先保留作品
          return;
        }
        if (detail?.status === 'cancelled') {
          active.delete(nodeId);
          host.clearActiveJob(nodeId);
          host.settleCancelled(nodeId); // 草稿回待生成/原素材恢复/空占位移除
          queueSettleIntent(execution);
          return;
        }
        host.toast('warn', '取消已请求，正在等待任务停止');
      })
      .catch((e: unknown) => {
        host.toast('error', isApiError(e) ? `取消失败：${e.message}` : '取消失败，请稍后重试');
      });
    return true;
  };

  const remove = (nodeId: string): boolean => {
    const claimed = defForNode(nodeId);
    if (!claimed) return false;
    const claimedMarker = readMarker(claimed.node.data);
    if (claimedMarker != null && claimedMarker.outputKey !== TARGET_OUTPUT_KEY) {
      // 成功转换后的结果卡（marker 非 $target）：任务已终态，不走取消确认流——直接移除，
      // 保存差分按台账发 remove（B.6 逐项删除；含首次保存前删除的虚拟输出）。
      host.markLocallyRemoved(nodeId);
      host.removeMediaNode(nodeId);
      return true;
    }
    const jobIdRaw = claimed.node.data?.jobId;
    if (jobIdRaw == null || !host.getProjectId() || !claimed.def.cancel) {
      host.removeMediaNode(nodeId); // 无任务可取消（异常态）：退回直接移除，避免删除入口卡死
      return true;
    }
    const projectId = host.getProjectId()!;
    const jobId = String(jobIdRaw);
    if (deleting.has(nodeId)) return true; // 同卡删除往返只发起一次
    deleting.add(nodeId);
    const finish = () => { deleting.delete(nodeId); };
    const execution = ensureExecution(nodeId, claimed.def, jobId);
    const stopWithCompleted = (detail: JobDetail) => {
      converge(execution, jobId, detail);
      host.toast('warn', '任务已完成，已停止删除；如需删除请再次操作');
      finish();
    };
    const judge = (detail: JobDetail | null) => {
      if (!owns(execution, jobId)) { finish(); return; }
      if (detail?.status === 'succeeded') { stopWithCompleted(detail); return; }
      if (detail?.status === 'cancelled' || detail?.status === 'failed') {
        host.markLocallyRemoved(nodeId);
        host.removeMediaNode(nodeId);
        finish();
        return; // 移除经 800ms 防抖保存携带 remove($target) 显式确认
      }
      host.registerPendingDelete(nodeId); // 仍 processing：登记意图，轮询终态驱动移除/挂载
      finish();
    };
    claimed.def.cancel(projectId, jobId)
      .then(() => doFetchJobStatus(jobId).catch(() => null))
      .then(judge)
      .catch(async (e: unknown) => {
        // 取消失败（多为任务已终态 100301）：核对权威状态，succeeded 视为抢先成功
        const detail = await doFetchJobStatus(jobId).catch(() => null);
        if (detail?.status === 'succeeded' && owns(execution, jobId)) {
          stopWithCompleted(detail);
          return;
        }
        host.toast('error', isApiError(e) ? `取消失败，卡片已保留：${e.message}` : '取消失败，卡片已保留，请稍后重试');
        finish();
      });
    return true;
  };

  /** 取消/删除时复用在途登记；无在途（水合竞态）则即时登记。 */
  const ensureExecution = (nodeId: string, def: GenerationTaskDefinition, jobId: string): ActiveExecution => {
    const existing = active.get(nodeId);
    if (existing) {
      // 缺 def 的在途登记（历史重试路径创建）：复用时回填，终态分发不退化为输出数量判断
      if (existing.def == null) existing.def = def;
      return existing;
    }
    const execution: ActiveExecution = {
      round: nextRound(),
      projectId: host.getProjectId()!,
      loadEpoch: host.getLoadEpoch(),
      nodeId, def, phase: 'generating', jobId,
      submissionId: readMarker(host.findNode(nodeId)?.data)?.submissionId,
    };
    host.setActiveJob(nodeId, execution.round);
    active.set(nodeId, execution);
    return execution;
  };

  // ── 恢复扫描 ──
  /** 扫描互斥按加载身份隔离（IKJKU7）：持有者为在扫的 loadEpoch。运行时实例跨项目
   *  切换存活——新加载（epoch 推进）不继承旧加载的互斥状态，可立即发起自己的扫描；
   *  旧扫描晚到的收尾只在仍持有锁时释放，不清新扫描的锁（无双扫描写入/无锁卡死）。
   *  IKJKU9：扫描数据源 Query 化——取页经宿主接缝（QueryClient.fetchQuery +
   *  generationRecoveryPageOptions，按项目+游标 key 隔离），运行时只保留游标推进
   *  与对账编排；扇出投影等定向读取不经宿主，保持注入 Promise（deps）。 */
  let scanningEpoch: object | null = null;
  const recover = async (projectId: string): Promise<void> => {
    const loadEpoch = host.getLoadEpoch();
    if (scanningEpoch === loadEpoch) return; // 同一加载内重复扫描不重入（无双轮询/重复卡）
    scanningEpoch = loadEpoch; // 新加载立即接管：旧加载在途扫描不再持有互斥资格
    try {
      let cursor: string | null = null;
      do {
        const page = await host.fetchRecoveryPage(projectId, { cursor });
        if (host.getProjectId() !== projectId || host.getLoadEpoch() !== loadEpoch) return; // A→B→A
        for (const record of page.records) reconcileRecord(record);
        cursor = page.next_cursor;
      } while (cursor != null);
    } catch (e) {
      console.warn('[generation-runtime] 恢复扫描失败（下轮水合重试）:', e);
    } finally {
      if (scanningEpoch === loadEpoch) scanningEpoch = null; // 仍持有才释放（晚到旧收尾不清新扫描的锁）
    }
  };

  /** 旧对账仍更新自身台账；目标已删除、被新意图接管或版本落后时，不动当前承接与画布。 */
  const reconcileRecord = (record: GenerationRecoveryRecord) => {
    const claiming = active.get(record.target_node_id);
    const targetItem = record.items.find((item) => item.output_key === TARGET_OUTPUT_KEY);
    const ledgerOnly = host.isLocallyRemoved(record.target_node_id)
      || (claiming != null && (claiming.jobId !== record.job_id
        || (claiming.submissionId != null && claiming.submissionId !== record.submission_id)))
      || (nodeBindings.get(record.target_node_id) ?? 0)
        > (targetItem?.node_binding_revision ?? record.binding_revision);
    // 台账对账（含 !is_current：旧输出节点独立可编辑，版本进台账供差分/撤销）
    for (const item of record.items) {
      setLedger({
        recoveryItemId: item.recovery_item_id,
        submissionId: record.submission_id,
        outputKey: item.output_key,
        nodeId: item.node_id,
        state: item.state,
        revision: item.revision,
        nodeBindingRevision: item.node_binding_revision,
      });
    }
    boundJobIds.add(record.job_id);
    reconciledSubmissions.add(record.submission_id);
    if (targetItem && !ledgerOnly) nodeBindings.set(targetItem.node_id, targetItem.node_binding_revision);
    if (!record.is_current || ledgerOnly) return; // 历史仅按可靠关联恢复：不猜卡、无画布动作
    const def = defForRecord(record);
    const plan = def?.planRecovery?.(record, host) ?? { kind: 'none' as const };
    switch (plan.kind) {
      case 'restore-target': {
        if (host.findNode(record.target_node_id) != null) break; // 判重：重复扫描不重复建卡
        host.insertMediaNode(plan.node);
        for (const edge of plan.edges ?? []) host.addEdge(edge.source, edge.target);
        const restoreProject = host.getProjectId();
        if (restoreProject) void host.saveCanvas(restoreProject).catch(() => {}); // 补卡落盘：恢复场景本因卡不在服务端
        break;
      }
      case 'apply-outputs': {
        const entry = active.get(record.target_node_id);
        if (entry && entry.jobId === record.job_id) break; // 已在途：不双链
        void applyRecoveredOutputs(record);
        break;
      }
      case 'resume-polling': {
        resumeFromHydration(record.target_node_id, record.job_id);
        break;
      }
      case 'none':
      default:
        break;
    }
  };

  /** 恢复页已判 succeeded 且有未应用输出：拉任务详情取产物 URL，走多结果扇出。 */
  const applyRecoveredOutputs = async (record: GenerationRecoveryRecord) => {
    const projectId = host.getProjectId();
    if (!projectId) return;
    try {
      const execution: ActiveExecution = {
        round: nextRound(), projectId, loadEpoch: host.getLoadEpoch(),
        nodeId: record.target_node_id, def: defForRecord(record)!, phase: 'generating',
        jobId: record.job_id, submissionId: record.submission_id,
      };
      host.setActiveJob(record.target_node_id, execution.round);
      active.set(record.target_node_id, execution);
      if (host.findNode(record.target_node_id) == null) {
        // 占位卡未落盘（受理回执丢失）：先按种子补占位，再扇出移除
        const def = defForRecord(record);
        const plan = def?.planRecovery?.(record, host);
        if (plan?.kind === 'restore-target') host.insertMediaNode(plan.node);
      }
      // IKJKU4（F5）：直供扫描已核验记录——目标提交在任一页（含被挤出首屏）都正常落卡
      await fanOutOutputs(execution, record.submission_id, record.job_id, undefined, record);
    } catch (e) {
      console.warn('[generation-runtime] 恢复输出应用失败:', e);
    }
  };

  /** 水合即时续轮询（扫描前乐观恢复；恢复扫描按 active 判重不双链）。
   *  nodeData 由水合调用方直供——水合 effect 执行期 mediaNodesRef 尚未与 setState 同步，
   *  不能在此刻经宿主反查节点。 */
  const resumeFromHydration = (nodeId: string, jobId: string, nodeData?: Record<string, unknown>) => {
    const def = nodeData
      ? defs.find((candidate) => candidate.identify(nodeId, nodeData))
      : defForNode(nodeId)?.def;
    if (!def) return;
    const entry = active.get(nodeId);
    if (entry && entry.jobId === jobId) return;
    // projectId 空串 = 只以加载身份守卫（水合 effect 期路由参数可能尚未解析，doc 本身已锚定项目）
    const execution: ActiveExecution = {
      round: nextRound(), projectId: host.getProjectId() ?? '', loadEpoch: host.getLoadEpoch(), nodeId,
      def, phase: 'generating', jobId,
      submissionId: readMarker(nodeData)?.submissionId ?? readMarker(host.findNode(nodeId)?.data)?.submissionId,
    };
    host.setActiveJob(nodeId, execution.round);
    active.set(nodeId, execution);
    poll(execution, jobId);
  };

  // ── 保存接缝 ──
  /** 差分推导本笔保存的显式恢复字段（在场/缺席 × 台账确认态 × 显式意图）。 */
  const composeSaveFields = (): { commandId: string; recoveryChanges: RecoveryChange[] } | null => {
    const changes: RecoveryChange[] = [];
    const nodes = host.getMediaNodes();
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    for (const entry of ledger.values()) {
      if (!reconciledSubmissions.has(entry.submissionId)) continue; // 未对账：不差分（防扫描窗口误删补卡）
      if (entry.state === 'replaced' || entry.state === 'transferred') continue; // 终置态不可再动作
      const node = nodeById.get(entry.nodeId);
      const marker = readMarker(node?.data);
      const matches = node != null && marker != null
        && marker.submissionId === entry.submissionId && marker.outputKey === entry.outputKey;
      const intent = intents.get(entry.submissionId);
      if (entry.outputKey === TARGET_OUTPUT_KEY && intent?.kind === 'settle' && node != null) {
        if (entry.state === 'pending' || entry.state === 'present') {
          changes.push({ recoveryItemId: entry.recoveryItemId, expectedRevision: entry.revision, action: 'settleTarget' });
        }
        continue;
      }
      if (matches) {
        if (entry.state === 'pending') {
          if (unavailableOutputItems.has(entry.recoveryItemId)) continue;
          changes.push({ recoveryItemId: entry.recoveryItemId, expectedRevision: entry.revision, action: 'apply' });
        } else if (entry.state === 'removed') {
          changes.push({ recoveryItemId: entry.recoveryItemId, expectedRevision: entry.revision, action: 'restore' }); // 显式撤销恢复同一结果
        }
        // present：已确认在场，无动作
      } else if (entry.state === 'pending' || entry.state === 'present') {
        if (entry.outputKey === TARGET_OUTPUT_KEY && intent?.kind === 'convert') {
          changes.push({ recoveryItemId: entry.recoveryItemId, expectedRevision: entry.revision, action: 'replaceTarget' });
          // 配套 apply(primary/逐输出) 由各自 marker 在场差分同笔补齐（原子保存）
        } else if (node == null) {
          if (unavailableOutputItems.has(entry.recoveryItemId) && !host.isLocallyRemoved(entry.nodeId)) continue;
          // 仅节点缺席（用户删除/扇出移除）才显式 remove；节点在场而无 marker（生成中占位卡
          // 本不带标记，B.3「受理前不伪造恢复项标记」）不算删除，保持 pending 等终态收敛。
          changes.push({ recoveryItemId: entry.recoveryItemId, expectedRevision: entry.revision, action: 'remove' });
        }
      }
    }
    if (changes.length === 0) return null;
    return { commandId: newId(), recoveryChanges: changes };
  };

  const onSaveReceipt = (receipt: { commandId: string; replayed: boolean; changes: Array<{ recoveryItemId: string; revision: number; nodeBindingRevision: number; state: string }> }) => {
    // 回执重放仅确认结果，不覆盖新编辑：只进台账
    for (const change of receipt.changes) {
      const entry = ledger.get(change.recoveryItemId);
      if (!entry) continue;
      setLedger({
        ...entry,
        state: change.state as LedgerEntry['state'],
        revision: change.revision,
        ...(change.nodeBindingRevision > 0 ? { nodeBindingRevision: change.nodeBindingRevision } : {}),
      });
      if (entry.outputKey === TARGET_OUTPUT_KEY && (change.state === 'present' || change.state === 'replaced')) {
        intents.delete(entry.submissionId); // settle/转换完成
      }
      if (change.state === 'removed') intents.delete(entry.submissionId);
    }
  };

  /** 保存撞 409 项冲突后的对账（B.5 resolve：只读、可重复）：按当前台账项定向读回
   *  服务端可见状态进台账；本地内容保留，由用户决定后续（不自动重发）。
   *  IKJLTU（A.8）：发起时固定项目与加载身份，响应返回时已失效（切项目/重载——页面
   *  reset 序列必伴随加载身份推进）整体丢弃，不改新加载的卡片/台账/归属登记/保存状态。 */
  const reconcileConflictItems = async (projectId: string): Promise<void> => {
    const loadEpoch = host.getLoadEpoch();
    const ids = [...ledger.keys()].filter((recoveryItemId) => {
      const entry = ledger.get(recoveryItemId);
      return entry && reconciledSubmissions.has(entry.submissionId)
        && entry.state !== 'replaced' && entry.state !== 'transferred';
    }).slice(0, 100);
    if (ids.length === 0) return;
    try {
      const resolved = await doResolveItems(projectId, ids);
      if (host.getProjectId() !== projectId || host.getLoadEpoch() !== loadEpoch) return; // 迟到响应：旧对账失效
      for (const record of resolved.records) reconcileRecord(record);
    } catch {
      // 对账失败保持现状（本地内容不受影响）
    }
  };

  const reset = () => {
    for (const timer of timers.values()) unschedule(timer);
    timers.clear();
    active.clear();
    ledger.clear();
    intents.clear();
    nodeBindings.clear();
    boundJobIds.clear();
    reconciledSubmissions.clear();
    unavailableOutputItems.clear();
    deleting.clear();
    retryAttempts.clear();
    retryInFlight.clear();
    submitAttempts.clear();
  };

  const runtime: GenerationRuntime = {
    register: (def) => { defs.push(def); },
    claims: (nodeId, nodeData) => defs.some((def) => def.identify(nodeId, nodeData)),
    submit: submit as GenerationRuntime['submit'],
    retry,
    cancel,
    remove,
    recover,
    resumeFromHydration,
    statusOf: (nodeId: string): InFlightTaskState | null => {
      const entry = active.get(nodeId);
      if (!entry) return null;
      return { phase: entry.phase, jobId: entry.jobId, submissionId: entry.submissionId };
    },
    bindingRevisionOf: (nodeId: string): number => nodeBindings.get(nodeId) ?? 0,
    composeSaveFields,
    onSaveReceipt,
    reconcileConflictItems,
    reset,
  };
  return runtime;
}
