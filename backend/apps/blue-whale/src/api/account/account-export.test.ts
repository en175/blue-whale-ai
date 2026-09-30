import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildExportWorkbook, exportFieldKeys } from "./account-export.js";

/**
 * 导出 xlsx 的**真产出**测试：真的把 buffer 交回 exceljs 读一遍。
 *
 * <p>⚠️ 为什么不只看「函数没抛异常」：xlsx 是二进制容器，写坏一列、行错位、金额单位写错，
 * 在服务端都**不会报错** —— 只有用户下载下来打开才发现。所以这里一律回读断言，
 * 而不是断言中间产物。
 */
async function readBack(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets[0];
}

/** exceljs 的 `row.values` 是 1-based，第 0 位恒为 undefined —— 抹掉它再断言。 */
function headersOf(sheet: ExcelJS.Worksheet): unknown[] {
  return (sheet.getRow(1).values as unknown[]).slice(1);
}

describe("buildExportWorkbook", () => {
  it("订单：金额从**分**换成元，未到账的到账积分留空而不是 0", async () => {
    const buffer = await buildExportWorkbook(
      "orders",
      [],
      [
        {
          trade_no: "BW-1",
          product_name: "自定义充值 · 600 积分",
          amount_fen: 4000,
          credits: 600,
          bonus_credits: 0,
          status: "paid",
          created_at: "2026-09-29T14:32:00+08:00",
          paid_at: "2026-09-29T14:32:41+08:00",
        },
        {
          // 待到账：钱收了、积分还没发。到账积分必须是**空**，不是 0
          trade_no: "BW-2",
          product_name: "自定义充值 · 3,000 积分",
          amount_fen: 20000,
          credits: 3000,
          bonus_credits: 0,
          status: "paid_pending",
          created_at: "2026-09-28T09:58:00+08:00",
          paid_at: null,
        },
      ],
      2,
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
    // 4000 分 = 40 元。写成 4000 就是 100 倍的错，而服务端不会报错
    expect(sheet.getRow(2).getCell(4).value).toBe(40);
    expect(sheet.getRow(2).getCell(5).value).toBe(600);
    // ★ 查不到 ≠ 0：未到账那一行的到账积分是空串
    expect(sheet.getRow(3).getCell(5).value).toBe("");
    // 状态用中文，且 `expired` 不是「已过期」
    expect(sheet.getRow(2).getCell(6).value).toBe("已到账");
  });

  it("已获取：订单号只出现在「获取详情」里，永久批次写「永久有效」", async () => {
    const buffer = await buildExportWorkbook("gain", [], [
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
    ], 2);

    const sheet = await readBack(buffer);
    expect(sheet.getRow(2).getCell(1).value).toBe("2024-12-01T09:12:00+08:00");
    expect(sheet.getRow(2).getCell(2).value).toBe("充值到账");
    expect(sheet.getRow(2).getCell(3).value).toBe("自定义充值 3000 积分 · 订单 BW20241201091200555");
    expect(sheet.getRow(2).getCell(4).value).toBe("2026-12-01T00:00:00+08:00");
    expect(sheet.getRow(2).getCell(5).value).toBe(3000);
    expect(sheet.getRow(2).getCell(6).value).toBe(1200);
    // 空串到期时间 = 永久有效；写成空白会让人以为这一列没读到
    expect(sheet.getRow(3).getCell(4).value).toBe("永久有效");
  });

  it("已消耗：过期核销由 type 定，任务行查不到任务时回落 title", async () => {
    const buffer = await buildExportWorkbook("consume", [], [
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
    ], 2);

    const sheet = await readBack(buffer);
    // 任务查不到提示词 → 回落 title，不是留空
    expect(sheet.getRow(2).getCell(4).value).toBe("视频生成 · seedance-2.5");
    expect(sheet.getRow(2).getCell(2).value).toBe("text2video");
    // 过期核销不是任务：类型由 type 决定，任务 ID 留空
    expect(sheet.getRow(3).getCell(2).value).toBe("过期核销");
    expect(sheet.getRow(3).getCell(5).value).toBe("");
    expect(sheet.getRow(3).getCell(6).value).toBe(1200);
  });

  it("勾选字段后只出那几列，且**按定义顺序**而不是传入顺序", async () => {
    const buffer = await buildExportWorkbook(
      "orders",
      ["status", "trade_no"],
      [
        {
          trade_no: "BW-1",
          product_name: "p",
          amount_fen: 100,
          credits: 1,
          bonus_credits: 0,
          status: "pending",
          created_at: "2026-09-29T14:32:00+08:00",
          paid_at: null,
        },
      ],
      1,
    );

    const sheet = await readBack(buffer);
    // 传的是 status 在前，出来的仍是「订单编号, 状态」——表头顺序不该由查询串里逗号的先后决定
    expect(headersOf(sheet)).toEqual(["订单编号", "状态"]);
    expect(sheet.getRow(2).getCell(1).value).toBe("BW-1");
  });

  it("★ 截断时最末行写明「仅导出前 N 条，共 M 条」", async () => {
    const buffer = await buildExportWorkbook(
      "orders",
      [],
      [
        {
          trade_no: "BW-1",
          product_name: "p",
          amount_fen: 100,
          credits: 1,
          bonus_credits: 0,
          status: "pending",
          created_at: "2026-09-29T14:32:00+08:00",
          paid_at: null,
        },
      ],
      // 真实总数 5 条、只拿到 1 条 = 发生了截断
      5,
    );

    const sheet = await readBack(buffer);
    expect(sheet.getRow(3).getCell(1).value).toBe("⚠️ 仅导出前 1 条，共 5 条");
    // 没有截断时**不该**有这一行 —— 否则每个正常文件末尾都多一行噪音
    const clean = await readBack(
      await buildExportWorkbook("orders", [], [], 0),
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
