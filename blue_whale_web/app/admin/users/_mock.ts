import { writeAuditLog } from "../_lib/audit-log";

export type AdminUserInfo = {
  id: string;
  userId: number;
  nickname: string;
  phone: string;
  balance: number;
  totalRecharge: number;
  totalSpend: number;
  role: number;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

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

export type OperationLog = {
  id: string;
  userId: number;
  action: "freeze" | "unfreeze" | "adjust";
  detail: Record<string, unknown>;
  operatorName: string;
  createdAt: string;
};

let logSeed = 500;
function nextLogId(): string { return `log_${String(++logSeed)}`; }

export const MOCK_RECHARGE_RECORDS: RechargeRecord[] = [
  { id: "rc_1", tradeNo: "BW20260727001", userId: 1001, tierName: "6000 积分 / ¥60", amount: 60, points: 6300, paymentMethod: "wechat", status: "paid", createdAt: "2026-07-27T08:15:00Z", paidAt: "2026-07-27T08:15:12Z" },
  { id: "rc_2", tradeNo: "BW20260720001", userId: 1001, tierName: "30000 积分 / ¥300", amount: 300, points: 33000, paymentMethod: "alipay", status: "paid", createdAt: "2026-07-20T10:00:00Z", paidAt: "2026-07-20T10:00:08Z" },
  { id: "rc_3", tradeNo: "BW20260715001", userId: 1001, tierName: "1000 积分 / ¥10", amount: 10, points: 1000, paymentMethod: "wechat", status: "paid", createdAt: "2026-07-15T14:20:00Z", paidAt: "2026-07-15T14:20:11Z" },
  { id: "rc_4", tradeNo: "BW20260727002", userId: 1002, tierName: "3000 积分 / ¥30", amount: 30, points: 3100, paymentMethod: "alipay", status: "paid", createdAt: "2026-07-27T09:30:00Z", paidAt: "2026-07-27T09:30:22Z" },
  { id: "rc_5", tradeNo: "BW20260722001", userId: 1002, tierName: "6000 积分 / ¥60", amount: 60, points: 6300, paymentMethod: "wechat", status: "paid", createdAt: "2026-07-22T16:00:00Z", paidAt: "2026-07-22T16:00:19Z" },
  { id: "rc_6", tradeNo: "BW20260727004", userId: 1003, tierName: "30000 积分 / ¥300", amount: 300, points: 33000, paymentMethod: "wechat", status: "paid", createdAt: "2026-07-27T11:00:00Z", paidAt: "2026-07-27T11:00:08Z" },
  { id: "rc_7", tradeNo: "BW20260718001", userId: 1003, tierName: "12000 积分 / ¥120", amount: 120, points: 12800, paymentMethod: "alipay", status: "paid", createdAt: "2026-07-18T09:00:00Z", paidAt: "2026-07-18T09:00:15Z" },
  { id: "rc_8", tradeNo: "BW20260727003", userId: 1004, tierName: "1000 积分 / ¥10", amount: 10, points: 1000, paymentMethod: "wechat", status: "pending", createdAt: "2026-07-27T10:45:00Z", paidAt: null },
  { id: "rc_9", tradeNo: "BW20260710001", userId: 1004, tierName: "3000 积分 / ¥30", amount: 30, points: 3100, paymentMethod: "wechat", status: "paid", createdAt: "2026-07-10T12:00:00Z", paidAt: "2026-07-10T12:00:22Z" },
];

export const MOCK_CONSUME_RECORDS: ConsumeRecord[] = [
  { id: "cs_1", userId: 1001, generationType: "image", description: "AI 图片生成 — 4张 · 1920×1080", points: 40, paramsSnapshot: { count: 4, resolution: "1920×1080", model: "gpt-4o" }, createdAt: "2026-07-27T09:00:00Z" },
  { id: "cs_2", userId: 1001, generationType: "video", description: "AI 视频生成 — 10s · 1920×1080", points: 500, paramsSnapshot: { duration_seconds: 10, resolution: "1920×1080", model: "claude-sonnet-5" }, createdAt: "2026-07-26T15:00:00Z" },
  { id: "cs_3", userId: 1001, generationType: "image", description: "AI 图片生成 — 2张 · 4096×2160", points: 60, paramsSnapshot: { count: 2, resolution: "4096×2160", model: "claude-fable-5" }, createdAt: "2026-07-25T11:00:00Z" },
  { id: "cs_4", userId: 1002, generationType: "image", description: "AI 图片生成 — 1张 · 1920×1080", points: 10, paramsSnapshot: { count: 1, resolution: "1920×1080", model: "gpt-4o-mini" }, createdAt: "2026-07-27T10:30:00Z" },
  { id: "cs_5", userId: 1002, generationType: "image", description: "AI 图片生成 — 6张 · 1920×1080", points: 60, paramsSnapshot: { count: 6, resolution: "1920×1080", model: "gpt-4o" }, createdAt: "2026-07-25T14:00:00Z" },
  { id: "cs_6", userId: 1003, generationType: "video", description: "AI 视频生成 — 30s · 4096×2160", points: 3000, paramsSnapshot: { duration_seconds: 30, resolution: "4096×2160", model: "claude-opus-5" }, createdAt: "2026-07-27T08:00:00Z" },
  { id: "cs_7", userId: 1003, generationType: "image", description: "AI 图片生成 — 8张 · 1920×1080", points: 80, paramsSnapshot: { count: 8, resolution: "1920×1080", model: "gpt-4o" }, createdAt: "2026-07-26T20:00:00Z" },
  { id: "cs_8", userId: 1004, generationType: "image", description: "AI 图片生成 — 2张 · 1280×960", points: 5, paramsSnapshot: { count: 2, resolution: "1280×960", model: "gpt-4o-mini" }, createdAt: "2026-07-26T12:00:00Z" },
];

export const MOCK_USERS: AdminUserInfo[] = [
  { id: "user_1", userId: 1001, nickname: "测试用户A", phone: "138****0001", balance: 12500, totalRecharge: 50000, totalSpend: 37500, role: 0, status: "active", createdAt: "2026-06-01T08:00:00Z", updatedAt: "2026-07-27T10:00:00Z" },
  { id: "user_2", userId: 1002, nickname: "设计师小王", phone: "139****0002", balance: 8300, totalRecharge: 30000, totalSpend: 21700, role: 0, status: "active", createdAt: "2026-06-05T12:00:00Z", updatedAt: "2026-07-26T15:00:00Z" },
  { id: "user_3", userId: 1003, nickname: "开发者老李", phone: "137****0003", balance: 52000, totalRecharge: 120000, totalSpend: 68000, role: 100, status: "active", createdAt: "2026-05-20T09:00:00Z", updatedAt: "2026-07-27T08:00:00Z" },
  { id: "user_4", userId: 1004, nickname: "AI爱好者", phone: "136****0004", balance: 1200, totalRecharge: 6000, totalSpend: 4800, role: 0, status: "active", createdAt: "2026-06-10T16:00:00Z", updatedAt: "2026-07-25T20:00:00Z" },
  { id: "user_5", userId: 1005, nickname: "内容创作者", phone: "135****0005", balance: 0, totalRecharge: 10000, totalSpend: 10000, role: 0, status: "disabled", createdAt: "2026-06-15T11:00:00Z", updatedAt: "2026-07-20T18:00:00Z" },
  { id: "user_6", userId: 1006, nickname: "数据分析师", phone: "134****0006", balance: 45000, totalRecharge: 60000, totalSpend: 15000, role: 0, status: "active", createdAt: "2026-06-20T14:00:00Z", updatedAt: "2026-07-27T12:00:00Z" },
  { id: "user_7", userId: 1007, nickname: "产品经理", phone: "133****0007", balance: 2300, totalRecharge: 3000, totalSpend: 700, role: 0, status: "active", createdAt: "2026-07-01T10:00:00Z", updatedAt: "2026-07-26T09:00:00Z" },
  { id: "user_8", userId: 1008, nickname: "测试账号B", phone: "132****0008", balance: 0, totalRecharge: 0, totalSpend: 0, role: 0, status: "disabled", createdAt: "2026-07-10T08:00:00Z", updatedAt: "2026-07-10T08:00:00Z" },
];

export const MOCK_ADJUST_LOGS: AdjustLog[] = [
  { id: "adj_1", userId: 1001, nickname: "测试用户A", amount: 5000, reason: "活动赠送", operatorId: 1, operatorName: "admin", createdAt: "2026-07-25T10:00:00Z" },
  { id: "adj_2", userId: 1003, nickname: "开发者老李", amount: -2000, reason: "异常消费回退", operatorId: 1, operatorName: "admin", createdAt: "2026-07-24T14:00:00Z" },
  { id: "adj_3", userId: 1005, nickname: "内容创作者", amount: -500, reason: "违规扣减", operatorId: 1, operatorName: "admin", createdAt: "2026-07-23T09:00:00Z" },
  { id: "adj_4", userId: 1002, nickname: "设计师小王", amount: 3000, reason: "补偿赠送", operatorId: 1, operatorName: "admin", createdAt: "2026-07-22T16:00:00Z" },
  { id: "adj_5", userId: 1001, nickname: "测试用户A", amount: 1000, reason: "邀请奖励", operatorId: 1, operatorName: "admin", createdAt: "2026-07-20T11:00:00Z" },
];

let users = [...MOCK_USERS];
let adjustLogs = [...MOCK_ADJUST_LOGS];
let operationLogs: OperationLog[] = [];

export function getUsers(): AdminUserInfo[] { return [...users]; }

export function getRechargeRecords(userId: number): RechargeRecord[] {
  return MOCK_RECHARGE_RECORDS.filter((r) => r.userId === userId);
}

export function getConsumeRecords(userId: number): ConsumeRecord[] {
  return MOCK_CONSUME_RECORDS.filter((r) => r.userId === userId);
}

export function getAdjustLogs(userId?: number): AdjustLog[] {
  if (!userId) return [...adjustLogs];
  return adjustLogs.filter((l) => l.userId === userId);
}

export function getOperationLogs(userId?: number): OperationLog[] {
  if (!userId) return [...operationLogs];
  return operationLogs.filter((l) => l.userId === userId);
}

export function adjustBalance(userId: number, amount: number, reason: string, operatorId = 1, operatorName = "admin"): AdminUserInfo | null {
  const u = users.find((u) => u.userId === userId);
  if (!u) return null;
  u.balance += amount;
  u.updatedAt = new Date().toISOString();
  const log: AdjustLog = { id: nextLogId(), userId, nickname: u.nickname, amount, reason, operatorId, operatorName, createdAt: new Date().toISOString() };
  adjustLogs.unshift(log);
  operationLogs.unshift({ id: nextLogId(), userId, action: "adjust", detail: { amount, reason }, operatorName, createdAt: new Date().toISOString() });
  writeAuditLog({ category: "user", action: "调整积分", target: u.nickname, detail: `${amount > 0 ? "+" : ""}${amount} 积分 — ${reason}`, operator: operatorName });
  return u;
}

export function freezeUser(userId: number, reason: string, operatorName = "admin"): AdminUserInfo | null {
  const u = users.find((u) => u.userId === userId);
  if (!u || u.status !== "active") return null;
  const previous = u.status;
  u.status = "disabled";
  u.updatedAt = new Date().toISOString();
  operationLogs.unshift({ id: nextLogId(), userId, action: "freeze", detail: { reason, previous_status: previous, new_status: "disabled" }, operatorName, createdAt: new Date().toISOString() });
  writeAuditLog({ category: "user", action: "冻结", target: u.nickname, detail: reason, operator: operatorName });
  return u;
}

export function unfreezeUser(userId: number, reason: string, operatorName = "admin"): AdminUserInfo | null {
  const u = users.find((u) => u.userId === userId);
  if (!u || u.status !== "disabled") return null;
  const previous = u.status;
  u.status = "active";
  u.updatedAt = new Date().toISOString();
  operationLogs.unshift({ id: nextLogId(), userId, action: "unfreeze", detail: { reason, previous_status: previous, new_status: "active" }, operatorName, createdAt: new Date().toISOString() });
  writeAuditLog({ category: "user", action: "解冻", target: u.nickname, detail: reason, operator: operatorName });
  return u;
}
