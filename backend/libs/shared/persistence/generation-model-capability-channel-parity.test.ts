import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260926020000_generation_model_capability_channel/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/039_generation_model_capability_channel.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260926_generation_model_capability_channel.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

const TABLE = "generation_model_capability";
const COLUMN = "channel";

const CHANNELS = [
  "seedream-image",
  "gpt-image",
  "gpt-image-openai",
  "banana-image",
  "seedream-video",
  "seedream-audio",
  "seedream-text",
] as const;

function columnDefinition(sql: string, column: string): string {
  const m = sql.match(new RegExp("ADD COLUMN\\s+`" + column + "`([^;]*)"));
  expect(m).not.toBeNull();
  return m![1].replace(/\s+/g, " ").trim();
}

describe("generation_model_capability.channel 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 列是 VARCHAR(32) NULL —— 不是 NOT NULL", () => {
    const def = columnDefinition(standaloneSql, COLUMN);
    expect(def).toMatch(/VARCHAR\(32\) NULL/);
    expect(def).not.toMatch(/NOT NULL/i);
  });

  it("★ 只加这一列：一条 ALTER TABLE、一次 ADD COLUMN", () => {
    expect(standaloneSql.match(/ALTER TABLE/g) ?? []).toHaveLength(1);
    expect(standaloneSql.match(/ADD COLUMN/g) ?? []).toHaveLength(1);
    expect(standaloneSql).toContain("`" + TABLE + "`");
  });

  it("★★ 绝不含 DROP / MODIFY —— 兼容窗口的硬要求", () => {
    const stripped = standaloneSql.replace(/--[^\n]*/g, "");
    expect(stripped).not.toMatch(/\bDROP\b/i);
    expect(stripped).not.toMatch(/\bMODIFY\b/i);
    expect(stripped).not.toMatch(/CHANGE\s+COLUMN/i);
  });

  it("★ 回填覆盖全部渠道取值（枚举封闭性）", () => {
    for (const channel of CHANNELS) {
      expect(standaloneSql, `回填缺渠道「${channel}」`).toContain(`'${channel}'`);
    }
  });

  it("★ 回填不按 provider_id 过滤", () => {
    const updateStmt = standaloneSql.slice(standaloneSql.indexOf("UPDATE"));
    expect(updateStmt).not.toContain("provider_id");
  });

  it("schema.prisma 有该列（本迁移加的是可空列；041 之后收成必填）", () => {
    const model = schemaPrisma.slice(schemaPrisma.indexOf(`model ${TABLE} {`));
    const body = model.slice(0, model.indexOf("\n}"));
    expect(body).toMatch(new RegExp(`${COLUMN}\\s+String`));
    expect(standaloneSql).toContain("VARCHAR(32) NULL");
  });
});
