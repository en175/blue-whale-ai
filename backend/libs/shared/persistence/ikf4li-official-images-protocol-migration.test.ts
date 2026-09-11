import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/023_ikf4li_official_openai_images_protocol.sql",
    import.meta.url,
  ),
  "utf8",
);
const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260911120000_ikf4li_official_openai_images_protocol/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("IKF4LI 官方 OpenAI Images 协议迁移（契约 §12）", () => {
  it("双轨文件逐字一致", () => {
    expect(migrationSql).toBe(standaloneSql);
  });

  it("主行迁回干净名 gpt-image-2 并声明 openai-images，不再写 i2i 别名", () => {
    expect(standaloneSql).toContain("'new-api', 'gpt-image-2', 'image', 'GPT Image 2'");
    expect(standaloneSql).toContain("'image_protocol', 'openai-images'");
    expect(standaloneSql).toContain("'max_prompt_length', 32000");
    // 别名机制只留给 banana；gpt-image-2 主行不得再写 i2i_model_name
    expect(standaloneSql).not.toContain("'i2i_model_name',");
    // 该行 015 创建后停用未删，占着唯一键干净名 → 必须 UPSERT 并显式复活
    expect(standaloneSql).toContain("ON DUPLICATE KEY UPDATE");
    expect(standaloneSql).toContain("is_delete = FALSE");
  });

  it("漂移名主行 gpt-image-2-text-to-image 软删", () => {
    expect(standaloneSql).toMatch(
      /SET enabled = FALSE, is_delete = TRUE[\s\S]*?'gpt-image-2-text-to-image'/,
    );
  });

  it("banana 行显式声明 inline-image（不靠 worker 缺省值，读代码不必记默认）", () => {
    expect(standaloneSql).toContain("'$.image_protocol', 'inline-image'");
    expect(standaloneSql).toContain("'nano-banana-2-t2i'");
  });

  it("soft-delete 语句带 is_delete = FALSE 守卫（幂等，不重复累加 version）", () => {
    expect(standaloneSql).toMatch(
      /model_id = 'gpt-image-2-text-to-image'\s+AND is_delete = FALSE/,
    );
  });
});
