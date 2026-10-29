#!/usr/bin/env node

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const { getPrismaClient } = await import(
  resolve(scriptDir, "../dist/libs/shared/persistence/db.js")
);
const { createTosStorage, loadTosStorageConfig } = await import(
  resolve(scriptDir, "../dist/libs/shared/assets/tos-storage.js")
);

const APPLY = process.argv.includes("--apply");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  fail(
    "缺少 DATABASE_URL 环境变量。用法：DATABASE_URL=... node backend/scripts/backfill-asset-duration.mjs [--apply]",
  );
}
const config = loadTosStorageConfig();
if (!config) {
  fail("缺少 TOS 配置（VOLC_TOS_*）。");
}

console.log(
  `\n=== 存量音视频时长回填 — ${APPLY ? "APPLY（写库）" : "DRY-RUN（只读，不写库）"} ===\n`,
);

const prisma = getPrismaClient(process.env.DATABASE_URL);
const storage = createTosStorage(config);

const rows = await prisma.user_assets.findMany({
  where: {
    is_delete: false,
    type: { in: ["video", "audio"] },
    storage_key: { not: null },
    OR: [{ duration_ms: null }, { duration_ms: { lte: 0 } }],
  },
  select: { id: true, storage_key: true },
  orderBy: { id: "asc" },
});

let filled = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  const storageKey = row.storage_key;
  if (!storageKey) {
    skipped += 1;
    continue;
  }
  try {
    const info = await storage.probe(storageKey);
    if (info.durationMs === null || info.durationMs <= 0) {
      console.warn(`- asset=${row.id} 探测不到时长，跳过`);
      skipped += 1;
      continue;
    }
    console.log(
      `- asset=${row.id} duration_ms=${info.durationMs}` +
        (info.width === null ? "" : ` width=${info.width}`) +
        (info.height === null ? "" : ` height=${info.height}`),
    );
    if (APPLY) {
      await prisma.user_assets.update({
        where: { id: row.id },
        data: {
          duration_ms: info.durationMs,
          ...(info.width === null ? {} : { width: info.width }),
          ...(info.height === null ? {} : { height: info.height }),
          gmt_modified: new Date(),
          version: { increment: 1 },
        },
      });
    }
    filled += 1;
  } catch (error) {
    console.warn(
      `- asset=${row.id} 探测失败：${error instanceof Error ? error.message : String(error)}`,
    );
    failed += 1;
  }
}

console.log(
  `\n共 ${rows.length} 条：可回填 ${filled}，跳过 ${skipped}，失败 ${failed}` +
    (APPLY ? "（已写库）" : "（DRY-RUN，加 --apply 写库）"),
);

await prisma.$disconnect();
