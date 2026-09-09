import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260909150000_ikeefv_drop_dangling_tables_and_columns/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/021_ikeefv_drop_dangling_tables_and_columns.sql",
    import.meta.url,
  ),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

// IKEEFV：删除 IKCKOW/IKD806 收尾遗留的 3 张悬空表（删除时全库 0 行、写路径已零调用）；
// agent_runs 仅瘦身存量实测全 NULL 的 3 个死列。镜像 ikckow-parity 的双轨核对结构。
const DROPPED_TABLES = [
  "conversation_message_mentions",
  "skill_summarize_session",
  "creative_skill_activation",
];
const DROPPED_COLUMNS = [
  "current_checkpoint_id",
  "confirmed_input_request_id",
  "skill_summarize",
];

describe("IKEEFV 双轨迁移（删 3 悬空表 + agent_runs 瘦身 3 死列）", () => {
  it.each(DROPPED_TABLES)("两轨都 DROP 悬空表 %s", (table) => {
    expect(migrationSql).toContain(`DROP TABLE IF EXISTS \`${table}\``);
    expect(standaloneSql).toContain(`DROP TABLE IF EXISTS \`${table}\``);
  });

  it.each(DROPPED_COLUMNS)("两轨都删 agent_runs 死列 %s", (column) => {
    expect(migrationSql).toContain(`DROP COLUMN \`${column}\``);
    expect(standaloneSql).toContain(`DROP COLUMN \`${column}\``);
  });

  it("standalone 含 SET NAMES utf8mb4（对齐 010/013 先例）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("两轨只删 3 个全空死列，不触碰 agent_runs 其余带历史值列", () => {
    for (const sql of [migrationSql, standaloneSql]) {
      const dropCount = sql.match(/DROP COLUMN/g)?.length ?? 0;
      expect(dropCount).toBe(DROPPED_COLUMNS.length);
    }
    // InUse 禁删保护 + run_pin scrub 的硬依赖列必须在保留侧。
    expect(baselineSql).toContain("`status` VARCHAR(32) NOT NULL");
    expect(baselineSql).toContain("`run_pin` JSON NULL");
  });

  it("baseline 不再建 3 张悬空表、agent_runs 列集合不含 3 死列", () => {
    for (const table of DROPPED_TABLES) {
      expect(baselineSql).not.toContain(`CREATE TABLE \`${table}\``);
    }
    const agentRunsBlock = baselineSql.match(
      /CREATE TABLE `agent_runs`[^;]*;/,
    )?.[0];
    expect(agentRunsBlock).toBeDefined();
    for (const column of DROPPED_COLUMNS) {
      expect(agentRunsBlock).not.toContain(`\`${column}\``);
    }
  });

  it("schema.prisma 同步：3 个 model 下线、agent_runs model 保留且无死列", () => {
    for (const table of DROPPED_TABLES) {
      expect(schemaPrisma).not.toContain(`model ${table} `);
    }
    expect(schemaPrisma).toContain("model agent_runs ");
    for (const column of DROPPED_COLUMNS) {
      expect(schemaPrisma).not.toContain(column);
    }
  });
});
