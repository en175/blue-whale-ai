#!/usr/bin/env node
// IK7GRV：存量 replace 脏数据一次性修复脚本。
//
// 背景：IK7GRT 修复前，scene_card_replace 路径创建 SceneCardGenerationRecord 后未回填
// 其首个 GenerationJob 输出槽的 scene_card_generation_record_id（恒为 NULL）。重试路径
// 创建新槽时从被重试原始槽继承该字段（generation-command-repo.ts:490-495），原始槽 NULL
// 则重试槽也 NULL，故脏数据沿整条重试链扩散。后果：
//   - worker 结算按 firstSlot.scene_card_generation_record_id 聚合 summary_status，该字段
//     为 falsy 即跳过 → record.summary_status 永停「生成中」；
//   - Snapshot 投影按该外键过滤，这些输出槽（含重试槽）恒不投影。
// IK7GRT（commit 6ddbea89）已修复 replace 路径的新数据，本脚本一次性回填历史脏数据。
//
// 三步修复，口径严格对齐生产重算 syncRecordSummary（storyboard-summary-repo.ts（worker 退役后由 syncStoryboardPreviewSummary 承担））：
//   Step 1 回填：递归沿 retry_of_slot_id 链收集每个脏 record 首个 job 衍生的全部 slot
//                （原始 + 各层重试），把其中 record 关联为 NULL 的绑回 record.id。
//   Step 2 重算：回填后同事务内按 scene_card_generation_record_id = record.id 取该 record
//                全部 slot（与 syncRecordSummary 同口径，覆盖重试链），复用生产纯函数
//                resolveLogicalSlots + aggregateSlotStatus 算四态。
//                必须在回填后查——回填前脏槽关联仍为 NULL，按 record 查得空集，
//                aggregateSlotStatus([]) 返回 failed 会把正常 record 错写且不可自愈。
//   Step 3 写回：update summary_status（version 自增）。
//                不追加 project_event——一次性修复不应污染审计事件流。
//
// 幂等：识别与回填均对「NULL 关联」敏感；第二次运行识别集合为空 → 零操作退出。重算本身
// 幂等（同一输入同一输出）。create/regenerate 路径的输出槽从来非 NULL，天然不在识别集合。
//
// 用法（环境无关，不内置连接串，见 ADR-0064）：
//   pnpm install                           # 拉 @prisma/client + adapter-mariadb
//   DATABASE_URL=... node scripts/fix-ik7grv-replace-slot-backfill.mjs --dry-run   # 默认，只打印
//   DATABASE_URL=... node scripts/fix-ik7grv-replace-slot-backfill.mjs --apply     # 执行回填+重算

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 相对路径直接引用已 build 的 dist，避免依赖 pnpm workspace 符号链接解析。
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

// 识别受影响 record：其 first_generation_job_id 对应的输出槽存在、但 record 关联为 NULL。
// 不依赖 application_kind/时间窗——直击验收标准①的字面判据；create/regenerate 正确数据
// 的输出槽从来非 NULL，天然排除。
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
  // 递归收集该 record 首个 job 衍生的全部 slot（原始 + 各层重试）。
  // retry_of_slot_id 链指向被重试的原始槽，根槽属于 first_generation_job_id。
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

  // 重算口径对齐 syncRecordSummary：按 record 关联取全部 slot。
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

  // dry-run 未回填，用 chain 本身（等同回填后的集合）算预演结果。
  if (DRY_RUN) {
    summary.push({ ...entry, statusAfter: computeSummary(chainSlots) });
    continue;
  }

  // 每条 record 独立事务，避免长事务锁竞争。
  await prisma.$transaction(async (tx) => {
    // Step 1：回填 NULL 关联（where 含 null 条件 → 幂等）。回填整条重试链的 NULL slot。
    if (unbound.length > 0) {
      await tx.generation_output_slots.updateMany({
        where: {
          id: { in: unbound.map((s) => BigInt(s.id)) },
          scene_card_generation_record_id: null,
        },
        data: { scene_card_generation_record_id: record.id },
      });
    }
    // Step 2：回填后按 record 关联取全部 slot 重算（口径同 syncRecordSummary）。
    // 必须在 Step 1 之后查——回填前脏槽关联仍为 NULL，按 record 查只能拿到空集，
    // aggregateSlotStatus([]) 返回 failed，会把正常 record 错写为 failed 且不可自愈。
    const boundSlots = await tx.generation_output_slots.findMany({
      where: { scene_card_generation_record_id: record.id },
      select: { slot_index: true, status: true },
      orderBy: { id: "asc" },
    });
    const summaryComputed = computeSummary(boundSlots);
    // Step 3：写回 summary_status（version 自增，对齐 syncRecordSummary）。
    await tx.scene_card_generation_records.update({
      where: { id: record.id },
      data: { summary_status: summaryComputed, version: { increment: 1 } },
    });
    summary.push({ ...entry, statusAfter: summaryComputed });
  });
}

// 打印逐条明细。
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
