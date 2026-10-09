import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  buildExportWorkbook,
  exportFieldKeys,
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
    trade_no: "BW-1",
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
          orderRow({ trade_no: "BW-2", amount_fen: 20000, credits: 3000, status: "paid_pending" }),
        ],
        total: 2,
      },
      [],
    );

    const sheet = await readBack(buffer);
    expect(headersOf(sheet)).toEqual([
      "下单时间",
      "商品名称",
      "订单编号",
      "支付金额",
      "到账积分",
      "状态",
    ]);
    expect(sheet.getRow(2).getCell(4).value).toBe(40);
    expect(sheet.getRow(2).getCell(5).value).toBe(600);
    expect(sheet.getRow(3).getCell(5).value).toBe("");
    expect(sheet.getRow(2).getCell(6).value).toBe("已到账");
  });

  it("已获取：订单号只出现在「获取详情」里，永久批次写「永久有效」", async () => {
    const rows: ExportLotRow[] = [
      {
        lot_id: "1",
        source: "purchased",
        amount: 3000,
        remaining: 1200,
        created_at: "2024-12-01T09:12:00+08:00",
        expires_at: "2026-12-01T00:00:00+08:00",
        biz_type: "recharge",
        biz_id: "BW20241201091200555",
      },
      {
        lot_id: "2",
        source: "gift",
        amount: 100,
        remaining: 100,
        created_at: "2026-09-01T09:00:00+08:00",
        expires_at: "",
        biz_type: "",
        biz_id: "",
      },
    ];

    const sheet = await readBack(
      await buildExportWorkbook({ scope: "gain", rows, total: 2 }, []),
    );

    expect(sheet.getRow(2).getCell(1).value).toBe("2024-12-01T09:12:00+08:00");
    expect(sheet.getRow(2).getCell(2).value).toBe("充值到账");
    expect(sheet.getRow(2).getCell(3).value).toBe("自定义充值 3000 积分 · 订单 BW20241201091200555");
    expect(sheet.getRow(2).getCell(4).value).toBe("2026-12-01T00:00:00+08:00");
    expect(sheet.getRow(2).getCell(5).value).toBe(3000);
    expect(sheet.getRow(2).getCell(6).value).toBe(1200);
    expect(sheet.getRow(3).getCell(4).value).toBe("永久有效");
  });

  it("已消耗：过期核销由 type 定，任务行查不到任务时回落 title", async () => {
    const buffer = await buildExportWorkbook(
      {
        scope: "consume",
        rows: [
          {
            id: "res:1",
            type: "consume",
            title: "视频生成 · seedance-2.5",
            credits: 30,
            job_id: "7",
            task_type: "text2video",
            model_label: "Seedance 2.5",
            prompt: null,
            created_at: "2026-09-29T15:02:00+08:00",
          },
          {
            id: "led:9",
            type: "expire",
            title: "积分过期",
            credits: 1200,
            job_id: null,
            task_type: null,
            model_label: null,
            prompt: null,
            created_at: "2026-09-29T09:00:00+08:00",
          },
        ],
        total: 2,
      },
      [],
    );

    const sheet = await readBack(buffer);
    expect(sheet.getRow(2).getCell(4).value).toBe("视频生成 · seedance-2.5");
    expect(sheet.getRow(2).getCell(2).value).toBe("text2video");
    expect(sheet.getRow(3).getCell(2).value).toBe("过期核销");
    expect(sheet.getRow(3).getCell(5).value).toBe("");
    expect(sheet.getRow(3).getCell(6).value).toBe(1200);
  });

  it("勾选字段后只出那几列，且**按定义顺序**而不是传入顺序", async () => {
    const sheet = await readBack(
      await buildExportWorkbook(
        { scope: "orders", rows: [orderRow({ status: "pending" })], total: 1 },
        ["status", "trade_no"],
      ),
    );

    expect(headersOf(sheet)).toEqual(["订单编号", "状态"]);
    expect(sheet.getRow(2).getCell(1).value).toBe("BW-1");
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
