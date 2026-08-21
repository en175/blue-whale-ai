import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260821000000_ika64p_template_tag_visible/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../schema/001_baseline.sql", import.meta.url),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../schema/009_ika64p_template_tag_visible.sql", import.meta.url),
  "utf8",
);

describe("IKA64P 增量迁移（标签可见性）", () => {
  it("migration 加 visible 列、隐藏旧五栏、seeding 新两栏", () => {
    expect(migrationSql).toContain(
      "ADD COLUMN `visible` TINYINT NOT NULL DEFAULT 1",
    );
    expect(migrationSql).toContain("SET `visible` = 0");
    expect(migrationSql).toContain("('video', '视频', 5, 1)");
    expect(migrationSql).toContain("('picture', '图片', 6, 1)");
  });

  it("baseline 必须同步：fresh 库 template_tag 含 visible 列与新 seed", () => {
    expect(baselineSql).toContain("`visible` TINYINT NOT NULL DEFAULT 1");
    expect(baselineSql).toContain("('marketing', '营销视频', 0, 0)");
    expect(baselineSql).toContain("('video', '视频', 5, 1)");
    expect(baselineSql).toContain("('picture', '图片', 6, 1)");
  });

  it("standalone schema/009 与 migration 的 DDL 一致", () => {
    expect(standaloneSql).toContain(
      "ADD COLUMN `visible` TINYINT NOT NULL DEFAULT 1",
    );
    expect(standaloneSql).toContain("('video', '视频', 5, 1)");
    expect(standaloneSql).toContain("('picture', '图片', 6, 1)");
  });
});
