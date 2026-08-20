#!/usr/bin/env node
// IK9VZ0：cost_reservations 只读对账报告脚本。
//
// 用途：把记账表 cost_reservations 中的差异行捞出来给运维/运营看。
// 只读不写：本脚本不写库、不动余额——"是否冲正/退补"由 new-api 端结算（Task 7 契约）决定。
//
// 四类规则：
//   R1 悬空预留：job 已终态（succeeded/partially_succeeded/failed/cancelled）但预留仍 reserved。
//   R2 零实扣：settled 且 actual_amount_fen = 0（可能是取证失败，需人工核对）。
//   R3 卡死任务：reserved 超过 24h 未终态（疑似卡死任务/worker 未结算）。
//   R4 预实偏差：settled 且 |actual - reserved| / reserved > 10%（第一版仅入报告，不设阈值告警、
//      不自动退补；待积累真实数据再定阈值）。
//
// 用法（环境无关，不内置连接串，见 ADR-0064）：
//   DATABASE_URL=mysql://... node scripts/reconcile-cost-reservations.mjs
//   DATABASE_URL=mysql://... node scripts/reconcile-cost-reservations.mjs --json   # 输出纯 JSON 便于 cron/告警消费
//
// 建议 cron（每日 03:00，运维群/告警系统消费）：
//   0 3 * * * cd <repo> && DATABASE_URL=... node scripts/reconcile-cost-reservations.mjs --json >> /var/log/bw-reconcile.log

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const { getPrismaClient } = await import(
  resolve(scriptDir, "../packages/persistence/dist/db.js")
);

const JSON_MODE = process.argv.includes("--json");
const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl) {
  console.error("✗ 缺少 DATABASE_URL（见 ADR-0064：本地不内置测试站连接串，应急走隧道）");
  process.exit(1);
}

const prisma = getPrismaClient(databaseUrl);

/** 终态 job 状态集合（与 generation worker 终态语义对齐）。 */
const FINAL_JOB_STATUSES = ["succeeded", "partially_succeeded", "failed", "cancelled"];
/** R4 预实偏差阈值（第一版仅报告）。 */
const R4_DEVIATION_RATIO = 0.1;
/** R3 卡死判定窗口（24h）。 */
const STALE_WINDOW_MS = 24 * 3600 * 1000;

try {
  // R1/R3 基础数据：全部 reserved 行。
  const reservedRows = await prisma.cost_reservations.findMany({
    where: { status: "reserved", is_delete: 0 },
    select: { generation_job_id: true, gmt_modified: true },
  });
  const reservedJobIds = [...new Set(reservedRows.map((r) => r.generation_job_id))];
  const jobs = reservedJobIds.length
    ? await prisma.generation_jobs.findMany({
        where: { id: { in: reservedJobIds } },
        select: { id: true, status: true },
      })
    : [];
  const jobStatusById = new Map(jobs.map((j) => [j.id.toString(), j.status]));

  const report = {
    generated_at: new Date().toISOString(),
    // R1：job 已终态但预留仍 reserved。
    dangling: reservedRows
      .filter((r) => FINAL_JOB_STATUSES.includes(jobStatusById.get(r.generation_job_id.toString()) ?? ""))
      .map((r) => r.generation_job_id.toString()),
    // R2：settled 且实扣为 0（取证失败可能）。
    zeroSettled: (
      await prisma.cost_reservations.findMany({
        where: { status: "settled", actual_amount_fen: 0n, is_delete: 0 },
        select: { generation_job_id: true },
      })
    ).map((r) => r.generation_job_id.toString()),
    // R3：reserved 超过 24h 未终态（疑似卡死）。
    stale: (() => {
      const cutoff = new Date(Date.now() - STALE_WINDOW_MS);
      return reservedRows
        .filter((r) => r.gmt_modified < cutoff)
        .map((r) => r.generation_job_id.toString());
    })(),
    // R4：settled 且预实偏差 > 10%（仅报告）。
    diffOverThreshold: (
      await prisma.cost_reservations.findMany({
        where: { status: "settled", is_delete: 0 },
        select: { generation_job_id: true, reserved_amount_fen: true, actual_amount_fen: true },
      })
    )
      .filter((r) => {
        const reserved = Number(r.reserved_amount_fen ?? 0n);
        const actual = Number(r.actual_amount_fen ?? 0n);
        return reserved > 0 && Math.abs(actual - reserved) / reserved > R4_DEVIATION_RATIO;
      })
      .map((r) => ({
        job: r.generation_job_id.toString(),
        reserved_fen: r.reserved_amount_fen.toString(),
        actual_fen: (r.actual_amount_fen ?? 0n).toString(),
      })),
  };

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`对账报告（${report.generated_at}）`);
    console.log(`  R1 悬空预留（${report.dangling.length}）：${report.dangling.join(", ") || "无"}`);
    console.log(`  R2 零实扣（${report.zeroSettled.length}）：${report.zeroSettled.join(", ") || "无"}`);
    console.log(`  R3 卡死任务（${report.stale.length}）：${report.stale.join(", ") || "无"}`);
    console.log(`  R4 预实偏差（${report.diffOverThreshold.length}）：${JSON.stringify(report.diffOverThreshold)}`);
    console.log("（只读对账：不写库、不动余额；冲正/退补由 new-api 端结算按 cost-settlement-sync-contract.md 执行）");
  }
} finally {
  await prisma.$disconnect();
}
