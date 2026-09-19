/* IKH3ZH 工具会话协调 module（进入路径）：画布六种编辑会话（擦除/抠图/裁切/扩图/
   去字幕/音视频分离）的跨工具互斥规则集中于此——「进入任一会话须退出其余活跃会话并
   关闭生成面板」这条知识只活在 module，六入口不再各自手列其他五种工具的退出清单。
   约束：会话状态与完整退出动作的实现留在页面现有持有处（index.tsx），本 module 不持
   state、不建第二份「活动工具」事实源——活跃与否由调用方每次交互时从现有六会话
   target 装配快照传入；本切片只实装进入路径（退出路径与画布事件消费规则由后续切片
   在本 module 接入）。纯 in-process 依赖，无网络接口。 */

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
