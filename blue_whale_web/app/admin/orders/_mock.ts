import { writeAuditLog } from "../_lib/audit-log";

export type AdminOrder = {
  id: string;
  tradeNo: string;
  userId: number;
  nickname: string;
  phone: string;
  tierId: string;
  tierName: string;
  amount: number;
  price: number;
  points: number;
  bonus: number;
  status: OrderStatus;
  paymentMethod: string;
  platformRefNo: string | null;
  ip: string;
  createdAt: string;
  paidAt: string | null;
  arrivedAt: string | null;
};

export type OrderStatus =
  "pending" | "paid" | "expired" | "refunded" | "failed";

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "待支付",
  paid: "已支付",
  expired: "已过期",
  refunded: "已退款",
  failed: "支付失败",
};

export type OperationLog = {
  id: string;
  tradeNo: string;
  action: string;
  reason: string;
  operatorName: string;
  createdAt: string;
};

let opLogSeed = 700;
function nextOpLogId(): string {
  return `oplog_${String(++opLogSeed)}`;
}
let operationLogs: OperationLog[] = [];

export const MOCK_ORDERS: AdminOrder[] = [
  {
    id: "ord_1",
    tradeNo: "BW20260727001",
    userId: 1001,
    nickname: "测试用户A",
    phone: "138****0001",
    tierId: "tier_3",
    tierName: "6000 积分 / ¥60",
    amount: 6000,
    price: 60,
    points: 6000,
    bonus: 300,
    status: "paid",
    paymentMethod: "wechat",
    platformRefNo: "WX20260727001",
    ip: "115.204.12.34",
    createdAt: "2026-07-27T08:15:00Z",
    paidAt: "2026-07-27T08:15:12Z",
    arrivedAt: "2026-07-27T08:15:13Z",
  },
  {
    id: "ord_2",
    tradeNo: "BW20260727002",
    userId: 1002,
    nickname: "设计师小王",
    phone: "139****0002",
    tierId: "tier_2",
    tierName: "3000 积分 / ¥30",
    amount: 3000,
    price: 30,
    points: 3000,
    bonus: 100,
    status: "paid",
    paymentMethod: "alipay",
    platformRefNo: "ALI20260727002",
    ip: "122.96.45.67",
    createdAt: "2026-07-27T09:30:00Z",
    paidAt: "2026-07-27T09:30:22Z",
    arrivedAt: "2026-07-27T09:30:23Z",
  },
  {
    id: "ord_3",
    tradeNo: "BW20260727003",
    userId: 1004,
    nickname: "AI爱好者",
    phone: "136****0004",
    tierId: "tier_1",
    tierName: "1000 积分 / ¥10",
    amount: 1000,
    price: 10,
    points: 1000,
    bonus: 0,
    status: "pending",
    paymentMethod: "wechat",
    platformRefNo: null,
    ip: "58.101.23.89",
    createdAt: "2026-07-27T10:45:00Z",
    paidAt: null,
    arrivedAt: null,
  },
  {
    id: "ord_4",
    tradeNo: "BW20260727004",
    userId: 1003,
    nickname: "开发者老李",
    phone: "137****0003",
    tierId: "tier_5",
    tierName: "30000 积分 / ¥300",
    amount: 30000,
    price: 300,
    points: 30000,
    bonus: 3000,
    status: "paid",
    paymentMethod: "wechat",
    platformRefNo: "WX20260727004",
    ip: "223.104.5.78",
    createdAt: "2026-07-27T11:00:00Z",
    paidAt: "2026-07-27T11:00:08Z",
    arrivedAt: "2026-07-27T11:00:09Z",
  },
  {
    id: "ord_5",
    tradeNo: "BW20260726001",
    userId: 1006,
    nickname: "数据分析师",
    phone: "134****0006",
    tierId: "tier_4",
    tierName: "12000 积分 / ¥120",
    amount: 12000,
    price: 120,
    points: 12000,
    bonus: 800,
    status: "paid",
    paymentMethod: "alipay",
    platformRefNo: "ALI20260726001",
    ip: "180.169.34.56",
    createdAt: "2026-07-26T14:20:00Z",
    paidAt: "2026-07-26T14:20:15Z",
    arrivedAt: "2026-07-26T14:20:16Z",
  },
  {
    id: "ord_6",
    tradeNo: "BW20260726002",
    userId: 1005,
    nickname: "内容创作者",
    phone: "135****0005",
    tierId: "tier_2",
    tierName: "3000 积分 / ¥30",
    amount: 3000,
    price: 30,
    points: 3000,
    bonus: 100,
    status: "expired",
    paymentMethod: "wechat",
    platformRefNo: null,
    ip: "42.120.78.90",
    createdAt: "2026-07-26T16:00:00Z",
    paidAt: null,
    arrivedAt: null,
  },
  {
    id: "ord_7",
    tradeNo: "BW20260726003",
    userId: 1001,
    nickname: "测试用户A",
    phone: "138****0001",
    tierId: "tier_1",
    tierName: "1000 积分 / ¥10",
    amount: 1000,
    price: 10,
    points: 1000,
    bonus: 0,
    status: "refunded",
    paymentMethod: "alipay",
    platformRefNo: "ALI20260726003",
    ip: "115.204.12.34",
    createdAt: "2026-07-26T17:30:00Z",
    paidAt: "2026-07-26T17:30:45Z",
    arrivedAt: "2026-07-26T17:30:46Z",
  },
  {
    id: "ord_8",
    tradeNo: "BW20260725001",
    userId: 1007,
    nickname: "产品经理",
    phone: "133****0007",
    tierId: "tier_2",
    tierName: "3000 积分 / ¥30",
    amount: 3000,
    price: 30,
    points: 3000,
    bonus: 100,
    status: "failed",
    paymentMethod: "wechat",
    platformRefNo: null,
    ip: "101.88.56.12",
    createdAt: "2026-07-25T20:10:00Z",
    paidAt: null,
    arrivedAt: null,
  },
  {
    id: "ord_9",
    tradeNo: "BW20260727005",
    userId: 1006,
    nickname: "数据分析师",
    phone: "134****0006",
    tierId: "tier_2",
    tierName: "3000 积分 / ¥30",
    amount: 3000,
    price: 30,
    points: 3000,
    bonus: 100,
    status: "pending",
    paymentMethod: "alipay",
    platformRefNo: null,
    ip: "180.169.34.56",
    createdAt: "2026-07-27T14:00:00Z",
    paidAt: null,
    arrivedAt: null,
  },
  {
    id: "ord_10",
    tradeNo: "BW20260724001",
    userId: 1008,
    nickname: "测试账号B",
    phone: "132****0008",
    tierId: "tier_1",
    tierName: "1000 积分 / ¥10",
    amount: 1000,
    price: 10,
    points: 1000,
    bonus: 0,
    status: "pending",
    paymentMethod: "wechat",
    platformRefNo: null,
    ip: "36.23.45.67",
    createdAt: "2026-07-24T09:00:00Z",
    paidAt: null,
    arrivedAt: null,
  },
];

