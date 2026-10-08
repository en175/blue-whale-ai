import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261008120000_ikk1t4_video_mode_keys/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/061_ikk1t4_video_mode_keys.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261008_ikk1t4_video_mode_keys.sql", import.meta.url),
  "utf8",
);
const seedSql = readFileSync(
  new URL("../../../prisma/schema/002_seed.sql", import.meta.url),
  "utf8",
);

const seedWithoutComments = seedSql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("IKK1T4 视频模式键域三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("退役键 prolong 不出现在迁移与种子里", () => {
    expect(migrationSql).not.toContain("prolong");
    expect(seedWithoutComments).not.toContain("'prolong'");
  });

  it("迁移写的是新模式名（三态拆分 + extend）", () => {
    expect(migrationSql).toContain("text2video");
    expect(migrationSql).toContain("omni");
    expect(migrationSql).toContain("image_reference");
    expect(migrationSql).toContain("extend");
  });

  it("种子两份视频行的键域已是新模式名", () => {
    expect(seedWithoutComments).toContain("'text2video'");
    expect(seedWithoutComments).toContain("'image_reference'");
    expect(seedWithoutComments).toContain("'extend'");
  });

  it("种子里 edit 的 allowed_durations 只能是 [-1]", () => {
    for (const hit of seedWithoutComments.matchAll(/allowed_durations[^\n]*/g)) {
      expect(hit[0]).toContain("-1");
      expect(hit[0].replace(/-1/g, "")).not.toMatch(/\d/);
    }
  });
});
