import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260807160000_ik764f_template_tag/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../schema/001_baseline.sql", import.meta.url),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../schema/007_ik764f_template_tag.sql", import.meta.url),
  "utf8",
);

describe("IK764F incremental migration", () => {
  it("creates template_tag with fixed tag_code uniqueness", () => {
    expect(migrationSql).toContain("CREATE TABLE `template_tag`");
    expect(migrationSql).toContain("`tag_code` VARCHAR(64) NOT NULL");
    expect(migrationSql).toContain("`label` VARCHAR(128) NOT NULL");
    expect(migrationSql).toContain("UNIQUE INDEX `uk_tag_code`(`tag_code`)");
  });

  it("baseline 必须同步：fresh-MySQL 只加载 baseline，缺表会让管理后台全线 500", () => {
    expect(baselineSql).toContain("CREATE TABLE `template_tag`");
    expect(baselineSql).toContain("UNIQUE INDEX `uk_tag_code`(`tag_code`)");
  });

  it("seed 与兜底枚举一致（5 行，marketing 为首）", () => {
    for (const [code, label] of [
      ["marketing", "营销视频"],
      ["short", "微短片"],
      ["replicate", "视频复刻"],
      ["social", "社媒视频"],
      ["image", "图片设计"],
    ]) {
      expect(migrationSql).toContain(`('${code}', '${label}'`);
      expect(baselineSql).toContain(`('${code}', '${label}'`);
    }
  });

  it("standalone schema/007 与 migration 的 DDL 一致", () => {
    expect(standaloneSql).toContain("CREATE TABLE `template_tag`");
    expect(standaloneSql).toContain("UNIQUE INDEX `uk_tag_code`(`tag_code`)");
    expect(standaloneSql).toContain("('marketing', '营销视频', 0)");
  });
});
