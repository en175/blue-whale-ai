import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("IKLUVP 三轨 SQL 一致且仅更新目标模型延长模式", () => {
  const sql = readFileSync(new URL("../../../prisma/schema/065_ikluvp_extend_auto_duration.sql", import.meta.url), "utf8");
  expect(readFileSync(new URL("../../../prisma/migrations/20261015160000_ikluvp_extend_auto_duration/migration.sql", import.meta.url), "utf8")).toBe(sql);
  expect(readFileSync(new URL("../../../../docs/sql/20261015_ikluvp_extend_auto_duration.sql", import.meta.url), "utf8")).toBe(sql);
  expect(sql).toContain("SET NAMES utf8mb4");
  expect(sql).toContain("`model_id` = 'doubao-seedance-2-5-260628'");
  expect(sql).toContain("`capability_type` = 'video'");
  expect(sql).toContain("`is_delete` = 0");
  expect(sql).toContain("'$.task_types.extend.allow_auto_duration', CAST('true' AS JSON)");
  expect(sql).not.toContain("allowed_durations");
  expect(sql).not.toContain("supported_durations");
});
