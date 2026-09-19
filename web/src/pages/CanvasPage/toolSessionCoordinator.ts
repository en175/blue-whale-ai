/* IKH3ZH 工具会话协调 module（进入路径）：画布六种编辑会话（擦除/抠图/裁切/扩图/
   去字幕/音视频分离）的跨工具互斥规则集中于此——「进入任一会话须退出其余活跃会话并
   关闭生成面板」这条知识只活在 module，六入口不再各自手列其他五种工具的退出清单。
   IKH3ZI 退出路径与画布事件消费规则接入本 module：画布事件消费（点画布空白 / 点其他卡
   node-click 拦截 / 选中规范化退出）与 Esc 六工具退出/让位顺序同样只活在 module，
   页面接线点不再逐工具 if；工具关闭钮/框外暗区/专属 Esc 等定向入口直调页面各工具的
   完整退出函数（定向退出经 module 纯转发无知识集中收益，IKH3ZE 审查裁决删中转层）。
   IKH3ZJ 生成面板准入接入：打开生成面板前「退出全部
   活跃会话」的判断与执行同样收进 module，页面准入前置不再手列六个 exit。
   约束：会话状态与完整退出动作的实现留在页面现有持有处（index.tsx），本 module 不持
   state、不建第二份「活动工具」事实源——活跃与否由调用方每次交互时从现有六会话
   target 装配快照传入。纯 in-process 依赖，无网络接口。 */

/** 六种编辑会话身份 */
export type ToolSessionKind =
  | 'erase'
  | 'cutout'
  | 'crop'
  | 'outpaint'
  | 'subtitleErase'
  | 'audioVideoSplit';

/** 六会话统一遍历顺序（互斥退出的固定顺序）。各 exit 只清各自 state、相互独立，
 *  顺序不影响结果，固定只为确定性。 */
const TOOL_SESSION_KINDS: readonly ToolSessionKind[] = [
  'erase',
  'cutout',
  'crop',
  'outpaint',
  'subtitleErase',
  'audioVideoSplit',
];

/** 六会话活跃快照：各会话 target node id（null=未进入）。由页面每次交互时从现有
 *  六会话 state 装配最新值传入，module 不保存。 */
export type ToolSessionActivity = Record<ToolSessionKind, string | null>;

/** 六会话完整退出动作（页面现有持有处的原函数，module 只调度不实现） */
export type ToolSessionExits = Record<ToolSessionKind, () => void>;

/** 进入协调依赖 */
export interface EnterToolSessionDeps {
  /** 本次交互对应的最新六会话活跃快照 */
  activity: ToolSessionActivity;
  /** 六个完整退出动作 */
  exits: ToolSessionExits;
  /** 关闭全部生成面板（进入任一会话统一执行） */
  dismissGenPanels: () => void;
}

/** 进入工具会话（六入口共用的互斥规则）：按快照退出除目标外的全部活跃会话、关闭
 *  生成面板，然后执行目标会话自身的初始化回调。门槛校验、选取态清理与目标参数
 *  初始化均由调用方承担（init 在互斥退出与关面板之后执行）；目标工具自身的残留
 *  清理同样由 init 负责（进入即重置自身参数，与既有行为一致）。 */
export function enterToolSession(
  kind: ToolSessionKind,
  deps: EnterToolSessionDeps,
  init: () => void,
): void {
  for (const other of TOOL_SESSION_KINDS) {
    if (other !== kind && deps.activity[other] != null) deps.exits[other]();
  }
  deps.dismissGenPanels();
  init();
}

/* ======================= IKH3ZI 退出路径与画布事件消费规则 ======================= */

/** 画布事件经会话协调处置后的消费结果：consumed=已有会话处置本次事件（调用方终止
 *  原流程，不再落入选取会话/选取模式/面板开关联动），pass=无相关会话（调用方继续
 *  既有原流程）。显式交还语义让接线点不再逐工具猜测后续走向。 */
export type ToolSessionEventDisposition = 'consumed' | 'pass';

/** 会话协调依赖（退出路径与画布事件消费共用；进入路径依赖的超集——enterToolSession
 *  按结构化类型同样可收）。仍由页面每次交互时装配当轮最新快照，module 不保存。 */
export interface ToolSessionDeps extends EnterToolSessionDeps {
  /** 程序化选中指定节点（node-click 拦截退出后选中新卡；页面 selectRequest 通道） */
  selectNode: (nodeId: string) => void;
}

/** 退出全部活跃会话（IKH3ZJ 生成面板准入的统一前置）：遍历六会话快照，活跃即执行
 *  其完整退出动作（未发送参数丢弃）；无活跃会话时空操作（幂等）。「哪些会话活跃、
 *  逐个怎么退」的判断只活在 module，页面打开面板前不再手列六个 exit 清单。
 *  六会话经 enterToolSession 互斥，同一快照至多一个活跃，遍历顺序不影响结果。 */
export function exitAllToolSessions(deps: ToolSessionDeps): void {
  for (const kind of TOOL_SESSION_KINDS) {
    if (deps.activity[kind] != null) deps.exits[kind]();
  }
}

