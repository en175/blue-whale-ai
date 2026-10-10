import { wallClockHumanFromIso } from "@lib/core";
import ExcelJS from "exceljs";
import {
  USER_ORDER_STATUS_LABEL,
  type UserOrderStatus,
} from "@lib/shared/recharge/user-order-status.js";
import { EXPIRE_TYPE, lotSourceText } from "./consumption-detail.js";

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
  product_name: string;
  amount_fen: number;
  credits: number;
  bonus_credits: number;
  status: UserOrderStatus;
  created_at: string;
  paid_at: string | null;
}

const ORDERS: ExportSpec<ExportOrderRow> = {
  sheetName: "订单记录",
  filePrefix: "订单记录",
  columns: [
    {
      key: "created_at",
      header: "下单时间",
      value: (r) => wallClockHumanFromIso(r.created_at),
      width: 22,
    },
    { key: "product_name", header: "商品名称", value: (r) => r.product_name, width: 28 },
    { key: "amount_yuan", header: "支付金额", value: (r) => r.amount_fen / 100, width: 14 },
    {
      key: "credits",
      header: "到账积分",
      value: (r) => (r.status === "paid" ? r.credits + r.bonus_credits : "—"),
      width: 14,
    },
    {
      key: "status",
      header: "状态",
      value: (r) => USER_ORDER_STATUS_LABEL[r.status] ?? r.status,
      width: 18,
    },
  ],
};

export interface ExportLotRow {
  source: string;
  amount: number;
  remaining: number;
  created_at: string;
  expires_at: string;
  product_name: string | null;
}

function lotDetail(row: ExportLotRow): string {
  const head = row.product_name ?? `${lotSourceText(row.source)} ${row.amount} 积分`;
  return row.remaining < row.amount ? `${head} · 剩余 ${row.remaining}` : head;
}

const GAIN: ExportSpec<ExportLotRow> = {
  sheetName: "已获取",
  filePrefix: "积分明细-已获取",
  columns: [
    {
      key: "created_at",
      header: "获取时间",
      value: (r) => wallClockHumanFromIso(r.created_at),
      width: 22,
    },
    {
      key: "source",
      header: "获取来源",
      value: (r) => lotSourceText(r.source),
      width: 14,
    },
    { key: "detail", header: "获取详情", value: lotDetail, width: 40 },
    {
      key: "activated_at",
      header: "积分生效时间",
      value: (r) => wallClockHumanFromIso(r.created_at),
      width: 22,
    },
    {
      key: "expires_at",
      header: "积分到期时间",
      value: (r) => (r.expires_at === "" ? "永久有效" : wallClockHumanFromIso(r.expires_at)),
      width: 22,
    },
    { key: "amount", header: "积分值", value: (r) => r.amount, width: 12 },
  ],
};

export interface ExportConsumeRow {
  type: string;
  credits: number;
  task_type: string | null;
  model_label: string | null;
  detail: string;
  created_at: string;
}

const CONSUME: ExportSpec<ExportConsumeRow> = {
  sheetName: "已消耗",
  filePrefix: "积分明细-已消耗",
  columns: [
    {
      key: "created_at",
      header: "消耗时间",
      value: (r) => wallClockHumanFromIso(r.created_at),
      width: 22,
    },
    {
      key: "task_type",
      header: "任务类型",
      value: (r) => (r.type === EXPIRE_TYPE ? "过期核销" : (r.task_type ?? "")),
      width: 16,
    },
    { key: "model_label", header: "模型", value: (r) => r.model_label ?? "", width: 20 },
    { key: "detail", header: "任务详情", value: (r) => r.detail, width: 48 },
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
