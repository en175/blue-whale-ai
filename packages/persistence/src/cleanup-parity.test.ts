import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260831000000_cleanup_dead_tables_and_columns/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../schema/001_baseline.sql", import.meta.url),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../schema/010_cleanup_dead_tables_and_columns.sql", import.meta.url),
  "utf8",
);
// 007(ik764f) 是 010 D4 改名链的上游：必须保持 create_time/update_time 历史形态，
// 否则升级链上 CHANGE COLUMN 会因列不存在而失败。
const legacy007Sql = readFileSync(
  new URL("../schema/007_ik764f_template_tag.sql", import.meta.url),
  "utf8",
);

// 007(ik764f) 的历史契约：它以 create_time/update_time 建表，010 的 D4 再改名。
// 故 007 保持历史原样、不可改为 gmt_* —— 否则升级链上 010 的 CHANGE 会因列不存在而失败。
describe("CLEANUP 双轨迁移（死表/残留列/漂移/模板冗余）", () => {
  const A_COLUMNS = [
    "`display_name`",
    "`group`",
    "`aff_history`",
    "`last_login_at`",
  ];

  it.each(A_COLUMNS)("A 层：两轨都 DROP users 残留列 %s", (col) => {
    expect(migrationSql).toContain(`DROP COLUMN ${col}`);
    expect(standaloneSql).toContain(`DROP COLUMN ${col}`);
  });

  it("B 层：两轨都 DROP 三张死表", () => {
    for (const table of ["api_key_usage", "api_key", "captcha_challenges"]) {
      expect(migrationSql).toContain(`DROP TABLE IF EXISTS \`${table}\``);
      expect(standaloneSql).toContain(`DROP TABLE IF EXISTS \`${table}\``);
    }
  });

  it("C1 层：status 先归一 NULL → 改 varchar(30) → 仅归一 0/1（不覆盖未知值）", () => {
    const orderOk =
      standaloneSql.indexOf("SET `status` = 0 WHERE `status` IS NULL") <
      standaloneSql.indexOf("MODIFY COLUMN `status` VARCHAR(30)") &&
      standaloneSql.indexOf("MODIFY COLUMN `status` VARCHAR(30)") <
        standaloneSql.indexOf("WHERE `status` IN ('0', '1')");
    expect(orderOk).toBe(true);
    expect(migrationSql).toContain(
      "ALTER TABLE `users` MODIFY COLUMN `status` VARCHAR(30) NOT NULL DEFAULT 'NORMAL'",
    );
    expect(standaloneSql).toContain(
      "ALTER TABLE `users` MODIFY COLUMN `status` VARCHAR(30) NOT NULL DEFAULT 'NORMAL'",
    );
    expect(migrationSql).toContain("WHERE `status` IN ('0', '1')");
    expect(standaloneSql).toContain("WHERE `status` IN ('0', '1')");
    // 兜底：绝不允许无条件的全表覆盖
    expect(standaloneSql).not.toContain("SET `status` = 'NORMAL';");
  });

  it("C2/C3 层：username varchar(50)、password varchar(63) 双轨一致", () => {
    expect(migrationSql).toContain(
      "ALTER TABLE `users` MODIFY COLUMN `username` VARCHAR(50) NOT NULL",
    );
    expect(standaloneSql).toContain(
      "ALTER TABLE `users` MODIFY COLUMN `username` VARCHAR(50) NOT NULL",
    );
    expect(migrationSql).toContain(
      "ALTER TABLE `users` MODIFY COLUMN `password` VARCHAR(63) NULL",
    );
    expect(standaloneSql).toContain(
      "ALTER TABLE `users` MODIFY COLUMN `password` VARCHAR(63) NULL",
    );
  });

  it("D 层：template 冗余列删除 + template_tag 时间列改名，双轨一致", () => {
    // D2/D3：三张模板表共用同一组 DROP
    for (const sql of [migrationSql, standaloneSql]) {
      expect(sql).toContain("DROP COLUMN `deleted`,");
      expect(sql).toContain("DROP COLUMN `create_time`,");
      expect(sql).toContain("DROP COLUMN `update_time`,");
    }
    // D4：与 007 的历史 create_time/update_time 对齐
    expect(migrationSql).toContain("CHANGE COLUMN `create_time` `gmt_create`");
    expect(standaloneSql).toContain("CHANGE COLUMN `create_time` `gmt_create`");
    expect(migrationSql).toContain("CHANGE COLUMN `update_time` `gmt_modified`");
    expect(standaloneSql).toContain("CHANGE COLUMN `update_time` `gmt_modified`");
    // 007 保持历史 create_time/update_time（010 的改名链上游），不可误改为 gmt_*
    expect(legacy007Sql).toContain("`create_time` DATETIME(0)");
    expect(legacy007Sql).toContain("`update_time` DATETIME(0)");
    expect(legacy007Sql).not.toContain("gmt_create");
  });

  it("baseline 必须同步：fresh 库无死表、template 用 gmt_*、users 无残留列", () => {
    for (const table of ["api_key", "api_key_usage", "captcha_challenges"]) {
      expect(baselineSql).not.toContain(`CREATE TABLE \`${table}\``);
    }
    expect(baselineSql).toContain("`gmt_create` DATETIME(0) NOT NULL");
    expect(baselineSql).toContain("`gmt_modified` DATETIME(0) NOT NULL");
    expect(baselineSql).not.toContain("`create_time`");
    expect(baselineSql).not.toContain("DROP COLUMN `display_name`");
    expect(baselineSql).toContain(
      "`status` VARCHAR(30) NOT NULL DEFAULT 'NORMAL'",
    );
  });
});