/** 点画布空白（PaneClick）的会话处置：任一会话活跃即退出（退出即消费——本次点击
 *  不落入选取会话/选取模式/面板关闭链）；无会话交还调用方继续原流程。
 *  六会话经 enterToolSession 互斥，同一快照至多一个活跃，遍历顺序不影响结果
 *  （固定 TOOL_SESSION_KINDS 序只为确定性）。 */
export function handleToolSessionPaneClick(deps: ToolSessionDeps): ToolSessionEventDisposition {
  for (const kind of TOOL_SESSION_KINDS) {
    if (deps.activity[kind] != null) {
      deps.exits[kind]();
      return 'consumed';
    }
  }
  return 'pass';
}

/** node-click 走会话拦截的工具：仅抠图/扩图——两工具有源卡概念且点其他卡意味着
 *  切换目标（退出+选中新卡），其余四工具不拦截节点点击（点其他卡走选中规范化退出）。 */
const NODE_CLICK_INTERCEPT_KINDS: readonly ToolSessionKind[] = ['outpaint', 'cutout'];

/** 点画布节点（node-click）的会话拦截：抠图/扩图活跃时——点其他卡退出会话并程序化
 *  选中那张卡、点源卡本身保持会话，两种都消费本次点击（不落入普通选中/开面板分支，
 *  同次点击不开普通面板）；两会话皆不活跃或其余四工具交还调用方走原 node-click 流程。 */
export function handleToolSessionNodeClick(
  nodeId: string,
  deps: ToolSessionDeps,
): ToolSessionEventDisposition {
  for (const kind of NODE_CLICK_INTERCEPT_KINDS) {
    const target = deps.activity[kind];
    if (target == null) continue;
    if (nodeId !== target) {
      deps.exits[kind]();
      deps.selectNode(nodeId);
    }
    return 'consumed';
  }
  return 'pass';
}

/** 选中规范化退出的工具：擦除/裁切/去字幕/音视频分离（抠图/扩图的选中变化走冻结，
 *  其点其他卡退出已由 node-click 拦截承担）。 */
const SELECTION_EXIT_KINDS: readonly ToolSessionKind[] = ['erase', 'crop', 'subtitleErase', 'audioVideoSplit'];

/** 选中变化的会话处置：抠图/扩图活跃时冻结面板联动（返回 true，调用方应终止面板
 *  联动——会话内点其他卡的选中变化已由 node-click 拦截处置，程序化选中触发的变化
 *  不应误关其他状态）；其余四工具按调用方传入的规范化选中结果退出——单选其他卡
 *  或多选即退出该会话，退出后返回 false 交还调用方继续面板联动（同轮不开面板由
 *  调用方以本轮渲染的旧「会话活跃」门挡住，保持既有同一手势无重复副作用机制）。
 *  候选规范化（soloId/多选判定）由调用方计算后传入，module 不复算。 */
export function handleToolSessionSelectionChange(
  selection: { soloId: string | null; multiSelect: boolean },
  deps: ToolSessionDeps,
): boolean {
  if (deps.activity.cutout != null || deps.activity.outpaint != null) return true;
  for (const kind of SELECTION_EXIT_KINDS) {
    const target = deps.activity[kind];
    if (
      target != null &&
      ((selection.soloId != null && selection.soloId !== target) || selection.multiSelect)
    ) {
      deps.exits[kind]();
    }
  }
  return false;
}

/** Esc 公共链让位判断：抠图/扩图有各自的专属 Esc handler（含输入框豁免与
 *  preventDefault，先于公共链挂载处置），公共链遇此两会话直接让位不重复处置。 */
export function escDefersToToolSessionHandler(deps: ToolSessionDeps): boolean {
  return deps.activity.cutout != null || deps.activity.outpaint != null;
}

/** Esc 公共链退出的工具与顺序：擦除→去字幕→音视频分离→裁切（让位与退出顺序是
 *  module 持有的知识；抠图/扩图不在其列，由专属 handler 承担）。 */
const ESC_EXIT_KINDS: readonly ToolSessionKind[] = ['erase', 'subtitleErase', 'audioVideoSplit', 'crop'];

/** Esc 公共链后段的会话退出：按 ESC_EXIT_KINDS 顺序退出首个活跃会话并消费；无此
 *  四会话返回 false 交还调用方继续面板关闭链。 */
export function exitToolSessionOnEsc(deps: ToolSessionDeps): boolean {
  for (const kind of ESC_EXIT_KINDS) {
    if (deps.activity[kind] != null) {
      deps.exits[kind]();
      return true;
    }
  }
  return false;
}

/** 公共 Esc 链挂载条件中的会话判断：擦除/裁切/去字幕/分离任一活跃即需挂载公共链
 *  （抠图/扩图有专属 handler，不因它们挂载公共链——与页面原挂载条件口径一致）。 */
export function hasEscExitSession(deps: ToolSessionDeps): boolean {
  return ESC_EXIT_KINDS.some((kind) => deps.activity[kind] != null);
}
