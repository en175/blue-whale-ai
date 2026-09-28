import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// generation_model_capability 增列 pricing（该模型该能力的计价规则）。
// 镜像 recharge-orders-record-index-parity 的三轨核对结构。

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260925190000_generation_model_capability_pricing/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/038_generation_model_capability_pricing.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260925_generation_model_capability_pricing.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

const TABLE = "generation_model_capability";
const COLUMN = "pricing";

/** 取出 ADD COLUMN 那一列的定义（列名到分号前，空白压平后供逐项断言）。 */
function columnDefinition(sql: string, column: string): string {
  const m = sql.match(new RegExp("ADD COLUMN\\s+`" + column + "`([^;]*)"));
  expect(m).not.toBeNull();
  return m![1].replace(/\s+/g, " ").trim();
}

describe("generation_model_capability.pricing 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 列是 JSON NULL —— 不是 NOT NULL", () => {
    // 过渡期定价目录里那份仍在（billing 侧回落用），不是每个模型都已搬过来。
    // 写成 NOT NULL 会让尚未搬迁的模型全部写不进去 —— 也就没法分批搬。
    // 这是本迁移最容易被"顺手收紧"的一处，钉住。
    const def = columnDefinition(standaloneSql, COLUMN);
    expect(def).toMatch(/JSON NULL/);
    expect(def).not.toMatch(/NOT NULL/i);
  });

  it("★ 只动 pricing 一列：一条 ALTER TABLE、一次 ADD COLUMN", () => {
    // 这次迁移的全部内容就是加这一列。多出别的 ALTER / MODIFY / DROP
    // 意味着有人夹带了别的 schema 变更 —— 那些应当各自成一条迁移。
    expect(standaloneSql.match(/ALTER TABLE/g) ?? []).toHaveLength(1);
    expect(standaloneSql.match(/ADD COLUMN/g) ?? []).toHaveLength(1);
    expect(standaloneSql).toContain("`" + TABLE + "`");
  });

  it("列位置显式声明 AFTER request_mapping，且与 schema.prisma 字段顺序一致", () => {
    // 省略 AFTER 会追加到表尾，而 schema.prisma 里它排在 request_mapping 之后 ——
    // 两处顺序不一致不会报错、也不会红，但下一次 `prisma migrate` 会把它当成一次列重排。
    expect(columnDefinition(standaloneSql, COLUMN)).toContain("AFTER `request_mapping`");
    expect(schemaPrisma).toMatch(
      /request_mapping\s+Json\?[\s\S]*?pricing\s+Json\?[\s\S]*?enabled\s+Boolean/,
    );
  });

  it("COMMENT 写明「与定价目录逐字相同」与回落语义（不许只剩列名）", () => {
    // 这列的含义不是自明的：读的人要知道 JSON 形态对齐的是定价目录里哪一条，
    // 以及 NULL 是「还没搬」而不是「免费」。这段说明是给下一个读这列的人看的。
    const def = columnDefinition(standaloneSql, COLUMN);
    expect(def).toContain("COMMENT");
    expect(def).toContain("document.models.<model_id>.<capability_type>");
    expect(def).toContain("回落到定价目录");
  });

  it("Prisma 模型里 pricing 是 Json?（可空）且带 /// 说明它是什么", () => {
    // schema.prisma 少写 `?` → 下一次 migrate 会试图改回 NOT NULL；
    // 缺 /// 说明 → 这一列在 schema 侧又变成只有一个名字。
    expect(schemaPrisma).toMatch(/pricing\s+Json\?/);
    expect(schemaPrisma).toContain("该模型该能力的计价规则");
    expect(schemaPrisma).toContain("过渡期可为 NULL");
  });
});
