import ExcelJS from "exceljs";

export const EXPORT_SCOPES = ["orders", "gain", "consume"] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

export const MAX_EXPORT_ROWS = 10_000;

interface ExportColumn<T> {
  key: string;
  header: string;
  value: (row: T) => string | number;
  width: number;
}

interface ExportSpec<T> {
  sheetName: string;
  filePrefix: string;
  columns: ExportColumn<T>[];
}


export interface ExportOrderRow {
  trade_no: string;
  product_name: string;
  amount_fen: number;
  credits: number;
  bonus_credits: number;
  status: string;
  created_at: string;
  paid_at: string | null;
}

const ORDER_STATUS_TEXT: Record<string, string> = {
  pending: "待支付",
  paid_pending: "支付成功待到账",
  paid: "已到账",
  failed: "支付失败",
  expired: "已取消",
  grant_failed: "到账异常",
};

const ORDERS: ExportSpec<ExportOrderRow> = {
  sheetName: "订单记录",
  filePrefix: "订单记录",
  columns: [
    { key: "created_at", header: "下单时间", value: (r) => r.created_at, width: 22 },
    { key: "product_name", header: "商品名称", value: (r) => r.product_name, width: 28 },
    { key: "trade_no", header: "订单编号", value: (r) => r.trade_no, width: 26 },
    { key: "amount_yuan", header: "支付金额", value: (r) => r.amount_fen / 100, width: 14 },
    {
      key: "credits",
      header: "到账积分",
      value: (r) => (r.status === "paid" ? r.credits + r.bonus_credits : ""),
      width: 14,
    },
    {
      key: "status",
      header: "状态",
      value: (r) => ORDER_STATUS_TEXT[r.status] ?? r.status,
      width: 18,
    },
  ],
};


export interface ExportLotRow {
  lot_id: string;
  source: string;
  amount: number;
  remaining: number;
  created_at: string;
  expires_at: string;
  biz_type: string;
  biz_id: string;
}

const LOT_SOURCE_TEXT: Record<string, string> = {
  purchased: "充值到账",
  bonus: "充值赠送",
  gift: "赠送",
  compensation: "补偿",
  daily: "每日赠送",
  invite: "邀请奖励",
  register: "注册赠送",
  redeem: "兑换",
  subscription: "订阅",
};

const GAIN: ExportSpec<ExportLotRow> = {
  sheetName: "已获取",
  filePrefix: "积分明细-已获取",
  columns: [
    { key: "created_at", header: "获取时间", value: (r) => r.created_at, width: 22 },
    {
      key: "source",
      header: "获取来源",
      value: (r) => LOT_SOURCE_TEXT[r.source] ?? r.source,
      width: 14,
    },
    {
      key: "detail",
      header: "获取详情",
      value: (r) =>
        `自定义充值 ${r.amount} 积分` + (r.biz_id ? ` · 订单 ${r.biz_id}` : ""),
      width: 40,
    },
    {
      key: "expires_at",
      header: "积分到期时间",
      value: (r) => (r.expires_at === "" ? "永久有效" : r.expires_at),
      width: 22,
    },
    { key: "amount", header: "积分值", value: (r) => r.amount, width: 12 },
    { key: "remaining", header: "剩余", value: (r) => r.remaining, width: 12 },
  ],
};


export interface ExportConsumeRow {
  id: string;
  type: string;
  title: string;
  credits: number;
  job_id: string | null;
  task_type: string | null;
  model_label: string | null;
  prompt: string | null;
  created_at: string;
}

const CONSUME: ExportSpec<ExportConsumeRow> = {
  sheetName: "已消耗",
  filePrefix: "积分明细-已消耗",
  columns: [
    { key: "created_at", header: "消耗时间", value: (r) => r.created_at, width: 22 },
    {
      key: "task_type",
      header: "任务类型",
      value: (r) => (r.type === "expire" ? "过期核销" : (r.task_type ?? "")),
      width: 16,
    },
    { key: "model_label", header: "模型", value: (r) => r.model_label ?? "", width: 20 },
    {
      key: "detail",
      header: "任务详情",
      value: (r) => r.prompt ?? r.title,
      width: 48,
    },
    { key: "job_id", header: "任务 ID", value: (r) => r.job_id ?? "", width: 14 },
    { key: "credits", header: "消耗积分", value: (r) => r.credits, width: 12 },
  ],
};

const SPECS = { orders: ORDERS, gain: GAIN, consume: CONSUME } as const;

export function exportFieldKeys(scope: ExportScope): string[] {
  return SPECS[scope].columns.map((column) => column.key);
}

export type ExportRows =
  | { scope: "orders"; rows: ExportOrderRow[]; total: number }
  | { scope: "gain"; rows: ExportLotRow[]; total: number }
  | { scope: "consume"; rows: ExportConsumeRow[]; total: number };

export async function buildExportWorkbook(input: ExportRows, fields: string[]): Promise<Buffer> {
  switch (input.scope) {
    case "orders":
      return render(ORDERS, input.rows, fields, input.total);
    case "gain":
      return render(GAIN, input.rows, fields, input.total);
    case "consume":
      return render(CONSUME, input.rows, fields, input.total);
  }
}

async function render<T>(
  spec: ExportSpec<T>,
  rows: T[],
  fields: string[],
  total: number,
): Promise<Buffer> {
  const picked =
    fields.length === 0
      ? spec.columns
      : spec.columns.filter((column) => fields.includes(column.key));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(spec.sheetName);

  sheet.columns = picked.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));

  for (const row of rows) {
    sheet.addRow(Object.fromEntries(picked.map((c) => [c.key, c.value(row)])));
  }

  if (total > rows.length) {
    const note = sheet.addRow({});
    note.getCell(1).value = `⚠️ 仅导出前 ${rows.length} 条，共 ${total} 条`;
  }

  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function exportFileName(scope: ExportScope, stamp: string): string {
  return `${SPECS[scope].filePrefix}-${stamp}.xlsx`;
}
