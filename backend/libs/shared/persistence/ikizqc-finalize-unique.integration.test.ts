// IKIZQC（金标 G05/G08）：generation_jobs 成片来源唯一约束的真 MySQL 并发验证。
//
// 与 tz-caliber.integration.test.ts 同款门控：需要本地 MySQL（如 Docker 暴露的 3307）：
//   IKIZQC_DATABASE_URL='mysql://root:<pw>@127.0.0.1:3307/ikizqc_probe' \
//     pnpm exec vitest run backend/libs/shared/persistence/ikizqc-finalize-unique.integration.test.ts
// 未配置该变量时整组跳过；跳过不算通过。Worker 侧同款断言见
// GenerationJobsFinalizeSourceUniqueMySqlIntegrationTest（Testcontainers）。
//
// 断言（数据库级）：
//   1. 并发插入同一 source_sample_job_id → 恰一行成功（真实链路 = 至多一条成片任务与
//      一笔预扣——Hold 发生在行插入之后，输家根本走不到）；
//   2. source 为 NULL 的行不受唯一索引影响（MySQL 不去重 NULL）；
//   3. 失败占位行保留 → 其后再次插入仍被拒（首版不复用同 Draft ID 重试）。

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPoolConfig } from "./db.js";

const databaseUrl = process.env.IKIZQC_DATABASE_URL;
const TABLE = "ikizqc_finalize_jobs_probe";

describe.skipIf(!databaseUrl)("成片来源唯一约束真库并发（IKIZQC G05/G08）", () => {
  let adapter: Awaited<ReturnType<PrismaMariaDb["connect"]>>;
  let raw: Pool;

  beforeAll(async () => {
    adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    // 与迁移 20260929130000 完全同款的一列唯一索引（probe 表只留相关列）。
    await adapter.executeRaw({ sql: `DROP TABLE IF EXISTS ${TABLE}`, args: [], argTypes: [] });
    await adapter.executeRaw({
      sql: `CREATE TABLE ${TABLE} (
              id BIGINT NOT NULL AUTO_INCREMENT,
              video_stage VARCHAR(16) NULL,
              source_sample_job_id BIGINT NULL,
              charge_state VARCHAR(16) NULL,
              PRIMARY KEY (id),
              UNIQUE KEY uk_generation_jobs__source_sample_job_id (source_sample_job_id)
            ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      args: [],
      argTypes: [],
    });
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeRaw({ sql: `DROP TABLE IF EXISTS ${TABLE}`, args: [], argTypes: [] });
    await adapter.dispose();
  });

  it("★ G05: 两页并发（6 路同键 INSERT）→ 恰一条成片任务行落库", async () => {
    const contenders = 6;
    const barrier = new Array<() => void>();
    const gates = new Array<Promise<void>>();
    for (let i = 0; i < contenders; i += 1) {
      let release!: () => void;
      gates.push(new Promise<void>((resolve) => {
        release = resolve;
      }));
      barrier.push(release);
    }
    const attempts = Promise.all(
      Array.from({ length: contenders }, (_, i) =>
        (async () => {
          await gates[i];
          try {
            await adapter.executeRaw({
              sql: `INSERT INTO ${TABLE} (video_stage, source_sample_job_id, charge_state)
                    VALUES ('final', 302, 'held')`,
              args: [],
              argTypes: [],
            });
            return "won" as const;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/UniqueConstraintViolation|Duplicate entry/.test(message)) return "lost" as const;
            throw error;
          }
        })(),
      ),
    );
    for (const release of barrier) release();
    const outcomes = await attempts;

    expect(outcomes.filter((o) => o === "won")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "lost")).toHaveLength(contenders - 1);

    const rows = (await raw.query(
      `SELECT COUNT(*) AS c FROM ${TABLE} WHERE source_sample_job_id = 302`,
    )) as Array<{ c: number }>;
    expect(Number(rows[0]!.c)).toBe(1);
  });

  it("★ G12 回归: source 为 NULL 的普通/样片行不受唯一索引影响", async () => {
    for (const stage of [null, "sample", "sample"]) {
      await adapter.executeRaw({
        sql: `INSERT INTO ${TABLE} (video_stage, source_sample_job_id, charge_state)
              VALUES (?, NULL, 'held')`,
        args: [stage],
        argTypes: [{ scalarType: "string", dbType: "VARCHAR", arity: "scalar" }],
      });
    }
    const rows = (await raw.query(
      `SELECT COUNT(*) AS c FROM ${TABLE} WHERE source_sample_job_id IS NULL`,
    )) as Array<{ c: number }>;
    expect(Number(rows[0]!.c)).toBe(3);
  });

  it("★ G08: 失败占位行（released）保留 → 其后再次提交同 source 仍被拒", async () => {
    await adapter.executeRaw({
      sql: `INSERT INTO ${TABLE} (video_stage, source_sample_job_id, charge_state)
            VALUES ('final', 303, 'released')`,
      args: [],
      argTypes: [],
    });
    await expect(
      adapter.executeRaw({
        sql: `INSERT INTO ${TABLE} (video_stage, source_sample_job_id, charge_state)
              VALUES ('final', 303, 'held')`,
        args: [],
        argTypes: [],
      }),
    ).rejects.toThrow(/UniqueConstraintViolation|Duplicate entry/);
  });
});
