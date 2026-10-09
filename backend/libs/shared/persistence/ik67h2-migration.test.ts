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
