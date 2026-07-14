/**
 * 鉴权相关纯类型（数据层，无 JSX / 无副作用）
 */

/** 已登录用户 */
export type User = {
  userId: number;   // 后端用户 ID
  uid: string;      // 前端生成的稳定显示 ID（U-xxxx），phone→uid 映射，同手机号复用
  username: string;
  phone: string;
  avatar?: string;  // 头像 URL；空/null/"0" 表示使用默认首字头像
};

/**
 * 被 gating 拦下的「待执行动作」数据描述。
 * 仅用于日志/调试/测试断言；真正的执行闭包在 AuthContext 的 executorRef 里，不进 state。
 *
 * ⚠️ stale-closure 警示：executorRef 回放的是登录前捕获的 run 闭包。当前 run 多捕获
 * 常量（如 card.title），无风险；若未来 run  closure 捕获易变 state（如 Composer 内
 * 的实时文本、Dock 参数），登录成功后回放可能读到过期值。需要时请在 run 内部通过
 * ref 或函数式更新拉取最新 state，而不是直接依赖闭包变量。
 */
export type PendingAction =
  | { kind: "home-generate"; prompt: string }
  | { kind: "template-select"; prompt: string }
  | { kind: "canvas-send"; text: string };
