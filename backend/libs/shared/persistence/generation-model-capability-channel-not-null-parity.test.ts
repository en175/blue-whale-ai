import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260926080000_generation_model_capability_channel_not_null/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/041_generation_model_capability_channel_not_null.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL(
    "../../../../docs/sql/20260926_generation_model_capability_channel_not_null.sql",
    import.meta.url,
  ),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

const EXECUTABLE = standaloneSql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("generation_model_capability.channel 收成 NOT NULL（三轨）", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 先补空值、再收紧 —— 顺序反了就是 `Invalid use of NULL value`", () => {
    expect(EXECUTABLE).toContain("UPDATE");
    expect(EXECUTABLE).toContain("`channel` IS NULL");
    expect(EXECUTABLE.indexOf("UPDATE")).toBeLessThan(EXECUTABLE.indexOf("MODIFY COLUMN"));
  });

  it("★ 补齐**不带** is_delete 过滤（软删行也要有值，否则约束加不上）", () => {
    const update = EXECUTABLE.slice(EXECUTABLE.indexOf("UPDATE"), EXECUTABLE.indexOf("MODIFY COLUMN"));
    expect(update).not.toContain("is_delete");
  });

  it("★ 补齐按媒介分（video 行不能补成图片渠道）", () => {
    for (const [type, channel] of [
      ["video", "seedream-video"],
      ["audio", "seedream-audio"],
      ["text", "seedream-text"],
    ] as const) {
      expect(EXECUTABLE).toMatch(new RegExp(`'${type}'\\s+THEN\\s+'${channel}'`));
    }
    expect(EXECUTABLE).toContain("ELSE 'seedream-image'");
  });

  it("★ 收紧的是 channel 这一列，且是 NOT NULL", () => {
    expect(EXECUTABLE.match(/MODIFY COLUMN/g) ?? []).toHaveLength(1);
    expect(EXECUTABLE).toMatch(/MODIFY COLUMN\s+`channel`\s+VARCHAR\(32\)\s+NOT NULL/);
    expect(EXECUTABLE).not.toMatch(/\bDROP\b/i);
  });

  it("schema.prisma 同口径（列必填、可空的老写法已消失）", () => {
    const model = schemaPrisma.slice(schemaPrisma.indexOf("model catalog_models {"));
    const body = model.slice(0, model.indexOf("\n}"));
    const fields = body
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("///"))
      .join("\n");
    expect(fields).toMatch(/channel\s+String\s+@db\.VarChar\(32\)/);
    expect(fields).not.toMatch(/channel\s+String\?/);
  });
});
