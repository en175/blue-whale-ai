import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("视频模式时长策略三轨 SQL 一致并覆盖全部模式", () => {
  const sql = readFileSync(
    new URL("../../../prisma/schema/072_video_duration_strategy_normalize.sql", import.meta.url),
    "utf8",
  );
  expect(
    readFileSync(
      new URL(
        "../../../prisma/migrations/20261020140000_video_duration_strategy_normalize/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ).toBe(sql);
  expect(
    readFileSync(
      new URL("../../../../docs/sql/20261020_video_duration_strategy_normalize.sql", import.meta.url),
      "utf8",
    ),
  ).toBe(sql);
  expect(sql).toContain("SET NAMES utf8mb4");
  expect(sql).toContain("`capability_type` = 'video'");
  expect(sql).toContain("`is_delete` = 0");
  expect(sql).toContain("'$.task_types.edit.allowed_durations', JSON_ARRAY(-1)");
  expect(sql).toContain("'$.task_types.extend.allow_auto_duration', CAST('true' AS JSON)");
  for (const mode of ["text2video", "omni", "image_reference", "first_frame", "first_last_frame"]) {
    expect(sql).toContain(`$.task_types.${mode}.allowed_durations`);
    expect(sql).toContain(`$.task_types.${mode}.allow_auto_duration`);
    expect(sql).toContain(`$.taskTypes.${mode}.allowed_durations`);
    expect(sql).toContain(`$.taskTypes.${mode}.allow_auto_duration`);
  }
});
