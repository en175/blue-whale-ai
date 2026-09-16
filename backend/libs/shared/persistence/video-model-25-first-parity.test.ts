import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 视频模型目录置顶 Seedance 2.5：下拉顺序 = sort_order 升序，面板默认选中 = 列表
// 第一条（BottomDialog list[0]）。镜像 ikg4ur-parity 的双轨核对结构：prisma
// migration、schema 独立文件、docs/sql 快照三处同源，另钉种子基线同口径。

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260916150000_48ae4438_video_model_25_first/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/027_48ae4438_video_model_25_first.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260916_48ae4438_video_model_25_first.sql", import.meta.url),
  "utf8",
);
const seedSql = readFileSync(
  new URL("../../../prisma/schema/002_seed.sql", import.meta.url),
  "utf8",
);

/** 种子按 `),\n  (` 切行块后取指定模型的 sort_order（紧挨 channel_parser 前的数字）。 */
function seedSortOrder(modelId: string): number | undefined {
  const block = seedSql.split("),\n  (").find((part) => part.includes(`'${modelId}'`));
  const match = block?.match(/,\s*(\d+),\s*\n\s*'(?:seedream|gpt|banana)',/);
  return match ? Number(match[1]) : undefined;
}

describe("视频模型目录置顶 Seedance 2.5（双轨迁移 + 种子同口径）", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(migrationSql).toContain("SET NAMES utf8mb4");
  });

  it("只对 Seedance 2.5 基础行动 sort_order", () => {
    expect(migrationSql).toContain("'doubao-seedance-2-5-260628'");
    expect(migrationSql.match(/UPDATE `generation_model_capability`/g)).toHaveLength(1);
  });

  it("目标值取本环境视频目录最小值减 10，不写死（各环境存量值不同）", () => {
    expect(migrationSql).toContain("MIN(`sort_order`)");
    expect(migrationSql).toContain("`capability_type` = 'video'");
    // 视频目录只剩 2.5 一行时兜底，避免 NOT NULL 列吃 NULL 使迁移失败
    expect(migrationSql).toContain("COALESCE");
  });

  it("种子基线同口径：2.5 的 sort_order 小于 2.0", () => {
    const v25 = seedSortOrder("doubao-seedance-2-5-260628");
    const v20 = seedSortOrder("doubao-seedance-2-0-260128");
    expect(v25).toBeDefined();
    expect(v20).toBeDefined();
    expect(v25!).toBeLessThan(v20!);
  });
});
