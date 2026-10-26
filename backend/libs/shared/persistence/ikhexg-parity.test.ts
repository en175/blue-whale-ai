import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260921090000_ikhexg_reference_key_rename/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/029_ikhexg_reference_key_rename.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL(
    "../../../../docs/sql/20260921_ikhexg_reference_key_rename.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("IKHEXG 双轨迁移（参考上限键名统一）", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("旧键只在迁移里出现，且被搬到 image_reference_max", () => {
    expect(migrationSql).toContain("'$.image_reference_max'");
    expect(migrationSql).toContain("'$.max_reference_images'");
    expect(migrationSql).toContain("'$.maxReferenceImages'");
  });

  it("非音频行才搬值：行类型决定原本被读的那把键", () => {
    const statements = migrationSql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements.match(/`capability_type` <> 'audio'/g)).toHaveLength(2);
    const cleanup = statements.slice(statements.indexOf("JSON_REMOVE(`features`, '$.max_reference_images'"));
    expect(cleanup).not.toContain("capability_type");
  });

  it("三步齐备：snake 搬值、camel 搬值、残余一律删", () => {
    expect((migrationSql.match(/JSON_SET\(/g) ?? []).length).toBe(2);
    expect(migrationSql).toContain(
      "JSON_REMOVE(`features`, '$.max_reference_images', '$.maxReferenceImages')",
    );
  });

  it("搬值带守卫：只放行非负数，脏值留给第 3 步清理", () => {
    expect(migrationSql.match(/AS SIGNED\) >= 0/g)).toHaveLength(2);
    expect(migrationSql).toContain("IN ('INTEGER', 'DOUBLE', 'DECIMAL')");
  });

  it("不按 provider_id 过滤（线上存量行是 volcengine，非 seed 写的 new-api）", () => {
    expect(migrationSql).not.toMatch(/provider_id\s*=\s*'new-api'/);
  });

  it("pre-flight 列出两键同现且值不同的行（交人工复核）", () => {
    expect(migrationSql).toContain("JSON_CONTAINS_PATH(`features`, 'all'");
    expect(migrationSql).toContain("<> `features` ->> '$.image_reference_max'");
  });
});
