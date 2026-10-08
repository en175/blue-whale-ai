import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260927060000_soft_delete_legacy_topup_tiers/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/052_soft_delete_legacy_topup_tiers.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260927_soft_delete_legacy_topup_tiers.sql", import.meta.url),
  "utf8",
);

const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

describe("迁移 052 — 存量档位软删：三轨与形态", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（注释里有中文，charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 纯数据迁移：没有任何 DDL（结构变更必须各自成一条迁移）", () => {
    expect(sqlCode).not.toMatch(/\b(ALTER|CREATE|DROP)\b/i);
    expect(sqlCode).not.toMatch(/ADD COLUMN/i);
  });

  it("★ 是**软删**（UPDATE is_delete），不是物理删（DELETE FROM）", () => {
    expect(sqlCode).not.toMatch(/\bDELETE\b/i);
    expect(sqlCode.match(/UPDATE\s+`topup_tiers`/g) ?? []).toHaveLength(1);
    expect(standaloneSql).toMatch(/SET\s+`is_delete`\s*=\s*1/);
  });
});

describe("迁移 052 — 界定条件：删谁、不删谁", () => {
  it("★ 只删「配不出积分」的行：WHERE `base_credits` = 0", () => {
    expect(standaloneSql).toMatch(/`base_credits`\s*=\s*0/);
    expect(sqlCode).not.toMatch(/`base_credits`\s*>\s*0/);
  });

  it("★ 不按名字界定：可执行 SQL 里一个档位名都不出现", () => {
    for (const name of ["轻量尝鲜", "日常创作", "项目启动", "高频创作", "重度创作", "无忧创作"]) {
      expect(sqlCode, `可执行 SQL 里不该出现档位名 ${name}`).not.toContain(name);
    }
    expect(sqlCode).not.toMatch(/\bname\b/i);
  });

  it("★ 不依赖 id：可执行 SQL 里没有 id 硬编码", () => {
    expect(sqlCode).not.toMatch(/\bid\s*(=|IN\b)/i);
    expect(sqlCode).not.toMatch(/\b21\b/);
  });

  it("★ 只动 `is_delete` = 0 的行（已软删过的时间戳不许被刷成今天）", () => {
    expect(standaloneSql).toMatch(/`is_delete`\s*=\s*0/);
  });

  it("★ 只更新 `is_delete` 与 `gmt_modified` 两列，不碰价格/状态/积分", () => {
    const setClause = standaloneSql.match(/SET([\s\S]*?)WHERE/i)?.[1] ?? "";
    const columns = [...setClause.matchAll(/`(\w+)`\s*=/g)].map((m) => m[1]);
    expect(columns).toEqual(["is_delete", "gmt_modified"]);
  });

  it("前置校验与回读验证都写在迁移注释里（执行前人工确认要删几行）", () => {
    expect(standaloneSql).toContain("前置校验");
    expect(standaloneSql).toContain("will_soft_delete");
    expect(standaloneSql).toContain("回读验证");
  });
});
