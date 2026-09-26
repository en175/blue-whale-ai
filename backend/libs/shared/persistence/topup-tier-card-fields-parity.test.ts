import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 固定积分卡档位的字段扩展 + 上架状态三态（PRD §6 / §10.2 / §10.4 / §10.5）。
// 镜像 recharge-orders-record-index-parity 的三轨核对结构。

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260926230000_topup_tier_card_fields/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/047_topup_tier_card_fields.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260926_topup_tier_card_fields.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

/** PRD §10.2 的九列（顺序即 ALTER 里的追加顺序）。 */
const NEW_COLUMNS = [
  "description",
  "bonus_credits",
  "activity_tag",
  "button_text",
  "first_purchase_eligible",
  "credits_valid_months",
  "permission",
  "permission_allowlist",
  "permission_denied_hint",
] as const;

/** 取出 `ADD COLUMN <name>` 的名字，按出现顺序。 */
function addedColumns(sql: string): string[] {
  return [...sql.matchAll(/ADD COLUMN\s+(\w+)/g)].map((m) => m[1]);
}

describe("topup_tiers 卡片字段扩展三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（列注释里有中文，charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 九列一次给全，顺序与声明一致", () => {
    expect(addedColumns(standaloneSql)).toEqual([...NEW_COLUMNS]);
  });

  it("★ 存量行一律不动：迁移里没有任何 DML", () => {
    // 「存量行不动」不是一条实现细节，是**本迁移唯一正确的行为**：
    // 19 行存量档位已经是上架/下架，任何为了让新默认值显得整齐而回写 status 的
    // UPDATE，都会把正在卖的卡片打回草稿 —— 那是直接的下架事故。
    // 所以这里不是断言「我们没写 UPDATE」，而是断言**这份文件里不许出现 DML**。
    expect(standaloneSql).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/i);
  });

  it("★ status 默认值改为 draft（PRD §10.5 新建卡片默认草稿）", () => {
    expect(standaloneSql).toMatch(
      /MODIFY COLUMN status VARCHAR\(16\) NOT NULL DEFAULT 'draft'/,
    );
    // 列默认值管的是「绕过 repo 的插入」，两边必须同口径
    expect(schemaPrisma).toMatch(/status\s+String\s+@default\("draft"\)/);
  });

  it("★ 三态与权限枚举在列注释里写死，加值不用改表", () => {
    expect(standaloneSql).toContain("draft 草稿");
    expect(standaloneSql).toContain("active 上架");
    expect(standaloneSql).toContain("inactive 下架");
    expect(standaloneSql).toContain("member_tier 指定会员等级");
    // 阶段 2 占位这件事必须留在注释里：下一个人看到这个值会以为它已经生效
    expect(standaloneSql).toContain("阶段 2");
  });

  it("★ 积分有效期的口径钉死在**月**（不是年）", () => {
    expect(standaloneSql).toMatch(
      /credits_valid_months INT NOT NULL DEFAULT 24/,
    );
    expect(standaloneSql).toContain("单位**月**");
    expect(schemaPrisma).toMatch(/credits_valid_months\s+Int\s+@default\(24\)/);
  });

  it("★ 白名单是 JSON 列，且注释写明元素是十进制字符串（BigInt 精度）", () => {
    expect(standaloneSql).toMatch(/permission_allowlist JSON NULL/);
    expect(standaloneSql).toContain("十进制字符串");
    expect(schemaPrisma).toMatch(/permission_allowlist\s+Json\?/);
  });

  it("Prisma 模型与迁移同源（列同样的顺序）", () => {
    // 重排模型里的列序不会报错、也不会红 —— 下一次 `prisma migrate` 会把它当成
    // 一次列重排，生成一串没人读得懂的 MODIFY。这里钉住「追加在末尾」这件事。
    const positions = NEW_COLUMNS.map((c) =>
      schemaPrisma.indexOf(`  ${c} `),
    );
    for (const [i, pos] of positions.entries()) {
      expect(pos, `模型里找不到列 ${NEW_COLUMNS[i]}`).toBeGreaterThan(-1);
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("支付价格与基础积分没有新列：它们是派生量，不是输入", () => {
    // PRD §10.2 把「支付价格」「基础积分」列成字段，但本仓的口径是
    // price = original_price × discount、amount = original_price × 换算率。
    // 谁要是照字段表加了 `pay_price` 之类的列，就同时打开了「原价 100、积分 999999」这扇门。
    for (const forbidden of ["pay_price", "paid_price", "base_credits"]) {
      expect(addedColumns(standaloneSql)).not.toContain(forbidden);
    }
  });
});
