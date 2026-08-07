import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260804080000_ik67gy_plan_phase_alignment/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("IK67GY incremental migration", () => {
  it("replaces the per-run single Advance uniqueness with (run, ordinal)", () => {
    expect(migrationSql).toContain(
      "DROP INDEX `uk_agent_advance_run` ON `agent_advances`",
    );
    expect(migrationSql).toContain(
      "CREATE UNIQUE INDEX `uk_agent_advance_run_ordinal` ON `agent_advances`(`agent_run_id`, `ordinal`)",
    );
  });

  it("drops the single-resume uniqueness so one Run can answer several clarifications", () => {
    expect(migrationSql).toContain(
      "DROP INDEX `uk_input_request_resumed_run` ON `user_input_requests`",
    );
  });
});
