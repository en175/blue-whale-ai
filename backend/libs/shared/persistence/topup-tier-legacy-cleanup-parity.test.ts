import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 存量档位软删（迁移 052）的三轨核对。
 *
 * 这条迁移改的是**数据**，但删的是**能卖的东西**：判错一边就是「把还在售的档位下架」
 * 或者「把 0 积分的死行继续挂在用户端」。所以守卫全打在**界定条件**上 ——
 * 「删谁、不删谁」是这个文件唯一的主题。
 */

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260927060000_soft_delete_legacy_topup_tiers/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/052_soft_delete_legacy_topup_tiers.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260927_soft_delete_legacy_topup_tiers.sql", import.meta.url),
  "utf8",
);

/**
 * 去掉 `--` 行注释后的**可执行 SQL**。
 *
 * ⚠️ 「不含某个词」这类断言一律打在它上面：本迁移的注释里正当地提到了「重度创作」
 * （举「按名字界定会把改过名的在售档位删掉」这个反例），拿原文断言 not.toContain
 * 会把「解释得清楚」判成违规，逼下一个人删掉最该留的那段说明。
 */
const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

describe("迁移 052 — 存量档位软删：三轨与形态", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（注释里有中文，charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 纯数据迁移：没有任何 DDL（结构变更必须各自成一条迁移）", () => {
    expect(sqlCode).not.toMatch(/\b(ALTER|CREATE|DROP)\b/i);
    expect(sqlCode).not.toMatch(/ADD COLUMN/i);
  });

  it("★ 是**软删**（UPDATE is_delete），不是物理删（DELETE FROM）", () => {
    // 物理删会让历史订单的 recharge_orders.tier_id 指向一个查不到的档位。
    expect(sqlCode).not.toMatch(/\bDELETE\b/i);
    expect(sqlCode.match(/UPDATE\s+`topup_tiers`/g) ?? []).toHaveLength(1);
    expect(standaloneSql).toMatch(/SET\s+`is_delete`\s*=\s*1/);
  });
});

describe("迁移 052 — 界定条件：删谁、不删谁", () => {
  it("★ 只删「配不出积分」的行：WHERE `base_credits` = 0", () => {
    // base_credits 是读路径唯一认的积分来源（048），0 = 下单必被拒 = 不可售。
    // 这条就是「删的是死行」这个论断的全部依据，改一位（比如写成 > 0）方向就反了。
    expect(standaloneSql).toMatch(/`base_credits`\s*=\s*0/);
    expect(sqlCode).not.toMatch(/`base_credits`\s*>\s*0/);
  });

  it("★ 不按名字界定：可执行 SQL 里一个档位名都不出现", () => {
    // 049 自己写着「代码里没有任何地方再引用这 6 个名字……运营改名/改价都不会被纠正」。
    // 按名字界定等于推翻那句话：改过名的在售档位会被这一次迁移连同积分一起软删。
    for (const name of ["轻量尝鲜", "日常创作", "项目启动", "高频创作", "重度创作", "无忧创作"]) {
      expect(sqlCode, `可执行 SQL 里不该出现档位名 ${name}`).not.toContain(name);
    }
    expect(sqlCode).not.toMatch(/\bname\b/i);
  });

  it("★ 不依赖 id：可执行 SQL 里没有 id 硬编码", () => {
    // 21–26 只是本地库的自增值，别的环境不是这个数。
    expect(sqlCode).not.toMatch(/\bid\s*(=|IN\b)/i);
    expect(sqlCode).not.toMatch(/\b21\b/);
  });

  it("★ 只动 `is_delete` = 0 的行（已软删过的时间戳不许被刷成今天）", () => {
    // 刷新它们的 gmt_modified 等于抹掉「它什么时候被下架的」这个唯一痕迹
    // （本表没有单独的删除时刻列）。
    expect(standaloneSql).toMatch(/`is_delete`\s*=\s*0/);
  });

  it("★ 只更新 `is_delete` 与 `gmt_modified` 两列，不碰价格/状态/积分", () => {
    // 这次清理的语义是「下架」，不是「改配置」：碰任何一列都可能悄悄改掉老订单对得上的口径
    // （例如 status 改成 inactive 会让它出现在管理端的下架筛选里，而它其实是被清掉的残留）。
    const setClause = standaloneSql.match(/SET([\s\S]*?)WHERE/i)?.[1] ?? "";
    const columns = [...setClause.matchAll(/`(\w+)`\s*=/g)].map((m) => m[1]);
    expect(columns).toEqual(["is_delete", "gmt_modified"]);
  });

  it("前置校验与回读验证都写在迁移注释里（执行前人工确认要删几行）", () => {
    expect(standaloneSql).toContain("前置校验");
    expect(standaloneSql).toContain("will_soft_delete");
    expect(standaloneSql).toContain("回读验证");
  });
});
