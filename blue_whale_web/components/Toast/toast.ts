/**
 * Toast —— 模块级单例通知存储（订阅/推送模式）
 * 组件外也可调用 toast.error("...") / toast.success("...")
 * ToastProvider 订阅并渲染到 portal。
 */

export type ToastType = "error" | "success";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
  action?: ToastAction;
};

export type ToastListener = (items: readonly ToastItem[]) => void;

let items: ToastItem[] = [];
let listeners: ToastListener[] = [];

function notify() {
  const snapshot = Object.freeze([...items]);
  for (const l of listeners) l(snapshot);
}

let nextId = 0;
function uid(): string {
  nextId += 1;
  return `toast-${Date.now()}-${nextId}`;
}

function push(
  type: ToastType,
  message: string,
  durationMs = 4000,
  action?: ToastAction,
) {
  const id = uid();
  items = [...items, { id, type, message, action }];
  notify();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    notify();
  }, durationMs);
}

export const toast = {
  error(message: string) {
    push("error", message);
  },
  success(message: string) {
    push("success", message);
  },
  /** IK76K1：带 action 按钮的 info toast（节点删除撤销等场景）。 */
  info(message: string, action?: ToastAction, durationMs = 3000) {
    push("success", message, durationMs, action);
  },
  /** 手动消除一条 toast（提前关闭或 dismiss） */
  dismiss(id: string) {
    items = items.filter((t) => t.id !== id);
    notify();
  },
  subscribe(listener: ToastListener): () => void {
    listeners = [...listeners, listener];
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  },
  /**
   * 测试专用：重置内部状态（清空所有 toast 和订阅者）。
   * 生产代码不应调用此方法。
   */
  __reset() {
    items = [];
    listeners = [];
  },
};
