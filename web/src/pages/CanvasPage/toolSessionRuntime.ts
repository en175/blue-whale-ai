import {
  createToolSessionEpoch,
  enterToolSession,
  escDefersToToolSessionHandler,
  exitAllToolSessions,
  exitToolSessionOnEsc,
  handleToolSessionNodeClick,
  handleToolSessionPaneClick,
  handleToolSessionSelectionChange,
  type ToolSessionDeps,
  hasEscExitSession,
  type CoordinatedTool,
} from './toolSessionCoordinator';

export interface ToolSubmissionContext {
  isCurrent(): boolean;
  close(): void;
  /** 发送即退出：保留本次失败反馈身份，后来会话或项目切换使其失效。 */
  exitForSubmission(): void;
}

export interface ToolSessionDefinition<State, Entry, Input, Request = void> {
  kind: string;
  nodeClick?: 'consume';
  escape?: 'dedicated';
  /** 高清/HD 可见同卡重入保留内容；插帧每次重算 seed 与按卡在途状态。 */
  panel?: 'preserve' | 'reinitialize';
  initialize(entry: Entry, previous?: State): State | null;
  /** 门槛通过并完成互斥后，执行工具专属的进入动作。 */
  opened?(state: State): State;
  target(state: State): string | null;
  capture(state: State, request?: Request): Input | null;
  submit(input: Input, context: ToolSubmissionContext): Promise<void>;
  onError(error: unknown, input: Input): void;
  cleanup?(state: State): void;
  /** 源卡旁路变更后校准专属编辑状态；无变化时返回原对象。 */
  reconcile?(state: State): State | null;
  /** 提交锁的宿主在途判定。提供后：选中隐藏后再返回（选回通知或真实点卡恢复会话）时以其
   *  重算上锁（防在途重发），旁路 reconcile 时以其解锁（在途落地后恢复可编辑）；显式关闭
   *  重开即新会话，不受影响。 */
  inFlight?(state: State): boolean;
}

export interface ToolSessionSnapshot<State> {
  state: State | null;
  submitting: boolean;
  /** 仅面板工具持有可见性与显式关闭后的选中豁免。 */
  visible?: boolean;
  hidden?: boolean;
}

export interface ToolSessionHandle<State, Entry, Request = void> {
  getSnapshot(): ToolSessionSnapshot<State>;
  open(entry: Entry, deps: ToolSessionDeps): boolean;
  edit(update: (state: State) => State): void;
  close(): void;
  send(request?: Request): boolean;
}

