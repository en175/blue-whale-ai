import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// generation_model_capability 增列 channel（这个模型走哪个渠道）。
// 镜像 generation-model-capability-pricing-parity 的三轨核对结构，外加两条本迁移独有的守卫。

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260926020000_generation_model_capability_channel/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/039_generation_model_capability_channel.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260926_generation_model_capability_channel.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

const TABLE = "generation_model_capability";
const COLUMN = "channel";

/** 渠道的封闭枚举。加渠道时**这里必须同改** —— 漏了就等于加了个没人认得的取值。 */
const CHANNELS = [
  "seedream-image",
  "gpt-image",
  "gpt-image-openai",
  "banana-image",
  "seedream-video",
  "seedream-audio",
  "seedream-text",
] as const;

/** 取出 ADD COLUMN 那一列的定义（列名到分号前，空白压平后供逐项断言）。 */
function columnDefinition(sql: string, column: string): string {
  const m = sql.match(new RegExp("ADD COLUMN\\s+`" + column + "`([^;]*)"));
  expect(m).not.toBeNull();
  return m![1].replace(/\s+/g, " ").trim();
}

describe("generation_model_capability.channel 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 列是 VARCHAR(32) NULL —— 不是 NOT NULL", () => {
    // 本迁移只加列 + 回填，回填不到的行留 NULL。现在就 NOT NULL 会让尚未盘点到的存量写不进去；
    // 收紧要等旧字段真正退场之后单独一版。这是最容易被"顺手收紧"的一处，钉住。
    const def = columnDefinition(standaloneSql, COLUMN);
    expect(def).toMatch(/VARCHAR\(32\) NULL/);
    expect(def).not.toMatch(/NOT NULL/i);
  });

  it("★ 只加这一列：一条 ALTER TABLE、一次 ADD COLUMN", () => {
    expect(standaloneSql.match(/ALTER TABLE/g) ?? []).toHaveLength(1);
    expect(standaloneSql.match(/ADD COLUMN/g) ?? []).toHaveLength(1);
    expect(standaloneSql).toContain("`" + TABLE + "`");
  });

  it("★★ 绝不含 DROP / MODIFY —— 兼容窗口的硬要求", () => {
    // 上线顺序：本迁移先跑 → worker-java 随后上线（它**现查库**读能力行，不读冻结快照）。
    // 窗口里旧 worker 仍读 channel_parser + features.image_protocol。
    // 这条迁移一旦 DROP 掉旧列，窗口里的旧 worker 直接读空 —— 图片链路整条挂掉。
    // 删旧列必须**单开一条迁移**、且晚至少一个发布周期。
    const stripped = standaloneSql.replace(/--[^\n]*/g, "");
    expect(stripped).not.toMatch(/\bDROP\b/i);
    expect(stripped).not.toMatch(/\bMODIFY\b/i);
    expect(stripped).not.toMatch(/CHANGE\s+COLUMN/i);
  });

  it("★ 回填覆盖全部渠道取值（枚举封闭性）", () => {
    // 少一个值 = 那一类行回填不出来（留 NULL），而 NULL 在读取侧会落到缺省渠道。
    for (const channel of CHANNELS) {
      expect(standaloneSql, `回填缺渠道「${channel}」`).toContain(`'${channel}'`);
    }
  });

  it("★ 回填不按 provider_id 过滤", () => {
    // IKHEXG 的教训：存量里 provider_id 的实际取值与预期不符（线上是 volcengine 而非 new-api），
    // 按它过滤会静默漏掉整批行。
    const updateStmt = standaloneSql.slice(standaloneSql.indexOf("UPDATE"));
    expect(updateStmt).not.toContain("provider_id");
  });

  it("schema.prisma 有该列（本迁移加的是可空列；041 之后收成必填）", () => {
    const model = schemaPrisma.slice(schemaPrisma.indexOf(`model ${TABLE} {`));
    const body = model.slice(0, model.indexOf("\n}"));
    expect(body).toMatch(new RegExp(`${COLUMN}\\s+String`));
    // 本迁移**加**的是可空列（回填不到的留空），收窄是 041 的事——这条只钉「列在」
    expect(standaloneSql).toContain("VARCHAR(32) NULL");
  });
});
