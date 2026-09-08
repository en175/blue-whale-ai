import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260804120000_ik67gz_provisional_stop_retry/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
  "utf8",
);

describe("IK67GZ incremental migration", () => {
  it("adds retry_count to agent_runs", () => {
    expect(migrationSql).toContain(
      "ADD COLUMN `retry_count` INTEGER NOT NULL DEFAULT 0 AFTER `failure_message`",
    );
  });

  it("creates the provisional delivery tables with independent identity and ordering", () => {
    expect(migrationSql).toContain("CREATE TABLE `agent_provisional_deliveries`");
    expect(migrationSql).toContain("CREATE TABLE `agent_provisional_chunks`");
    expect(migrationSql).toContain(
      "UNIQUE INDEX `uk_provisional_chunk`(`delivery_id`, `chunk_index`)",
    );
  });

  it("creates the provider call ledger keyed by (advance, slot)", () => {
    expect(migrationSql).toContain("CREATE TABLE `agent_provider_calls`");
    expect(migrationSql).toContain(
      "UNIQUE INDEX `uk_provider_call_slot`(`advance_id`, `call_slot`)",
    );
  });

  it("keeps the acceptance baseline in sync (fresh MySQL only loads baseline)", () => {
    expect(baselineSql).toContain("`retry_count` INTEGER NOT NULL DEFAULT 0");
    // IKCKOW：baseline 已删 6 张旧 Agent 表（含 provisional/provider），
    // fresh 库不再含其 CREATE —— 历史 migration 文件保留原样仅作升级链记录。
    expect(baselineSql).not.toContain("CREATE TABLE `agent_provisional_deliveries`");
    expect(baselineSql).not.toContain("CREATE TABLE `agent_provisional_chunks`");
    expect(baselineSql).not.toContain("CREATE TABLE `agent_provider_calls`");
  });
});
