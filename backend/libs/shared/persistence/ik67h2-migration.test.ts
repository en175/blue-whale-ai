import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260804163000_ik67h2_atomic_mentions/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
describe("IK67H2 incremental migration", () => {
  it("creates immutable ordered mention facts and the minimal SceneCard resource", () => {
    // 迁移 SQL 是本增量新增的权威；baseline 是前置基础快照，不含本增量表。
    expect(migrationSql).toContain("CREATE TABLE `conversation_message_mentions`");
    expect(migrationSql).toContain("CREATE TABLE `scene_cards`");
    expect(migrationSql).toContain(
      "UNIQUE INDEX `uk_message_mention_sequence`(`message_id`, `mention_seq`)",
    );
    expect(migrationSql).toContain(
      "INDEX `idx_mention_target`(`mention_type`, `target_id`)",
    );
    expect(migrationSql).toContain("`snapshot` JSON NOT NULL");
  });
});