let orders = [...MOCK_ORDERS];

export function getOrders(): AdminOrder[] {
  return [...orders];
}

export function getOrderByTradeNo(tradeNo: string): AdminOrder | null {
  return orders.find((o) => o.tradeNo === tradeNo) || null;
}

export function confirmOrder(
  tradeNo: string,
  reason: string,
  operatorName = "admin",
): AdminOrder | null {
  const o = orders.find((o) => o.tradeNo === tradeNo);
  if (!o || o.status !== "pending") return null;
  o.status = "paid";
  o.paidAt = new Date().toISOString();
  o.arrivedAt = new Date().toISOString();
  o.platformRefNo = `MANUAL_${tradeNo}_${Date.now()}`;
  operationLogs.unshift({
    id: nextOpLogId(),
    tradeNo,
    action: "confirm",
    reason,
    operatorName,
    createdAt: new Date().toISOString(),
  });
  writeAuditLog({
    category: "order",
    action: "手动确认",
    target: tradeNo,
    detail: reason,
    operator: operatorName,
  });
  return o;
}

export function getOperationLogs(tradeNo?: string): OperationLog[] {
  if (!tradeNo) return [...operationLogs];
  return operationLogs.filter((l) => l.tradeNo === tradeNo);
}

function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateExportData(orders: AdminOrder[]): string {
  const header =
    "订单号,用户,手机号,金额(元),积分,支付方式,状态,创建时间,到账时间,支付流水号";
  const rows = orders.map((o) =>
    [
      o.tradeNo,
      o.nickname,
      o.phone,
      o.price,
      o.points + o.bonus,
      o.paymentMethod === "wechat" ? "微信" : "支付宝",
      STATUS_LABELS[o.status],
      o.createdAt,
      o.arrivedAt || "",
      o.platformRefNo || "",
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...rows].join("\n");
}
