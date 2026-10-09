import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260916120000_ikg4ur_video_duration_single_source/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/026_ikg4ur_video_duration_single_source.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL(
    "../../../../docs/sql/20260916_ikg4ur_video_duration_single_source.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("IKG4UR 双轨迁移（视频时长收敛为单一来源）", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("移除全部五个任务类型的 allowed_durations（时长不再按任务类型枚举）", () => {
    for (const taskType of [
      "default",
      "first_frame",
      "first_last_frame",
      "edit",
      "prolong",
    ]) {
      expect(migrationSql).toContain(`'$.task_types.${taskType}.allowed_durations'`);
    }
  });

  it("数组→对象转换带守卫：长度、数值类型、非负、序关系、步长", () => {
    expect(migrationSql).toContain("JSON_LENGTH(`supported_durations`) >= 2");
    expect(migrationSql).toContain("CAST(`supported_durations` ->> '$[0]' AS SIGNED) >= 0");
    expect(migrationSql).toContain("CAST(`supported_durations` ->> '$[1]' AS SIGNED) >= 0");
    expect(migrationSql).toContain(
      "CAST(`supported_durations` ->> '$[0]' AS SIGNED) <= CAST(`supported_durations` ->> '$[1]' AS SIGNED)",
    );
    expect(migrationSql).toContain("CAST(`supported_durations` ->> '$[2]' AS SIGNED) > 0");
    expect(migrationSql).toContain("IN ('INTEGER', 'DOUBLE', 'DECIMAL')");
  });

  it("不按 provider_id 过滤（线上存量行是 volcengine，非 seed 写的 new-api）", () => {
    expect(migrationSql).not.toMatch(/provider_id\s*=\s*'new-api'/);
  });

  it("Seedance 2.0 核正为官方区间 4–15", () => {
    expect(migrationSql).toContain('{"min":4,"max":15,"step":1}');
  });

  it("音频置 NULL（上游 TTS 式接口无 duration，维持「非空 ⟺ 可配」不变式）", () => {
    expect(migrationSql).toContain("SET `supported_durations` = NULL");
    expect(migrationSql).toContain("`capability_type` = 'audio'");
  });
});
