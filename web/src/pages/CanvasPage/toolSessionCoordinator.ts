/* IKH3ZH 工具会话协调 module（进入路径）：画布十种编辑会话（擦除/抠图/裁切/扩图/
   去字幕/音视频分离/音频截取/场景切分/人声背景分离/智能抠像）的跨工具互斥规则集中于此——
   「进入任一会话须退出其余活跃会话并关闭生成面板」这条知识只活在 module，各入口不再
   各自手列其他工具的退出清单。
   （IKHB7A：音频截取、IKH8BR：场景切分、IKHA2W：人声背景分离、IKHK9N：智能抠像
   先后按既有口径接入，互斥/退出/面板准入/工具条隐藏同款——选中规范化退出 + Esc
   公共链，无 node-click 拦截。下文与各函数注释中的计数为各收口时点的历史叙述，
   会话清单以 ToolSessionKind / TOOL_SESSION_KINDS 为准。）
   IKH3ZI 退出路径与画布事件消费规则接入本 module：画布事件消费（点画布空白 / 点其他卡
   node-click 拦截 / 选中规范化退出）与 Esc 各工具退出/让位顺序同样只活在 module，
   页面接线点不再逐工具 if；工具关闭钮/框外暗区/专属 Esc 等定向入口直调页面各工具的
   完整退出函数（定向退出经 module 纯转发无知识集中收益，IKH3ZE 审查裁决删中转层）。
   IKH3ZJ 生成面板准入接入：打开生成面板前「退出全部
   活跃会话」的判断与执行同样收进 module，页面准入前置不再手列各 exit。
   IKHB7A 音频截取（audioTrim）按音视频分离同档接入——互斥、选中规范化退出、Esc
   公共链同为家族口径；node-click 拦截不挂（仅 outpaint/cutout 有源卡切换语义，
   截取与场景切分等工具一样走选中规范化退出）。
   IKHW5C 音频调速（audioSpeed，父单 IKHVYO，编辑态本体归 IKHW5S）按音频截取
   同档接入——互斥、选中规范化退出、Esc 公共链同家族口径；node-click 拦截不挂
   （无源卡切换语义，点其他卡走选中规范化退出）。
   IKI61O 会话纪元（session epoch）接入本 module：进/出会话与项目切换推进纪元、
   发送时捕获、迟到响应 settle 时比对——纪元不同即「当前会话已不是发起时的会话
   （或已关闭）」，只做任务收尾（建卡/连线/轮询等），不关闭用户当前会话、不复位其
   提交锁、不向它弹旧错误提示。机制单源在 createToolSessionEpoch，各家族不各自
   发明（IKI6EB 调速专属 ref 由本机制取代）。
   约束：会话状态与完整退出动作的实现留在页面现有持有处（index.tsx），本 module 不持
   state、不建第二份「活动工具」事实源——活跃与否由调用方每次交互时从现有会话
   target 装配快照传入；纪元实例同样由页面以 ref 持有（createToolSessionEpoch 工厂
   每次新建），module 只提供机制。纯 in-process 依赖，无网络接口。 */

/** 编辑会话身份 */
export type ToolSessionKind =
  | 'erase'
  | 'cutout'
  | 'crop'
  | 'outpaint'
  | 'subtitleErase'
  | 'audioVideoSplit'
  | 'audioTrim'
  | 'audioMix'
  | 'audioSpeed'
  | 'sceneSplit'
  | 'vocalSplit'
  | 'smartMatting';

/** 会话统一遍历顺序（互斥退出的固定顺序）。各 exit 只清各自 state、相互独立，
 *  顺序不影响结果，固定只为确定性。 */
const TOOL_SESSION_KINDS: readonly ToolSessionKind[] = [
  'erase',
  'cutout',
  'crop',
  'outpaint',
  'subtitleErase',
  'audioVideoSplit',
  'audioTrim',
  'audioMix',
  'audioSpeed',
  'sceneSplit',
  'vocalSplit',
  'smartMatting',
];

/** 全会话活跃快照（IKH3ZH 收口时为八会话，IKHW5C 增至十一）：各会话 target node id
 *  （null=未进入）。由页面每次交互时从现有会话 state 装配最新值传入，module 不保存。 */
export type ToolSessionActivity = Record<ToolSessionKind, string | null>;

/** 全会话完整退出动作（页面现有持有处的原函数，module 只调度不实现） */
export type ToolSessionExits = Record<ToolSessionKind, () => void>;

/** 进入协调依赖 */
export interface EnterToolSessionDeps {
  /** 本次交互对应的最新全会话活跃快照 */
  activity: ToolSessionActivity;
  /** 全部会话的完整退出动作 */
  exits: ToolSessionExits;
  /** 关闭全部生成面板（进入任一会话统一执行） */
  dismissGenPanels: () => void;
}

/** 进入工具会话（各入口共用的互斥规则）：按快照退出除目标外的全部活跃会话、关闭
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

/** 退出全部活跃会话（IKH3ZJ 生成面板准入的统一前置）：遍历八会话快照，活跃即执行
 *  其完整退出动作（未发送参数丢弃）；无活跃会话时空操作（幂等）。「哪些会话活跃、
 *  逐个怎么退」的判断只活在 module，页面打开面板前不再手列 exit 清单。
 *  各会话经 enterToolSession 互斥，同一快照至多一个活跃，遍历顺序不影响结果。 */
export function exitAllToolSessions(deps: ToolSessionDeps): void {
  for (const kind of TOOL_SESSION_KINDS) {
    if (deps.activity[kind] != null) deps.exits[kind]();
  }
}

