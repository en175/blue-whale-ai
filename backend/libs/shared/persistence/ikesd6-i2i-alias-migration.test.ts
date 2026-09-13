import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/022_ikesd6_i2i_model_alias_prompt_length.sql",
    import.meta.url,
  ),
  "utf8",
);
const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260910170000_ikesd6_i2i_model_alias_prompt_length/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("IKESD6 i2i 别名合并迁移（ADR-0085）", () => {
  it("双轨文件逐字一致", () => {
    expect(migrationSql).toBe(standaloneSql);
  });

  it("主行携带 i2i_model_name 与 max_prompt_length，且用 upsert 收敛漂移", () => {
    expect(standaloneSql).toContain("'i2i_model_name', 'gpt-image-2-edit'");
    expect(standaloneSql).toContain("'max_prompt_length', 32000");
    expect(standaloneSql).toContain("'i2i_model_name', 'nano-banana-2-i2i'");
    expect(standaloneSql).toContain("ON DUPLICATE KEY UPDATE");
    expect(standaloneSql).toContain("'gpt-image-2-text-to-image'");
    expect(standaloneSql).toContain("'nano-banana-2-t2i'");
  });

  it("被合并 / 退役的分裂行软删且不再 enabled", () => {
    expect(standaloneSql).toMatch(
      /SET enabled = FALSE, is_delete = TRUE[\s\S]*?gpt-image-2-edit[\s\S]*?nano-banana-2-i2i[\s\S]*?gpt-image-2-light-edit[\s\S]*?gpt-image-2-light-text-to-image/,
    );
  });
});