/** 注册工具的编辑状态与纪元由此持有；节点、连线和任务处理仍由宿主提供。 */
export function createToolSessionRuntime() {
  const epoch = createToolSessionEpoch();
  const tools = new Map<string, CoordinatedTool & { reset(): void; reconcile(): void; select(selection: { soloId: string | null; multiSelect: boolean }): void; lockForInFlight(targetId: string): void; captureOwnership(): (() => boolean) }>();
  const listeners = new Set<() => void>();
  let version = 0;
  let projectId: string | null | undefined;
  function changed(notify = true) {
    version += 1;
    if (notify) listeners.forEach((listener) => listener());
  }
  function closePanels() {
    for (const tool of tools.values()) if (tool.panel) tool.close();
  }
  return {
    closePanels,
    hasEditSession: () => [...tools.values()].some((tool) => !tool.panel && tool.target() !== null),
    hasEscExitSession: () => hasEscExitSession(tools.values()),
    escDefersToToolSessionHandler: () => escDefersToToolSessionHandler(tools.values()),
    onPaneClick() { return handleToolSessionPaneClick(tools.values()); },
    onNodeClick: (nodeId: string, deps: ToolSessionDeps) => handleToolSessionNodeClick(nodeId, tools.values(), deps),
    onSelectionChange(selection: { soloId: string | null; multiSelect: boolean }) {
      const freeze = handleToolSessionSelectionChange(selection, tools.values());
      if (!freeze) for (const tool of tools.values()) if (tool.panel) tool.select(selection);
      return freeze;
    },
    onEscape() {
      if (escDefersToToolSessionHandler(tools.values())) return false;
      return exitToolSessionOnEsc(tools.values());
    },
    beforeGenPanel() { exitAllToolSessions(tools.values()); },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getVersion: () => version,
    setProject(nextProjectId: string | null) {
      if (projectId === nextProjectId) return;
      projectId = nextProjectId;
      epoch.advanceAll();
      for (const tool of tools.values()) tool.reset();
    },
    reconcileSources(nodeIds: ReadonlySet<string>) {
      for (const tool of tools.values()) {
        const target = tool.target();
        if (target !== null && !nodeIds.has(target)) tool.close();
        else tool.reconcile();
      }
    },
    /** 旁路受理登记（如失败卡重试）：给当前打开且目标同卡的会话上提交锁，面板立即
     *  提交中只读。从未打开或已显式关闭的面板无会话状态，不受影响——显式关闭重开的
     *  新会话保留重发例外；面板自身发送已持锁，重复登记幂等。 */
    notifyInFlight(kind: string, targetId: string) {
      tools.get(kind)?.lockForInFlight(targetId);
    },
    /** IKJPM7 旁路受理（失败卡重试）的会话归属捕获：返回探针，受理时的会话身份此后
     *  被同 kind 后来新会话取代（显式关闭/排他退出后重开，无论新会话是否发送）或项目
     *  切换即失效——旧响应据此不向后来会话提示；恢复原会话（选择隐藏后返回）、他工具
     *  会话开关与纯关闭未重开均保持有效（当前有效请求的失败提示保留，US18/US19）。 */
    captureSessionOwnership(kind: string): () => boolean {
      const tool = tools.get(kind);
      return tool ? tool.captureOwnership() : () => true;
    },
    register<State, Entry, Input, Request = void>(definition: ToolSessionDefinition<State, Entry, Input, Request>): ToolSessionHandle<State, Entry, Request> {
      let snapshot: ToolSessionSnapshot<State> = { state: null, submitting: false, ...(definition.panel ? { visible: false, hidden: false } : {}) };
      /* 会话代数（IKJPM7 探针支撑）：只在非恢复路径的新会话建立与项目 reset 时推进——
         选择隐藏的 exit、他工具 open 的 advanceAll 都不再吞掉受理时的归属 */
      let ownershipGeneration = 0;
      const close = (notify = true) => {
        epoch.exit(definition.kind);
        if (snapshot.state !== null) definition.cleanup?.(snapshot.state);
        snapshot = { state: null, submitting: false, ...(definition.panel ? { visible: false, hidden: true } : {}) };
        changed(notify);
      };
      const tool = {
        getSnapshot: () => snapshot,
        open(entry: Entry, deps: ToolSessionDeps) {
          const previous = snapshot.state ?? undefined;
          const state = definition.initialize(entry, previous);
          if (state === null) return false;
          if (definition.panel === 'preserve' && snapshot.visible && state === snapshot.state) return true;
          // 同目标会话恢复：state 保留、非显式关闭（IKJPM5 hidden 区分）且新旧状态同目标
          //（IKJPXN 换目标即新会话，不能仅凭旧状态存在判为恢复原会话）。恢复路径提交锁按
          // 宿主在途重算上锁（同 select 选回规则）、受理归属探针保持；换目标与显式关闭重开
          // 都是新会话：探针推进失效、提交锁不按旧在途恢复（重发例外）
          const sameTarget = snapshot.state !== null && !snapshot.hidden
            && definition.target(snapshot.state) === definition.target(state);
          const initialize = () => {
            if (snapshot.state !== null) definition.cleanup?.(snapshot.state);
            const resume = sameTarget;
            if (!resume) ownershipGeneration += 1;
            const submitting = resume && definition.inFlight ? definition.inFlight(state) : false;
            snapshot = { state: definition.opened?.(state) ?? state, submitting, ...(definition.panel ? { visible: true, hidden: false } : {}) };
            changed();
          };
          // IKJPXM 同目标会话恢复（preserve 面板）不推进本 kind 纪元：在途请求的 isCurrent
          // 身份保留，有效失败反馈不被重入吞掉；参数刷新与在途只读重算照旧由 initialize
          // 闭包完成。换目标、显式关闭重开、reinitialize 面板与非面板编辑会话的重入仍按
          // 新会话推进纪元。
          const sameTargetResume = definition.panel === 'preserve' && sameTarget;
          if (!sameTargetResume) {
            epoch.advanceAll();
            epoch.enter(definition.kind);
          }
          enterToolSession(definition.kind, tools.values(), deps, initialize);
          return true;
        },
        edit(update: (state: State) => State) {
          if (snapshot.state === null) return;
          snapshot = { ...snapshot, state: update(snapshot.state) };
          changed();
        },
        close: () => close(),
        send(request?: Request) {
          if (snapshot.state === null || snapshot.submitting || snapshot.visible === false) return false;
          const input = definition.capture(snapshot.state, request);
          if (input === null) return false;
          let captured = epoch.capture(definition.kind);
          const isCurrent = () => epoch.isCurrent(definition.kind, captured);
          snapshot = { ...snapshot, submitting: true };
          changed();
          void (async () => {
            try {
              await definition.submit(input, {
                isCurrent,
                close: () => { if (isCurrent()) close(); },
                exitForSubmission: () => {
                  if (!isCurrent()) return;
                  close();
                  captured = epoch.capture(definition.kind);
                },
              });
            } catch (error: unknown) {
              if (isCurrent()) definition.onError(error, input);
            } finally {
              if (isCurrent() && snapshot.state !== null) {
                // 各请求独立收尾（IKJPM3）：有宿主在途判定时随其校准——自己已结束但
                // 同卡其他创建请求仍在途时保持只读；无判定工具保持原语义（无条件复位）
                const submitting = definition.inFlight ? definition.inFlight(snapshot.state) : false;
                if (submitting !== snapshot.submitting) {
                  snapshot = { ...snapshot, submitting };
                  changed();
                }
              }
            }
          })();
          return true;
        },
      };
      epoch.capture(definition.kind);
      tools.set(definition.kind, {
        kind: definition.kind, nodeClick: definition.nodeClick, escape: definition.escape,
        panel: Boolean(definition.panel),
        target: () => snapshot.state === null ? null : definition.target(snapshot.state),
        close: () => close(),
        lockForInFlight(targetId: string) {
          if (snapshot.state === null || snapshot.submitting || snapshot.visible === false) return;
          if (definition.target(snapshot.state) !== targetId) return;
          snapshot = { ...snapshot, submitting: true };
          changed();
        },
        reset() {
          ownershipGeneration += 1;
          close(false);
          if (definition.panel) snapshot = { ...snapshot, hidden: false };
        },
        captureOwnership(): (() => boolean) {
          const captured = ownershipGeneration;
          return () => ownershipGeneration === captured;
        },
        select({ soloId, multiSelect }) {
          if (snapshot.state === null || snapshot.hidden || (!soloId && !multiSelect)) return;
          const visible = soloId === definition.target(snapshot.state) && !multiSelect;
          if (snapshot.visible === visible) return;
          epoch.exit(definition.kind);
          // 选回时提交锁以宿主在途为准重算上锁（隐藏期间纪元已失效，旧 finally 不再复位）；
          // 隐藏时复位——无 inFlight 判定的工具保持原语义（一律复位）
          const submitting = visible && definition.inFlight?.(snapshot.state) === true;
          snapshot = { ...snapshot, visible, submitting };
          changed();
        },
        reconcile() {
          if (snapshot.state === null || !definition.reconcile) return;
          const state = definition.reconcile(snapshot.state);
          if (state === null) { close(); return; }
          // 提交锁只随宿主在途落地解锁，不因旁路变更上锁——显式关闭重开的新会话允许重发
          const submitting = snapshot.submitting && definition.inFlight ? definition.inFlight(state) : snapshot.submitting;
          if (state === snapshot.state && submitting === snapshot.submitting) return;
          snapshot = { ...snapshot, state, submitting };
          changed();
        },
      });
      return tool;
    },
  };
}
