import ExcelJS from "exceljs";

/**
 * 「账户积分与订单」页导出 xlsx。
 *
 * <p>为什么放**后端**生成而不是前端拼：原型写的是「导出范围为当前页签**全部记录**」，
 * 不是当前页。前端要循环分页把全量拉下来，会撞 10 秒请求超时；而且流水行的 `title`
 * 是 billing **预渲染**的字符串，前端拿不到原始维度去拼列。
 *
 * <p>⚠️ **不套 `{code,data,msg}` 信封**（这是二进制流）：路由上标 `@BypassTransform()`，
 * 前端也必须绕过 `http.ts` 的统一信封解析，用原生 fetch 取 blob。
 *
 * <p>⚠️ **截断是显式的**：导出有行数上限（见 {@link MAX_EXPORT_ROWS}），超过时最后一行的
 * 第一格会写明「仅导出前 N 条，共 M 条」。本仓禁止静默截断 —— 一个看起来完整的文件
 * 比一个少了几行的文件危险得多。
 */
export const EXPORT_SCOPES = ["orders", "gain", "consume"] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

/**
 * 每次导出的行数上限。
 *
 * <p>它是**保护**不是配额：导出要一次性把全量组装进内存，无上限的话一个重度用户
 * （两年积累上万条流水）就能把进程拖垮。到顶就截断并在文件里写明，不静默丢。
 */
export const MAX_EXPORT_ROWS = 10_000;

interface ExportColumn<T> {
  /** 前端勾选时用的字段名（`fields` 传的就是它）。也是**唯一**的字段标识。 */
  key: string;
  /** xlsx 表头。**前端弹层的勾选项文案与这里共用一份**，别两边各写一套。 */
  header: string;
  value: (row: T) => string | number;
  width: number;
}

/** 一页导出的定义：表名、文件名前缀、可选列。 */
interface ExportSpec<T> {
  sheetName: string;
  filePrefix: string;
  columns: ExportColumn<T>[];
}

/* ---------- 订单记录 ---------- */

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

/** 订单状态的中文。**与前端 §5.2 那张表同一份口径**，改一处要改两处。 */
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
    // ⚠️ 库里是**分**：导出成元是给人看的表，不能把 4000 直接写成「4000 元」
    { key: "amount_yuan", header: "支付金额", value: (r) => r.amount_fen / 100, width: 14 },
    {
      key: "credits",
      header: "到账积分",
      // 未到账写空串而不是 0：**查不到 ≠ 0**（原型口径①）。用户看到 0 会以为发了 0 分
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

/* ---------- 积分明细 · 已获取 ---------- */

export interface ExportLotRow {
  lot_id: string;
  source: string;
  amount: number;
  remaining: number;
  created_at: string;
  /** 空串 = 永久有效 */
  expires_at: string;
  biz_type: string;
  biz_id: string;
}

/** 批次口径来源的中文。**与 `source` 不是流水口径**，别拿 `recharge` 那张表套。 */
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
      // 订单号只在「已获取」这一处出现（原型口径③）：它是唯一能把这笔积分
      // 追回订单的线索，别的页签都不该带它
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

/* ---------- 积分明细 · 已消耗 ---------- */

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
      // 过期核销不是任务，它由 type 决定；任务行则由我们自己库查回来的 task_type 决定。
      // 两个来源都查不到时**写空串**，不编一个词出来
      value: (r) => (r.type === "expire" ? "过期核销" : (r.task_type ?? "")),
      width: 16,
    },
    { key: "model_label", header: "模型", value: (r) => r.model_label ?? "", width: 20 },
    {
      key: "detail",
      header: "任务详情",
      // 查不到任务（跨库历史 / 已清理）时回落 `title` —— 那笔钱确实发生过，
      // 只是任务查不到了。**不是错误**，也不该在导出里变成一行空白
      value: (r) => r.prompt ?? r.title,
      width: 48,
    },
    { key: "job_id", header: "任务 ID", value: (r) => r.job_id ?? "", width: 14 },
    { key: "credits", header: "消耗积分", value: (r) => r.credits, width: 12 },
  ],
};

const SPECS = { orders: ORDERS, gain: GAIN, consume: CONSUME } as const;

/** 某个 scope 的全部字段名 —— 前端弹层勾选项的来源。 */
export function exportFieldKeys(scope: ExportScope): string[] {
  return SPECS[scope].columns.map((column) => column.key);
}

/**
 * 组装 xlsx。
 *
 * @param scope    页签
 * @param fields   要导出的字段名（来自 {@link exportFieldKeys}）；空 = 全字段
 * @param rows     全部记录（**不受分页限制**，由调用方拉全量后传来）
 * @param total    该查询条件下的真实总条数；`> rows.length` 说明发生了截断，
 *                 文件末尾会补一行说明
 */
export async function buildExportWorkbook<T>(
  scope: ExportScope,
  fields: string[],
  rows: T[],
  total: number,
): Promise<Buffer> {
  const spec = SPECS[scope] as ExportSpec<T>;
  // 空 = 全字段（原型：「默认全字段」）。传了就用传的，顺序按定义来的顺序、不按传入顺序——
  // 表头顺序不该由查询串里逗号的先后决定
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

  // ⚠️ 截断必须在**文件里**说出来。一个看起来完整的文件比一个少了几行的文件危险得多：
  //    用户会拿它去对账，而少的那部分没有任何痕迹
  if (total > rows.length) {
    const note = sheet.addRow({});
    note.getCell(1).value = `⚠️ 仅导出前 ${rows.length} 条，共 ${total} 条`;
  }

  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** 文件名（RFC 5987 交给调用方编码；这里只出纯文本部分）。 */
export function exportFileName(scope: ExportScope, stamp: string): string {
  return `${SPECS[scope].filePrefix}-${stamp}.xlsx`;
}
