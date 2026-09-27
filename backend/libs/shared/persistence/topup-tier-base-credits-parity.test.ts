import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 基础积分改为**配置值**（迁移 048）+ 6 个固定档位的初始化（迁移 049）。
// 镜像 topup-tier-card-fields-parity 的三轨核对结构。

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

const ddlMigration = read(
  "../../../prisma/migrations/20260927020000_topup_tier_base_credits/migration.sql",
);
const ddlStandalone = read("../../../prisma/schema/048_topup_tier_base_credits.sql");
const ddlSnapshot = read("../../../../docs/sql/20260927_topup_tier_base_credits.sql");

const seedMigration = read(
  "../../../prisma/migrations/20260927030000_seed_topup_tiers/migration.sql",
);
const seedStandalone = read("../../../prisma/schema/049_seed_topup_tiers.sql");
const seedSnapshot = read("../../../../docs/sql/20260927_seed_topup_tiers.sql");

const schemaPrisma = read("../../../prisma/schema.prisma");

describe("迁移 048 — 基础积分改为配置值", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(ddlStandalone).toBe(ddlMigration);
    expect(ddlSnapshot).toBe(ddlMigration);
  });

  it("含 SET NAMES utf8mb4（列注释里有中文，charset 回归保护）", () => {
    expect(ddlStandalone).toContain("SET NAMES utf8mb4");
  });

  it("★ 加列 `base_credits BIGINT NOT NULL DEFAULT 0`（单位整数积分）", () => {
    expect(ddlStandalone).toMatch(/ADD COLUMN base_credits BIGINT NOT NULL DEFAULT 0/);
    expect(schemaPrisma).toMatch(/base_credits\s+BigInt\s+@default\(0\)/);
  });

  it("★ 列注释把「积分与原价/折扣再无数学关系」写死（否则下一个人会去修那个对不上的数）", () => {
    // 这条不是文案洁癖，是**防止误修**：¥499 的档给 7,500 积分（499×15=7,485），
    // 下一个人看到「不是原价的整数倍」会以为配错了。注释必须当场拦住他。
    expect(ddlStandalone).toContain("配置值，不是派生值");
    expect(ddlStandalone).toContain("再无数学关系");
    expect(ddlStandalone).toContain("7,485");
    // 「0 = 还没配过，下单会被拒」也要在，否则没人知道存量行为什么变成 0
    expect(ddlStandalone).toMatch(/0 = 还没配过/);
  });

  it("★ 存量行落在 0，**不回填**：迁移里没有任何 DML", () => {
    // 存量行的「此刻展示积分」是读路径现算的（原价 × 当时的换算率），而换算率住在
    // billing 的定价目录里 —— SQL 读不到。硬写一个常数回填 = 把一条运行时口径冻进
    // 版本化迁移，赌错了会静默改掉所有存量档位的积分。所以选择「落 0」：
    // 下单路径拒绝 0 积分档位（fail-closed），管理端列表里一眼能看见。
    expect(ddlStandalone).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/i);
  });
});

