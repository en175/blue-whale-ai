#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const { getPrismaClient } = await import(
  resolve(scriptDir, "../dist/libs/shared/persistence/db.js")
);
const { ensureCanvasRowsImported, inspectCanvasRowsImport, compareCanvasJson } = await import(
  resolve(scriptDir, "../dist/libs/shared/persistence/canvas-json-import.js")
);

const APPLY = process.argv.includes("--apply");

function valueArg(prefix) {
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg === undefined ? undefined : arg.slice(prefix.length);
}

function positiveInt(prefix, fallback) {
  const raw = valueArg(prefix);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`✗ ${prefix.slice(0, -1)} 需要正整数，收到 ${raw}`);
    process.exit(1);
  }
  return value;
}

const BATCH_SIZE = positiveInt("--batch-size=", 200);
const MAX_PROJECTS = positiveInt("--max-projects=", Number.MAX_SAFE_INTEGER);
const REPORT_PATH = resolve(valueArg("--report=") ?? "canvas-rows-backfill-report.json");

if (!process.env.DATABASE_URL) {
  console.error(
    "✗ 缺少 DATABASE_URL。用法：DATABASE_URL=mysql://... node backend/scripts/backfill-project-canvas-rows.mjs [--apply] [--batch-size=200] [--max-projects=N] [--report=path]",
  );
  process.exit(1);
}

console.log(
  `\n=== 存量画布行表回填 — ${APPLY ? "APPLY（写库）" : "DRY-RUN（只读，不写库）"}，批次 ${BATCH_SIZE} ===\n`,
);

const prisma = getPrismaClient(process.env.DATABASE_URL);
const projects = [];
const totals = {
  projects: 0,
  imported: 0,
  dry_run: 0,
  already_authoritative: 0,
  failed: 0,
  inconsistent: 0,
  duplicate_node_ids: 0,
};
let processed = 0;
let cursor = 0n;

const take = () => Math.min(BATCH_SIZE, MAX_PROJECTS - processed);

while (processed < MAX_PROJECTS) {
  const batch = await prisma.project_canvas.findMany({
    where: { id: { gt: cursor } },
    orderBy: { id: "asc" },
    take: take(),
    select: { id: true, project_id: true },
  });
  if (batch.length === 0) break;
  for (const row of batch) {
    cursor = row.id;
    processed += 1;
    const projectId = row.project_id;
    const entry = { project_id: projectId.toString(), status: "pending" };
    try {
      const outcome = APPLY
        ? await ensureCanvasRowsImported(prisma, projectId)
        : await inspectCanvasRowsImport(prisma, projectId);
      if (!outcome) {
        entry.status = "no_canvas";
      } else if (outcome.report.already_authoritative) {
        entry.status = "already_authoritative";
      } else {
        entry.status = APPLY ? "imported" : "dry_run";
        entry.report = outcome.report;
        entry.comparison = compareCanvasJson(
          outcome.legacy.nodes,
          outcome.legacy.edges,
          outcome.view.nodes,
          outcome.view.edges,
          new Set(outcome.report.migrated_cards),
        );
        if (!entry.comparison.consistent) {
          console.warn(`- project=${projectId} 比对不一致：${entry.comparison.differences.join(", ")}`);
        }
        if (outcome.report.duplicate_node_ids.length > 0) {
          console.warn(`- project=${projectId} 重复节点 id：${outcome.report.duplicate_node_ids.join(", ")}`);
        }
      }
    } catch (error) {
      entry.status = "failed";
      entry.error = {
        reason: error?.reason ?? null,
        message: error instanceof Error ? error.message : String(error),
      };
      console.warn(`- project=${projectId} 失败：${entry.error.message}`);
    }
    projects.push(entry);
  }
  console.log(`已处理 ${processed} 个项目，最新 canvas=${cursor}`);
}

for (const entry of projects) {
  totals.projects += 1;
  if (entry.status in totals) totals[entry.status] += 1;
  if (entry.comparison && !entry.comparison.consistent) totals.inconsistent += 1;
  if (entry.report) totals.duplicate_node_ids += entry.report.duplicate_node_ids.length;
}

const report = {
  mode: APPLY ? "apply" : "dry-run",
  generated_at: new Date().toISOString(),
  batch_size: BATCH_SIZE,
  totals,
  projects,
};
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

console.log(
  `\n共 ${totals.projects} 个项目：${APPLY ? `已回填 ${totals.imported}` : `可回填 ${totals.dry_run}`}，` +
    `已开启 ${totals.already_authoritative}，失败 ${totals.failed}，比对不一致 ${totals.inconsistent}，重复节点 id ${totals.duplicate_node_ids}` +
    (APPLY ? "（已写库）" : "（DRY-RUN，加 --apply 写库）"),
);
console.log(`报告：${REPORT_PATH}`);

await prisma.$disconnect();