/** 点画布空白（PaneClick）的会话处置：任一会话活跃即退出（退出即消费——本次点击
 *  不落入选取会话/选取模式/面板关闭链）；无会话交还调用方继续原流程。
 *  各会话经 enterToolSession 互斥，同一快照至多一个活跃，遍历顺序不影响结果
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
 *  切换目标（退出+选中新卡），其余五工具不拦截节点点击（点其他卡走选中规范化退出）。 */
const NODE_CLICK_INTERCEPT_KINDS: readonly ToolSessionKind[] = ['outpaint', 'cutout'];

/** 点画布节点（node-click）的会话拦截：抠图/扩图活跃时——点其他卡退出会话并程序化
 *  选中那张卡、点源卡本身保持会话，两种都消费本次点击（不落入普通选中/开面板分支，
 *  同次点击不开普通面板）；两会话皆不活跃或其余五工具交还调用方走原 node-click 流程。 */
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

/** 选中规范化退出的工具包含音频混合与调速；抠图/扩图的选中变化走冻结。 */
const SELECTION_EXIT_KINDS: readonly ToolSessionKind[] = ['erase', 'crop', 'subtitleErase', 'audioVideoSplit', 'audioTrim', 'audioMix', 'audioSpeed', 'sceneSplit', 'vocalSplit', 'smartMatting'];

/** 选中变化的会话处置：抠图/扩图活跃时冻结面板联动（返回 true，调用方应终止面板
 *  联动——会话内点其他卡的选中变化已由 node-click 拦截处置，程序化选中触发的变化
 *  不应误关其他状态）；其余七工具按调用方传入的规范化选中结果退出——单选其他卡
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

/** Esc 公共链按顺序退出首个活跃会话；抠图/扩图由专属 handler 处理。 */
const ESC_EXIT_KINDS: readonly ToolSessionKind[] = ['erase', 'subtitleErase', 'audioVideoSplit', 'audioTrim', 'audioMix', 'audioSpeed', 'sceneSplit', 'vocalSplit', 'smartMatting', 'crop'];

/** Esc 公共链后段的会话退出：按 ESC_EXIT_KINDS 顺序退出首个活跃会话并消费；无此
 *  六会话返回 false 交还调用方继续面板关闭链。 */
export function exitToolSessionOnEsc(deps: ToolSessionDeps): boolean {
  for (const kind of ESC_EXIT_KINDS) {
    if (deps.activity[kind] != null) {
      deps.exits[kind]();
      return true;
    }
  }
  return false;
}

/* ======================= IKI61O 会话纪元（session epoch） ======================= */

/** 会话纪元追踪器：按会话种类隔离的单调递增计数。推进时机（进/出会话、项目切换）
 *  与比对规则（捕获纪元仍是当前纪元才可触碰会话状态）的知识只活在本 module；
 *  实例由页面以 ref 持有一份，不经 React state（纪元读写都在事件/回调里，不驱动渲染）。
 *
 *  使用口径（全部异步发送型家族同规）：
 *  - 进入会话经 enter 推进——同工具换卡重进不触发出，靠本推进区分前后两次会话身份；
 *  - 退出会话（四路退出/互斥/绑定清理/发送成功 settle 共用的完整退出函数）经 exit 推进；
 *  - 项目切换经 advanceAll 推进——旧身份在新项目不再代表任何当前会话；
 *  - 发送时 capture 捕获当前纪元；settle 时 isCurrent 比对——false 即迟到响应，
 *    只做任务收尾（建卡/连线/轮询/落盘），不退当前会话、不复位其提交锁、不弹旧错误。 */
export interface ToolSessionEpoch {
  /** 进入会话：推进该会话纪元（新会话身份生效） */
  enter(kind: ToolSessionKind): void;
  /** 退出会话：推进该会话纪元（在途响应随之失效） */
  exit(kind: ToolSessionKind): void;
  /** 项目切换：推进全部会话纪元 */
  advanceAll(): void;
  /** 发送时捕获该会话当前纪元 */
  capture(kind: ToolSessionKind): number;
  /** settle 比对：捕获纪元仍代表当前会话（期间无退出/重进/切项目） */
  isCurrent(kind: ToolSessionKind, captured: number): boolean;
}

/** 创建会话纪元追踪器（每页面实例一份）。各会话种类独立计数、互不影响。 */
export function createToolSessionEpoch(): ToolSessionEpoch {
  const epochs = Object.fromEntries(
    TOOL_SESSION_KINDS.map((kind) => [kind, 0]),
  ) as Record<ToolSessionKind, number>;
  return {
    enter(kind) {
      epochs[kind] += 1;
    },
    exit(kind) {
      epochs[kind] += 1;
    },
    advanceAll() {
      for (const kind of TOOL_SESSION_KINDS) epochs[kind] += 1;
    },
    capture(kind) {
      return epochs[kind];
    },
    isCurrent(kind, captured) {
      return epochs[kind] === captured;
    },
  };
}

/** 公共 Esc 链挂载条件中的会话判断：擦除/裁切/去字幕/分离/截取/调速/场景切分/人声背景
 *  分离任一活跃即需挂载公共链（抠图/扩图有专属 handler，不因它们挂载公共链——与页面
 *  原挂载条件口径一致）。 */
export function hasEscExitSession(deps: ToolSessionDeps): boolean {
  return ESC_EXIT_KINDS.some((kind) => deps.activity[kind] != null);
}
