#!/usr/bin/env node

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const { getPrismaClient } = await import(
  resolve(scriptDir, "../backend/dist/libs/shared/persistence/db.js")
);
const { aggregateSlotStatus, resolveLogicalSlots } = await import(
  resolve(scriptDir, "../backend/dist/libs/shared/persistence/generation-output-slot-repo.js")
);

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  fail("缺少 DATABASE_URL 环境变量。用法：DATABASE_URL=... node <脚本> [--dry-run|--apply]");
}

const mode = APPLY ? "APPLY（写库）" : "DRY-RUN（只读，不写库）";
console.log(`\n=== IK7GRV replace 输出槽脏数据修复 — ${mode} ===\n`);

const prisma = getPrismaClient(process.env.DATABASE_URL);

const affectedRecords = await prisma.scene_card_generation_records.findMany({
  where: {
    first_generation_job_id: {
      in: (
        await prisma.generation_output_slots.findMany({
          where: { scene_card_generation_record_id: null },
          select: { generation_job_id: true },
          distinct: ["generation_job_id"],
        })
      ).map((s) => s.generation_job_id),
    },
  },
  select: {
    id: true,
    first_generation_job_id: true,
    summary_status: true,
    version: true,
    scene_card_id: true,
  },
  orderBy: { id: "asc" },
});

console.log(`识别到受影响 record：${affectedRecords.length} 条\n`);

if (affectedRecords.length === 0) {
  console.log("✓ 无脏数据，无需修复。脚本幂等退出。");
  await prisma.$disconnect();
  process.exit(0);
}

const summary = [];

for (const record of affectedRecords) {
  const chainSlots = await prisma.$queryRawUnsafe(
    `WITH RECURSIVE chain AS (
       SELECT id, generation_job_id, scene_card_generation_record_id, slot_index, status, retry_of_slot_id
       FROM generation_output_slots
       WHERE generation_job_id = ?
       UNION ALL
       SELECT s.id, s.generation_job_id, s.scene_card_generation_record_id, s.slot_index, s.status, s.retry_of_slot_id
       FROM generation_output_slots s
       JOIN chain c ON s.retry_of_slot_id = c.id
     )
     SELECT id, generation_job_id, scene_card_generation_record_id, slot_index, status FROM chain`,
    record.first_generation_job_id,
  );

  const unbound = chainSlots.filter(
    (s) => s.scene_card_generation_record_id == null,
  );

  const computeSummary = (slots) =>
    aggregateSlotStatus(
      resolveLogicalSlots(
        slots.map((s) => ({
          slot_index: Number(s.slot_index),
          status: s.status,
        })),
      ).map((s) => s.status),
    );

  const entry = {
    recordId: record.id,
    sceneCardId: record.scene_card_id,
    jobId: record.first_generation_job_id,
    slotsTotal: chainSlots.length,
    slotsUnbound: unbound.length,
    statusBefore: record.summary_status,
  };

  if (DRY_RUN) {
    summary.push({ ...entry, statusAfter: computeSummary(chainSlots) });
    continue;
  }

  await prisma.$transaction(async (tx) => {
    if (unbound.length > 0) {
      await tx.generation_output_slots.updateMany({
        where: {
          id: { in: unbound.map((s) => BigInt(s.id)) },
          scene_card_generation_record_id: null,
        },
        data: { scene_card_generation_record_id: record.id },
      });
    }
    const boundSlots = await tx.generation_output_slots.findMany({
      where: { scene_card_generation_record_id: record.id },
      select: { slot_index: true, status: true },
      orderBy: { id: "asc" },
    });
    const summaryComputed = computeSummary(boundSlots);
    await tx.scene_card_generation_records.update({
      where: { id: record.id },
      data: { summary_status: summaryComputed, version: { increment: 1 } },
    });
    summary.push({ ...entry, statusAfter: summaryComputed });
  });
}

for (const r of summary) {
  const flag = r.statusBefore === r.statusAfter ? "（不变）" : "（校正）";
  console.log(
    `  record ${r.recordId}  scene_card ${r.sceneCardId}  job ${r.jobId}  ` +
      `slots ${r.slotsTotal}(未绑${r.slotsUnbound})  ` +
      `summary ${r.statusBefore} → ${r.statusAfter}${flag}`,
  );
}

const totalUnbound = summary.reduce((n, r) => n + r.slotsUnbound, 0);
const willChange = summary.filter((r) => r.statusBefore !== r.statusAfter).length;

console.log(
  `\n汇总：受影响 record ${summary.length} 条，待回填输出槽 ${totalUnbound} 个（含重试链），` +
    `summary_status 将变更 ${willChange} 条。`,
);

if (DRY_RUN) {
  console.log("\n（dry-run 未写库。确认无误后加 --apply 执行。）");
} else {
  console.log("\n✓ 回填 + 重算完成。建议立即再跑一次 --dry-run 确认识别集合为空（幂等校验）。");
}

await prisma.$disconnect();
