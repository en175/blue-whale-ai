/**
 * 鉴权相关纯类型（数据层，无 JSX / 无副作用）
 */

/** 已登录用户（mock：仅用户名 + 手机号） */
export type User = {
  username: string;
  phone: string;
};

/**
 * 被 gating 拦下的「待执行动作」数据描述。
 * 仅用于日志/调试/测试断言；真正的执行闭包在 AuthContext 的 executorRef 里，不进 state。
 */
export type PendingAction =
  | { kind: "home-generate"; prompt: string }
  | { kind: "template-select"; prompt: string }
  | { kind: "canvas-send"; text: string };
