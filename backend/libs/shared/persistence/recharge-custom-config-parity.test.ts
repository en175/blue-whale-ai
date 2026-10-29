import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";


const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const seedMigration = read(
  "../../../prisma/migrations/20261020120000_ikiugj_recharge_custom_to_system_settings/migration.sql",
);
const seedStandalone = read(
  "../../../prisma/schema/070_ikiugj_recharge_custom_to_system_settings.sql",
);
const seedSnapshot = read(
  "../../../../docs/sql/20261020_ikiugj_recharge_custom_to_system_settings.sql",
);

const dropMigration = read(
  "../../../prisma/migrations/20261020130000_ikiugj_drop_recharge_custom_config/migration.sql",
);
const dropStandalone = read("../../../prisma/schema/071_ikiugj_drop_recharge_custom_config.sql");
const dropSnapshot = read("../../../../docs/sql/20261020_ikiugj_drop_recharge_custom_config.sql");

const schemaPrisma = read("../../../prisma/schema.prisma");

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../../..");
const SELF = fileURLToPath(import.meta.url);

function statementsOf(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "gen"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("自定义充值配置迁入 system_settings — 069 seed", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(seedStandalone).toBe(seedMigration);
    expect(seedSnapshot).toBe(seedMigration);
  });

  it("含 SET NAMES utf8mb4（中文注释/JSON 的 charset 回归保护）", () => {
    expect(seedMigration).toContain("SET NAMES utf8mb4");
  });

  it("可执行正文只有 SET NAMES + 一条 INSERT ... SELECT（幂等语句）", () => {
    const statements = statementsOf(seedMigration);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe("SET NAMES utf8mb4");
    expect(statements[1]).toMatch(/^INSERT INTO `system_settings`/);
    expect(statements[1]).toContain("ON DUPLICATE KEY UPDATE");
  });

  it("★ 迁移日期的十个字段一个不少，键名与 repo 的 JSON 形态一致", () => {
    for (const key of [
      "minCredits",
      "maxCredits",
      "defaultCredits",
      "creditsPerYuan",
      "stepCredits",
      "enabled",
      "permission",
      "permissionAllowlist",
      "permissionDeniedHint",
      "creditsValidMonths",
    ]) {
      expect(seedMigration, `缺键 ${key}`).toContain(`'${key}'`);
    }
  });

  it("★ 明文行：is_secret 固定 0；版本重置为 0（用户确认）", () => {
    expect(seedMigration).toMatch(/`is_secret`/);
    expect(seedMigration).toMatch(
      /0,\n\s*`gmt_create`,\n\s*`gmt_modified`,\n\s*0\nFROM `recharge_custom_config`/,
    );
  });

  it("★ 幂等不覆盖：键已存在时不做任何字段回写", () => {
    expect(seedMigration).toMatch(
      /ON DUPLICATE KEY UPDATE\s*\n\s*`setting_key` = 'rechargeCustom'/,
    );
    expect(seedMigration).not.toContain("setting_value` = VALUES");
  });

  it("★ enabled 以 JSON 布尔落库，不是 0/1 或字符串", () => {
    expect(seedMigration).toContain("CAST('true' AS JSON)");
    expect(seedMigration).toContain("CAST('false' AS JSON)");
  });
});

describe("自定义充值配置迁入 system_settings — 070 drop", () => {
  it("三轨逐字一致", () => {
    expect(dropStandalone).toBe(dropMigration);
    expect(dropSnapshot).toBe(dropMigration);
  });

  it("可执行正文只有 SET NAMES + 一条 DROP TABLE", () => {
    const statements = statementsOf(dropMigration);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe("SET NAMES utf8mb4");
    expect(statements[1]).toBe("DROP TABLE IF EXISTS `recharge_custom_config`");
  });
});

describe("schema.prisma 与全仓残留", () => {
  it("Prisma 模型已删除，system_settings 仍在", () => {
    expect(schemaPrisma).not.toMatch(/\bmodel\s+recharge_custom_config\s*\{/);
    expect(schemaPrisma).toMatch(/\bmodel\s+bw_platform_settings\s*\{/);
    expect(schemaPrisma).toMatch(/setting_key\s+String\s+@id/);
  });

  it("★ backend / web/src 源码里不再引用旧表", () => {
    const roots = [join(REPO_ROOT, "backend"), join(REPO_ROOT, "web/src")];
    const offenders = roots
      .flatMap((root) => collectSourceFiles(root))
      .filter((file) => file !== SELF)
      .filter((file) => /\brecharge_custom_config\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file))
      .sort();

    expect(offenders).toEqual([]);
  });
});
