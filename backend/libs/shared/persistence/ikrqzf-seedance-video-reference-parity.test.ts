import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261030160000_ikrqzf_seedance_2_0_fast_mini_video_reference/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/076_ikrqzf_seedance_2_0_fast_mini_video_reference.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL(
    "../../../../docs/sql/20261030_ikrqzf_seedance_2_0_fast_mini_video_reference.sql",
    import.meta.url,
  ),
  "utf8",
);
const seedSql = readFileSync(
  new URL("../../../prisma/schema/002_seed.sql", import.meta.url),
  "utf8",
);

describe("IKRQZF Seedance 2.0 Fast/Mini 参考视频能力迁移：三轨", () => {
  it("三轨逐字一致", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4，且不写注释", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
    expect(standaloneSql).not.toMatch(/^\s*--/m);
  });

  it("两个模型同时修正，且写入 JSON 布尔 true", () => {
    expect(standaloneSql).toContain("'doubao-seedance-2-0-fast-260128'");
    expect(standaloneSql).toContain("'doubao-seedance-2-0-mini-260615'");
    expect(standaloneSql).toContain("CAST('true' AS JSON)");
    expect(standaloneSql).toContain("'$.video_reference_max', 3");
    expect(standaloneSql).toContain("'$.audio_reference', CAST('true' AS JSON)");
    expect(standaloneSql).toContain("'$.audio_reference_max', 3");
    expect(standaloneSql).toContain("`version` = `version` + 1");
  });

  it("种子同步标准 2.0 行，不再出现参考视频与参考音频关闭", () => {
    expect(seedSql).not.toContain("'video_reference', FALSE");
    expect(seedSql).not.toContain("'audio_reference', FALSE");
  });
});
