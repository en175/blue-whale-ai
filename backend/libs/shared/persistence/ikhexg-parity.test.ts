import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// IKHEXG：能力行参考上限键名统一（`max_reference_images` 并入 `image_reference_max`）。
// 镜像 ikg4ur/ikfyhj-parity 的双轨核对结构：prisma migration、schema 独立文件、docs/sql 快照三处同源。

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
    // 旧键名在 SQL 里必然出现（它就是被搬走的对象）；关键是搬到哪、以及最终被删干净。
    expect(migrationSql).toContain("'$.image_reference_max'");
    expect(migrationSql).toContain("'$.max_reference_images'");
    expect(migrationSql).toContain("'$.maxReferenceImages'");
  });

  it("非音频行才搬值：行类型决定原本被读的那把键", () => {
    // 音频行读的是 image_reference_max，其上的 max_reference_images 是死值——
    // 搬过去会把死值扶正，正是本次要消除的失效模式。
    // 先剥注释：pre-flight 的示例查询里也含同样的谓词，数进来会误判。
    const statements = migrationSql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements.match(/`capability_type` <> 'audio'/g)).toHaveLength(2);
    // 第 3 步（删残余）不得按类型过滤——音频行与脏值行都要清。
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
    // 负值会被 CAST(... AS SIGNED) 原样带过，而读侧 pickNonNegativeInt 会把它降级为缺省，
    // 搬过去与删掉等价——不如不搬，由第 3 步统一清理。
    expect(migrationSql.match(/AS SIGNED\) >= 0/g)).toHaveLength(2);
    expect(migrationSql).toContain("IN ('INTEGER', 'DOUBLE', 'DECIMAL')");
  });

  it("不按 provider_id 过滤（线上存量行是 volcengine，非 seed 写的 new-api）", () => {
    // 加了该过滤会静默漏改真实行——IKG4UR 实测暴露过的坑，这里同样钉住。
    expect(migrationSql).not.toMatch(/provider_id\s*=\s*'new-api'/);
  });

  it("pre-flight 列出两键同现且值不同的行（交人工复核）", () => {
    expect(migrationSql).toContain("JSON_CONTAINS_PATH(`features`, 'all'");
    expect(migrationSql).toContain("<> `features` ->> '$.image_reference_max'");
  });
});