describe("迁移 049 — 6 个固定档位初始化", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(seedStandalone).toBe(seedMigration);
    expect(seedSnapshot).toBe(seedMigration);
  });

  it("含 SET NAMES utf8mb4（有中文名与中文标签）", () => {
    expect(seedStandalone).toContain("SET NAMES utf8mb4");
  });

  it("★ 注释写明「初始化 ≠ 写死」：写进库的是初始值，之后运营照常改，代码里不再引用", () => {
    expect(seedStandalone).toContain("初始化");
    expect(seedStandalone).toContain("初始值");
    // PRD §6.1 要求「不在代码中写死」——这份张力必须在注释里被显式回应
    expect(seedStandalone).toContain("不在代码中写死");
  });

  it("★ 6 档一次给全（PRD §6.1 逐字）", () => {
    const rows: [string, string, string, string, string][] = [
      ["轻量尝鲜", "7500", "3750", "499.00", "1"],
      ["日常创作", "15000", "7500", "999.00", "2"],
      ["项目启动", "30000", "15000", "1999.00", "3"],
      ["高频创作", "45000", "22500", "2999.00", "4"],
      ["重度创作", "90000", "90000", "5999.00", "5"],
      ["无忧创作", "225000", "225000", "14999.00", "6"],
    ];
    for (const [name, base, bonus, price, sort] of rows) {
      expect(seedStandalone, `缺档位 ${name}`).toContain(`'${name}'`);
      // 一行里的关键数按出现顺序：名称、基础积分、赠送积分、实付价、排序
      expect(seedStandalone, `档位 ${name} 的数值对不上`).toMatch(
        new RegExp(
          `'${name}',\\s*${base},\\s*${bonus},\\s*${base},\\s*${price},\\s*1\\.0000,\\s*${price},\\s*[01],\\s*'active',\\s*${sort},`,
        ),
      );
    }
  });

  it("★ 基础积分**不是**原价 × 15（若这里凑齐了，说明有人把它当派生量回填）", () => {
    // ¥499 × 15 = 7,485 ≠ 7,500；¥5,999 × 15 = 89,985 ≠ 90,000。
    expect(seedStandalone).not.toContain("7485");
    expect(seedStandalone).not.toContain("89985");
    expect(seedStandalone).toContain("7,485");
  });

  it("★ 价格只给一个：original_price = price、discount = 1（**不编造划线价**）", () => {
    // PRD §6.1 没给划线价，所以不发明一个 —— 用户侧不出现划掉的价。
    // 只数 INSERT 的行（注释里也提到过 1.0000，那是解释文字不是数据）。
    const seedBody = seedStandalone
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    // 6 行的折扣列全是 1.0000：行内出现别的值就是有人替产品编了个原价。
    expect(seedBody.match(/1\.0000/g)?.length).toBe(6);
  });

  it("★ 6 档都参与首购（first_purchase_eligible = 1），但**不回答**首购怎么算", () => {
    // PRD §6.1 给每一档都配了首购标签，所以 6 行都填 1。
    // ⚠️「每档独立算一次还是每账号只一次」是模块 C（#40，停放中）的事 —— 本列不回答它，
    //    迁移里必须留这句话，否则下一个人会以为这里已经定了。
    expect(seedStandalone).toContain("首购");
    expect(seedStandalone).toContain("还没定形");
    expect(seedStandalone.match(/, 1, 24, 'all', NULL, ''\)/g)?.length).toBe(6);
  });

  it("★ 有效期 24 个月（PRD §10.2 默认 2 年）、权限 all、白名单 NULL", () => {
    expect(seedStandalone.match(/, 1, 24, 'all', NULL, ''\)/g)?.length).toBe(6);
  });

  it("★ 初始化即可见：6 行都 active（字段已按 PRD 配齐，草稿态的前提已满足）", () => {
    expect(seedStandalone.match(/'active'/g)?.length).toBe(6);
    // 理由也要留在文件里：047 的「新建默认草稿」管的是运营在后台新建的卡片，
    // 这 6 行是**已配齐的初始值**，不是那种情况。
    expect(seedStandalone).toContain("新建卡片默认草稿");
  });

  it("★ 遗留列 `amount` 与 base_credits 同值（读路径已不看它，但不留 0 或 5,000,000）", () => {
    // 行里的第 4 个数就是 amount：与 base_credits（第 2 个数）逐行相同 —
    // 上面「6 档一次给全」那条正则已经钉住了这个顺序，这里额外说明原因在注释里。
    expect(seedStandalone).toContain("amount");
    expect(seedStandalone).toContain("读路径已不再信它");
  });

  it("插入前有前置校验（目标环境已有同价档位时先停手）", () => {
    expect(seedStandalone).toContain("前置校验");
    expect(seedStandalone).toContain("499, 999, 1999, 2999, 5999, 14999");
  });
});
