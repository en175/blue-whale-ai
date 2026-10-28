import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260926060000_generation_model_capability_drop_channel_parser/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/040_generation_model_capability_drop_channel_parser.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL(
    "../../../../docs/sql/20260926_generation_model_capability_drop_channel_parser.sql",
    import.meta.url,
  ),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const EXECUTABLE = stripComments(standaloneSql);

describe("generation_model_capability 删列 channel_parser 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 只做这一件事：一条 ALTER TABLE、一次 DROP COLUMN，且删的就是旧列", () => {
    expect(EXECUTABLE.match(/ALTER TABLE/g) ?? []).toHaveLength(1);
    expect(EXECUTABLE.match(/DROP COLUMN/g) ?? []).toHaveLength(1);
    expect(EXECUTABLE).toMatch(/DROP COLUMN\s+`channel_parser`/);
  });

  it("★★ 不碰 request_mapping（它是数据，不是能从渠道推导出来的值）", () => {
    expect(EXECUTABLE).not.toContain("request_mapping");
  });

  it("★ 清掉 features 里的退役键（两种键形都清）", () => {
    expect(EXECUTABLE).toContain("JSON_REMOVE");
    expect(EXECUTABLE).toContain("$.image_protocol");
    expect(EXECUTABLE).toContain("$.imageProtocol");
    expect(EXECUTABLE.indexOf("JSON_REMOVE")).toBeLessThan(EXECUTABLE.indexOf("ALTER TABLE"));
  });

  it("★ 前置校验写在注释里（执行前人工确认渠道已回填）", () => {
    expect(standaloneSql).toContain("channel IS NULL");
  });

  it("schema.prisma 已不再声明该列", () => {
    const model = schemaPrisma.slice(schemaPrisma.indexOf("model catalog_models {"));
    const body = model.slice(0, model.indexOf("\n}"));
    const fields = body
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("///"))
      .join("\n");
    expect(fields).not.toMatch(/channel_parser/);
    expect(fields).toMatch(/\bchannel\s+String\s+@db\.VarChar\(32\)/);
  });
});

describe("★ 旧列/旧键在代码里已零引用（删列的唯一前提）", () => {
  const ROOTS = [
    "../../../libs/",
    "../../../apps/",
    "../../../../web/src/",
    "../../../../server/blue-whale-worker/src/",
    "../../../../server/blue-whale-billing/src/",
  ].map((rel) => fileURLToPath(new URL(rel, import.meta.url)));
  const NEEDLES = ["channel_parser", "channelParser", "image_protocol", "imageProtocol"];

    let scanned = 0;
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const full of walk(root)) {
      if (/\.test\.(ts|tsx)$/.test(full)) continue;
      scanned += 1;
      const text = readFileSync(full, "utf8");
      const codeOnly = text
        .split("\n")
        .map((line) => line.replace(/^\s*(\/\/|\*|\/\*).*$/, ""))
        .join("\n");
      const live = NEEDLES.filter((n) => codeOnly.includes(n));
      if (live.length > 0) {
        const rel = full.slice(full.indexOf("feature-dd30f274/") + 17);
        offenders.push(`${rel} → ${live.join(", ")}`);
      }
    }
  }

  it("扫到了文件（防遍历失效导致整条断言空转）", () => {
    expect(scanned, "一个源码文件都没扫到").toBeGreaterThan(50);
  });

  it("非测试源码里没有旧列 / 旧键的**活引用**", () => {
    expect(offenders, `这些文件还在引用已退役的列/键：\n${offenders.join("\n")}`).toEqual([]);
  });
});
