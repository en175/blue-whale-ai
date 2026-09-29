import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 计划通道退役（20260929100000_retire_plan_tables）：`plan_messages` /
// `plan_application_receipts` 的写入方已随 IKCKOW / IKD806 删除，代码侧读取在本次一并拆掉。
// 本条守住三轨同源（仓库从 054 起的实践）与「model 不许长回来」，镜像
// ikfyhj-parity.test.ts 的 `user_info 退役` 块。

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260929100000_retire_plan_tables/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/057_retire_plan_tables.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260929_retire_plan_tables.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

const TRACKS = [migrationSql, standaloneSql, snapshotSql];

describe("计划通道退役（plan_messages / plan_application_receipts）", () => {
  it("三轨逐字同源", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("三轨都声明 SET NAMES utf8mb4（charset 回归保护）", () => {
    for (const sql of TRACKS) expect(sql).toContain("SET NAMES utf8mb4");
  });

  // ⚠️ MySQL 的 `--` 注释**要求后面跟空格**（或控制字符）。写成 `--（…`（中文全角括号紧跟）
  // 时 MySQL 不认它是注释，会把它当 SQL 解析并直接 1064 报错 —— 而**任何字符串比对类断言都
  // 抓不到**（三轨逐字相同、charset 也对）。这条是本文件唯一真正验证「SQL 语法能过」的守卫。
  // 上一次差点把带病迁移发出去：本地实跑才炸出来（`ERROR 1064 ... near '--（IKEEFV 的核实只覆盖'`）。
  it("注释语法合法：`--` 后必须跟空格（MySQL 注释规则）", () => {
    for (const sql of TRACKS) {
      const bad = sql
        .split("\n")
        .map((line, index) => `${index + 1}: ${line}`)
        .filter((entry) => /^--[^ \-\n]/.test(entry.replace(/^\d+: /, "")));
      expect(bad).toEqual([]);
    }
  });

  it("两列都放宽为 NULL-able（放宽是必需的：写入方已删，新行无值可填）", () => {
    for (const sql of TRACKS) {
      expect(sql).toContain("MODIFY COLUMN `plan_message_id` BIGINT NULL");
      expect(sql).toContain(
        "MODIFY COLUMN `application_receipt_id` BIGINT NULL",
      );
    }
  });

  // 「零行才删」的判据未核对前本迁移不删表；DROP 落在后续迁移。
  // 这条把「此刻故意没删」钉住，避免有人顺手补一句 DROP 绕过前置校验。
  it("本迁移不删表（DROP 待零行核对后另落）", () => {
    for (const sql of TRACKS) expect(sql).not.toContain("DROP TABLE");
  });

  it("schema.prisma 不再有这两个 model", () => {
    expect(schemaPrisma).not.toContain("model plan_messages");
    expect(schemaPrisma).not.toContain("model plan_application_receipts");
  });

  it("schema.prisma 的两列已放宽为可空（与迁移一致）", () => {
    const model = schemaPrisma.match(
      /model scene_card_generation_records \{[^}]*\}/,
    )?.[0];
    expect(model).toBeDefined();
    expect(model).toMatch(/plan_message_id\s+BigInt\?/);
    expect(model).toMatch(/application_receipt_id\s+BigInt\?/);
  });
});
