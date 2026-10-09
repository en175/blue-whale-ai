import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  buildExportWorkbook,
  exportFieldKeys,
  type ExportConsumeRow,
  type ExportLotRow,
  type ExportOrderRow,
} from "./account-export.js";

async function readBack(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets[0];
}

function headersOf(sheet: ExcelJS.Worksheet): unknown[] {
  return (sheet.getRow(1).values as unknown[]).slice(1);
}

function orderRow(over: Partial<ExportOrderRow> = {}): ExportOrderRow {
  return {
    product_name: "自定义充值 · 600 积分",
    amount_fen: 4000,
    credits: 600,
    bonus_credits: 0,
    status: "paid",
    created_at: "2026-09-29T14:32:00+08:00",
    paid_at: "2026-09-29T14:32:41+08:00",
    ...over,
  };
}

describe("buildExportWorkbook", () => {
  it("订单：金额从**分**换成元，未到账的到账积分留空而不是 0", async () => {
    const buffer = await buildExportWorkbook(
      {
        scope: "orders",
        rows: [
          orderRow(),
          orderRow({ amount_fen: 20000, credits: 3000, status: "pending" }),
        ],
        total: 2,
      },
      [],
    );

    const sheet = await readBack(buffer);
    expect(headersOf(sheet)).toEqual([
      "下单时间",
      "商品名称",
      "支付金额",
      "到账积分",
      "状态",
    ]);
    expect(sheet.getRow(2).getCell(3).value).toBe(40);
    expect(sheet.getRow(2).getCell(4).value).toBe(600);
    expect(sheet.getRow(3).getCell(4).value).toBe("—");
    expect(sheet.getRow(2).getCell(5).value).toBe("已到账");
  });

  it("订单：到账积分 = 基础 + 赠送，未到账一律留空且不含订单编号列", async () => {
    const sheet = await readBack(
      await buildExportWorkbook(
        {
          scope: "orders",
          rows: [
            orderRow({ credits: 3000, bonus_credits: 300, status: "paid" }),
            orderRow({ credits: 3000, bonus_credits: 300, status: "expired" }),
          ],
          total: 2,
        },
        [],
      ),
    );

    expect(sheet.getRow(2).getCell(4).value).toBe(3300);
    expect(sheet.getRow(2).getCell(5).value).toBe("已到账");
    expect(sheet.getRow(3).getCell(4).value).toBe("—");
    expect(sheet.getRow(3).getCell(5).value).toBe("已取消");
    expect(headersOf(sheet)).not.toContain("订单编号");
  });

  it("已获取：获取详情用商品名称 + 批次剩余，永久批次写「永久有效」", async () => {
    const rows: ExportLotRow[] = [
      {
        source: "purchased",
        amount: 3000,
        remaining: 1200,
        created_at: "2024-12-01T09:12:00+08:00",
        expires_at: "2026-12-01T00:00:00+08:00",
        product_name: "自定义充值 · 3,000 积分",
      },
      {
        source: "gift",
        amount: 100,
        remaining: 100,
        created_at: "2026-09-01T09:00:00+08:00",
        expires_at: "",
        product_name: null,
      },
    ];

    const sheet = await readBack(
      await buildExportWorkbook({ scope: "gain", rows, total: 2 }, []),
    );

    expect(headersOf(sheet)).toEqual([
      "获取时间",
      "获取来源",
      "获取详情",
      "积分生效时间",
      "积分到期时间",
      "积分值",
    ]);
    expect(sheet.getRow(2).getCell(1).value).toBe("2024-12-01T09:12:00+08:00");
    expect(sheet.getRow(2).getCell(2).value).toBe("充值到账");
    expect(sheet.getRow(2).getCell(3).value).toBe("自定义充值 · 3,000 积分 · 剩余 1200");
    expect(sheet.getRow(2).getCell(4).value).toBe("2024-12-01T09:12:00+08:00");
    expect(sheet.getRow(2).getCell(5).value).toBe("2026-12-01T00:00:00+08:00");
    expect(sheet.getRow(2).getCell(6).value).toBe(3000);
    expect(sheet.getRow(3).getCell(3).value).toBe("赠送 100 积分");
    expect(sheet.getRow(3).getCell(5).value).toBe("永久有效");
    expect(headersOf(sheet)).not.toContain("剩余");
  });

  it("已消耗：任务详情直接取后端拼好的 detail，过期核销行取批次上下文", async () => {
    const rows: ExportConsumeRow[] = [
      {
        type: "consume",
        credits: 30,
        task_type: "text2video",
        model_label: "Seedance 2.5",
        detail: "一只鲸鱼跃出水面",
        created_at: "2026-09-29T15:02:00+08:00",
      },
      {
        type: "expire",
        credits: 1200,
        task_type: null,
        model_label: null,
        detail: "2024-12-01 充值到账批次",
        created_at: "2026-09-29T09:00:00+08:00",
      },
    ];

    const sheet = await readBack(
      await buildExportWorkbook({ scope: "consume", rows, total: 2 }, []),
    );

    expect(headersOf(sheet)).toEqual([
      "消耗时间",
      "任务类型",
      "模型",
      "任务详情",
      "消耗积分",
    ]);
    expect(sheet.getRow(2).getCell(4).value).toBe("一只鲸鱼跃出水面");
    expect(sheet.getRow(2).getCell(2).value).toBe("text2video");
    expect(sheet.getRow(3).getCell(2).value).toBe("过期核销");
    expect(sheet.getRow(3).getCell(4).value).toBe("2024-12-01 充值到账批次");
    expect(sheet.getRow(3).getCell(5).value).toBe(1200);
    expect(headersOf(sheet)).not.toContain("任务 ID");
  });

  it("已消耗：detail 是后端唯一拼接口径（长提示词原样出，不截断）", async () => {
    const longPrompt = "一只长毛蓬松的布偶猫安静地坐在窗边，蓝眼睛清澈明亮，奶油色毛发，柔和自然光";

    const sheet = await readBack(
      await buildExportWorkbook(
        {
          scope: "consume",
          rows: [
            {
              type: "consume",
              credits: 0,
              task_type: "image",
              model_label: "Seedream 5.0 Lite",
              detail: longPrompt,
              created_at: "2026-09-29T15:02:00+08:00",
            },
          ],
          total: 1,
        },
        ["detail", "credits"],
      ),
    );

    expect(headersOf(sheet)).toEqual(["任务详情", "消耗积分"]);
    expect(sheet.getRow(2).getCell(1).value).toBe(longPrompt);
    expect(sheet.getRow(2).getCell(2).value).toBe(0);
  });

  it("勾选字段后只出那几列，且**按定义顺序**而不是传入顺序", async () => {
    const sheet = await readBack(
      await buildExportWorkbook(
        { scope: "orders", rows: [orderRow({ status: "pending" })], total: 1 },
        ["status", "product_name"],
      ),
    );

    expect(headersOf(sheet)).toEqual(["商品名称", "状态"]);
    expect(sheet.getRow(2).getCell(2).value).toBe("待支付");
  });

  it("★ 截断时最末行写明「仅导出前 N 条，共 M 条」", async () => {
    const sheet = await readBack(
      await buildExportWorkbook(
        { scope: "orders", rows: [orderRow()], total: 5 },
        [],
      ),
    );

    expect(sheet.getRow(3).getCell(1).value).toBe("⚠️ 仅导出前 1 条，共 5 条");
    const clean = await readBack(
      await buildExportWorkbook({ scope: "orders", rows: [], total: 0 }, []),
    );
    expect(clean.rowCount).toBe(1);
  });

  it("字段名清单覆盖三个页签，且每个都能被 select 到", () => {
    for (const scope of ["orders", "gain", "consume"] as const) {
      const keys = exportFieldKeys(scope);
      expect(keys.length).toBeGreaterThan(0);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
