import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const columnsMigrationSql = readFileSync(
  new URL("../../../prisma/migrations/20261028180000_ikqy3h_node_owner_columns/migration.sql", import.meta.url),
  "utf8",
);
const columnsStandaloneSql = readFileSync(
  new URL("../../../prisma/schema/082_ikqy3h_node_owner_columns.sql", import.meta.url),
  "utf8",
);
const columnsSnapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261028_ikqy3h_node_owner_columns.sql", import.meta.url),
  "utf8",
);
const dropMigrationSql = readFileSync(
  new URL("../../../prisma/migrations/20261028183000_ikqy3h_move_remaining_owners_and_drop/migration.sql", import.meta.url),
  "utf8",
);
const dropStandaloneSql = readFileSync(
  new URL("../../../prisma/schema/083_ikqy3h_move_remaining_owners_and_drop.sql", import.meta.url),
  "utf8",
);
const dropSnapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261028_ikqy3h_move_remaining_owners_and_drop.sql", import.meta.url),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const javaSchemaSql = readFileSync(
  new URL(
    "../../../../server/blue-whale-worker/src/test/resources/db/bluewhale-schema.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("IKQY3H 三轨迁移（归属三列并入 project_nodes）", () => {
  it("两步迁移三处 SQL 逐字一致", () => {
    expect(columnsStandaloneSql).toBe(columnsMigrationSql);
    expect(columnsSnapshotSql).toBe(columnsMigrationSql);
    expect(dropStandaloneSql).toBe(dropMigrationSql);
    expect(dropSnapshotSql).toBe(dropMigrationSql);
  });

  it("082 加列并搬运已落行节点的归属", () => {
    expect(columnsMigrationSql).toContain("ADD COLUMN `owner_submission_id` BIGINT NULL");
    expect(columnsMigrationSql).toContain("ADD COLUMN `owner_output_key` VARCHAR(128) NULL");
    expect(columnsMigrationSql).toContain("ADD COLUMN `owner_binding_revision` INT NOT NULL DEFAULT 0");
    expect(columnsMigrationSql).toContain("JOIN `generation_canvas_node_owners` `o`");
    expect(columnsMigrationSql).not.toContain("DROP TABLE");
  });

  it("083 补搬剩余归属、保留已删节点占位行并删表", () => {
    expect(dropMigrationSql).toContain("JOIN `generation_canvas_node_owners` `o`");
    expect(dropMigrationSql).toContain("LEFT JOIN `project_nodes` `n`");
    expect(dropMigrationSql).toContain("DROP TABLE IF EXISTS `generation_canvas_node_owners`");
  });

  it("Prisma 模型与 Java 测试 schema 同步", () => {
    expect(schemaPrisma).not.toContain("model generation_canvas_node_owners {");
    expect(schemaPrisma).toContain("owner_binding_revision Int     @default(0)");
    expect(javaSchemaSql).not.toContain("CREATE TABLE `generation_canvas_node_owners`");
    expect(javaSchemaSql).toContain("`owner_binding_revision` INT          NOT NULL DEFAULT 0");
  });

  it("001_baseline.sql 保持时间点快照", () => {
    expect(baselineSql).not.toContain("DROP TABLE IF EXISTS `generation_canvas_node_owners`");
  });
});
