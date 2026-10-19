import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261019140000_ikosts_seedance_2_0_dead_multiplier/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/068_ikosts_seedance_2_0_dead_multiplier.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261019_ikosts_seedance_2_0_dead_multiplier.sql", import.meta.url),
  "utf8",
);

const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

const MODELS = [
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
  "doubao-seedance-2-0-mini-260615",
] as const;

const updates = sqlCode
  .split(/;\s*\n/)
  .map((block) => block.trim())
  .filter((block) => /^UPDATE `generation_model_capability`/.test(block));

describe("IKOSTS Seedance 2.0 编辑死配置清理：三轨", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4，且不写注释", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
    expect(standaloneSql).not.toMatch(/^\s*--/m);
  });

  it("★ 是纯数据迁移：没有任何 DDL 或破坏性 DML", () => {
    expect(sqlCode).not.toMatch(/\b(ALTER|CREATE|DROP)\b/i);
    expect(sqlCode).not.toMatch(/\b(DELETE|INSERT|TRUNCATE)\b/i);
    expect(sqlCode).not.toMatch(/ADD COLUMN/i);
  });

  it("★ 三条 UPDATE：2.0 / 2.0-fast / 2.0-mini，全部带守卫与 version", () => {
    expect(updates).toHaveLength(3);
    for (const model of MODELS) {
      const blocks = updates.filter((block) => block.includes(`\`model_id\` = '${model}'`));
      expect(blocks, `${model} 应当恰好一条 UPDATE`).toHaveLength(1);
      const block = blocks[0]!;
      expect(block).toContain("`capability_type` = 'video'");
      expect(block).toContain("`is_delete` = 0");
      expect(block).toContain("JSON_TYPE(`pricing`) = 'OBJECT'");
      expect(block).toContain("`version` = `version` + 1");
      expect(block).toMatch(
        /WHEN JSON_LENGTH\(`pricing`, '\$\.multipliers'\) = 1\s+THEN JSON_REMOVE\(`pricing`, '\$\.multipliers'\)\s+ELSE JSON_REMOVE\(`pricing`, '\$\.multipliers\."usage\.videoEdit"'\)/,
      );
      expect(block).not.toMatch(/\bOR\b/i);
      expect(block).toContain("JSON_LENGTH(`pricing`, '$.multipliers') = 1");
      expect(block).toContain(
        `JSON_CONTAINS_PATH(\`pricing\`, 'one', '$.multipliers."usage.videoEdit"')`,
      );
      expect(block).toContain("JSON_REMOVE(`pricing`, '$.multipliers')");
      expect(block).toContain(`JSON_REMOVE(\`pricing\`, '$.multipliers."usage.videoEdit"')`);
    }
    expect(sqlCode).toContain("START TRANSACTION");
    expect(sqlCode).toContain("COMMIT");
  });

  it("★ 不碰 2.5，也不回写 20000", () => {
    expect(sqlCode).not.toContain("doubao-seedance-2-5-260628");
    expect(sqlCode).not.toContain("20000");
  });
});
