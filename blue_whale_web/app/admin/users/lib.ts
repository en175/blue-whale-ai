// IK74V6：admin 用户页的类型、纯函数与常量（从 page.tsx 下沉，职责解耦）。

// 明细 tab 记录类型（调整/操作日志来自 admin_operation_logs 映射；
// 充值/消费记录后端暂无按用户维度的查询接口，IK6JXJ 暂以空态呈现）。
export type AdjustLog = {
  id: string;
  userId: number;
  nickname: string;
  amount: number;
  reason: string;
  operatorId: number;
  operatorName: string;
  createdAt: string;
};

export type OperationLog = {
  id: string;
  userId: number;
  action: string;
  detail: Record<string, unknown>;
  operatorName: string;
  createdAt: string;
};

/** 充值/消费记录 tab 保留原结构（数据源暂无，恒为空数组）。 */
export type RechargeRecord = {
  id: string;
  tradeNo: string;
  userId: number;
  tierName: string;
  amount: number;
  points: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
};

export type ConsumeRecord = {
  id: string;
  userId: number;
  generationType: "image" | "video";
  description: string;
  points: number;
  paramsSnapshot: Record<string, unknown>;
  createdAt: string;
};

/** 从审计日志行映射调整记录（action=user.adjust_balance）。 */
export function toAdjustLog(
  row: { id: string; detail: string; operator: string; createdAt: string },
  userId: number,
): AdjustLog {
  let detail: { reason?: string; value?: number } = {};
  try {
    detail = JSON.parse(row.detail || "{}");
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    userId,
    nickname: "",
    amount: detail.value ?? 0,
    reason: detail.reason ?? row.detail,
    operatorId: 0,
    operatorName: row.operator,
    createdAt: row.createdAt,
  };
}

/** 从审计日志行映射操作日志（category=user）。 */
export function toOperationLog(
  row: {
    id: string;
    action: string;
    detail: string;
    operator: string;
    createdAt: string;
  },
  userId: number,
): OperationLog {
  let detail: Record<string, unknown> = {};
  try {
    detail = JSON.parse(row.detail || "{}");
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    userId,
    action: row.action,
    detail,
    operatorName: row.operator,
    createdAt: row.createdAt,
  };
}

export const ROLE_LABELS: Record<number, string> = {
  1: "普通用户",
  10: "管理员",
  100: "root",
};

export const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "正常" },
  { value: "disabled", label: "已冻结" },
];

export const BALANCE_STORAGE_KEY = "admin_balance_filter";

export type BalanceFilterState = { preset: string; min: string; max: string };

export function loadBalanceState(): BalanceFilterState {
  try {
    const raw = localStorage.getItem(BALANCE_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { preset: "all", min: "", max: "" };
}

export function saveBalanceState(state: BalanceFilterState) {
  try {
    localStorage.setItem(BALANCE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export const BALANCE_PRESETS = [
  { value: "all", label: "全部余额" },
  { value: "0-1000", label: "0 — 1,000" },
  { value: "1000-5000", label: "1,000 — 5,000" },
  { value: "5000-10000", label: "5,000 — 10,000" },
  { value: "10000-50000", label: "10,000 — 50,000" },
  { value: "50000+", label: "> 50,000" },
  { value: "custom", label: "自定义区间" },
];

export const RC_STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "paid", label: "已支付" },
  { value: "pending", label: "待支付" },
];

export const RC_PAYMENT_OPTIONS = [
  { value: "all", label: "全部方式" },
  { value: "wechat", label: "微信支付" },
  { value: "alipay", label: "支付宝" },
];

export const CS_TYPE_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
];

export const DETAIL_TABS = [
  { key: "info", label: "基本信息" },
  { key: "recharge", label: "充值记录" },
  { key: "consume", label: "消费记录" },
  { key: "adjust", label: "调整记录" },
  { key: "operations", label: "操作日志" },
];
