import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260925190000_generation_model_capability_pricing/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/038_generation_model_capability_pricing.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260925_generation_model_capability_pricing.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

const TABLE = "generation_model_capability";
const COLUMN = "pricing";

function columnDefinition(sql: string, column: string): string {
  const m = sql.match(new RegExp("ADD COLUMN\\s+`" + column + "`([^;]*)"));
  expect(m).not.toBeNull();
  return m![1].replace(/\s+/g, " ").trim();
}

describe("generation_model_capability.pricing 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 列是 JSON NULL —— 不是 NOT NULL", () => {
    const def = columnDefinition(standaloneSql, COLUMN);
    expect(def).toMatch(/JSON NULL/);
    expect(def).not.toMatch(/NOT NULL/i);
  });

  it("★ 只动 pricing 一列：一条 ALTER TABLE、一次 ADD COLUMN", () => {
    expect(standaloneSql.match(/ALTER TABLE/g) ?? []).toHaveLength(1);
    expect(standaloneSql.match(/ADD COLUMN/g) ?? []).toHaveLength(1);
    expect(standaloneSql).toContain("`" + TABLE + "`");
  });

  it("列位置显式声明 AFTER request_mapping，且与 schema.prisma 字段顺序一致", () => {
    expect(columnDefinition(standaloneSql, COLUMN)).toContain("AFTER `request_mapping`");
    expect(schemaPrisma).toMatch(
      /request_mapping\s+Json\?[\s\S]*?pricing\s+Json\?[\s\S]*?enabled\s+Boolean/,
    );
  });

  it("COMMENT 写明「与定价目录逐字相同」与回落语义（不许只剩列名）", () => {
    const def = columnDefinition(standaloneSql, COLUMN);
    expect(def).toContain("COMMENT");
    expect(def).toContain("document.models.<model_id>.<capability_type>");
    expect(def).toContain("回落到定价目录");
  });

  it("Prisma 模型里 pricing 是 Json?（可空）且带 /// 说明它是什么", () => {
    expect(schemaPrisma).toMatch(/pricing\s+Json\?/);
    expect(schemaPrisma).toContain("该模型该能力的计价规则");
    expect(schemaPrisma).toContain("过渡期可为 NULL");
  });
});
