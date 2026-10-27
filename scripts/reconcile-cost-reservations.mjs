#!/usr/bin/env node

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const { getPrismaClient } = await import(
  pathToFileURL(resolve(scriptDir, "../backend/dist/libs/shared/persistence/db.js")).href
);

const JSON_MODE = process.argv.includes("--json");
const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl) {
  console.error("✗ 缺少 DATABASE_URL（见 ADR-0064：本地不内置测试站连接串，应急走隧道）");
  process.exit(1);
}

const prisma = getPrismaClient(databaseUrl);

const FINAL_JOB_STATUSES = ["succeeded", "partially_succeeded", "failed", "cancelled"];
const R4_DEVIATION_RATIO = 0.1;
const STALE_WINDOW_MS = 24 * 3600 * 1000;

try {
  const reservedRows = await prisma.billing_cost_reservations.findMany({
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
    dangling: reservedRows
      .filter((r) => FINAL_JOB_STATUSES.includes(jobStatusById.get(r.generation_job_id.toString()) ?? ""))
      .map((r) => r.generation_job_id.toString()),
    zeroSettled: (
      await prisma.billing_cost_reservations.findMany({
        where: { status: "settled", actual_amount_fen: 0n, is_delete: 0 },
        select: { generation_job_id: true },
      })
    ).map((r) => r.generation_job_id.toString()),
    stale: (() => {
      const cutoff = new Date(Date.now() - STALE_WINDOW_MS);
      return reservedRows
        .filter((r) => r.gmt_modified < cutoff)
        .map((r) => r.generation_job_id.toString());
    })(),
    diffOverThreshold: (
      await prisma.billing_cost_reservations.findMany({
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
