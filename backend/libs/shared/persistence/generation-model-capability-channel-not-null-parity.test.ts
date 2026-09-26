import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// generation_model_capability.channel 收成 NOT NULL（三轨迁移）。
//
// 这一版把「渠道」从**过渡期的可空列**收紧成每一行的身份。它存在的意义就是把下面这条
// 不变量落到类型上：**一行能力数据不可能没有渠道**。

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

/** 只看可执行部分——注释里**故意**留着旧口径的说明。 */
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
    // 实测踩过：039 的回填带了 `is_delete = 0`，软删行留成空；NOT NULL 是**表级**约束，
    // 不补软删行就加不上（报错在迁移跑到一半时出现，正是最难收拾的一种失败）。
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
    // 兜底给图片（其余类型都在上面显式列了）
    expect(EXECUTABLE).toContain("ELSE 'seedream-image'");
  });

  it("★ 收紧的是 channel 这一列，且是 NOT NULL", () => {
    expect(EXECUTABLE.match(/MODIFY COLUMN/g) ?? []).toHaveLength(1);
    expect(EXECUTABLE).toMatch(/MODIFY COLUMN\s+`channel`\s+VARCHAR\(32\)\s+NOT NULL/);
    // 一列都没删：本迁移只收紧，不清理
    expect(EXECUTABLE).not.toMatch(/\bDROP\b/i);
  });

  it("schema.prisma 同口径（列必填、可空的老写法已消失）", () => {
    const model = schemaPrisma.slice(schemaPrisma.indexOf("model generation_model_capability {"));
    const body = model.slice(0, model.indexOf("\n}"));
    const fields = body
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("///"))
      .join("\n");
    expect(fields).toMatch(/channel\s+String\s+@db\.VarChar\(32\)/);
    expect(fields).not.toMatch(/channel\s+String\?/);
  });
});
