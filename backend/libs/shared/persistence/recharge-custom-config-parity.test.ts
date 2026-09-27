import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 自定义充值（模块 B）：配置表 + 订单不再强绑档位（迁移 050）。
// 镜像 topup-tier-base-credits-parity 的三轨核对结构：
// prisma migration、schema 独立文件、docs/sql 快照三处同源。

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

const migrationSql = read(
  "../../../prisma/migrations/20260927040000_recharge_custom_config/migration.sql",
);
const standaloneSql = read("../../../prisma/schema/050_recharge_custom_config.sql");
const snapshotSql = read("../../../../docs/sql/20260927_recharge_custom_config.sql");
const schemaPrisma = read("../../../prisma/schema.prisma");

describe("迁移 050 — 自定义充值配置 + 订单 tier_id 可空", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（列注释里有中文，charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 独立表 `recharge_custom_config`，**单行**（主键钉住 id，不是自增）", () => {
    expect(standaloneSql).toMatch(/CREATE TABLE `recharge_custom_config`/);
    expect(standaloneSql).toMatch(/PRIMARY KEY \(`id`\)/);
    // 自增 = 可以有两行 = 两份互相矛盾的配置。单行表的主键绝不能是 AUTO_INCREMENT
    expect(standaloneSql).not.toMatch(/`id`\s+INT\s+NOT NULL AUTO_INCREMENT/);
  });

  it("★ 为什么**不塞进 system_settings** 必须写在文件里（否则下一个人会去合表）", () => {
    // 那一行存的是凭证：AES 密文 + is_secret + 换密钥要重写全部密文行的轮换语义。
    // 商品配置是明文、要按字段校验、随调价高频改 —— 两类东西的读写路径与安全假设不同。
    expect(standaloneSql).toContain("system_settings");
    expect(standaloneSql).toContain("凭证");
    expect(standaloneSql).toContain("AES");
  });

  it("★ PRD §10.3 的九个字段一个不少（外加步长与版本）", () => {
    for (const column of [
      "min_credits",
      "max_credits",
      "default_credits",
      "credits_per_yuan",
      "step_credits",
      "enabled",
      "permission",
      "permission_allowlist",
      "permission_denied_hint",
      "credits_valid_months",
      "version",
    ]) {
      expect(standaloneSql, `缺列 ${column}`).toContain(`\`${column}\``);
    }
  });

  it("★ 种子行就是 PRD §7.1 的默认配置，且**只种一行**", () => {
    expect(standaloneSql).toMatch(
      /\(1,\s*600,\s*499995,\s*600,\s*15,\s*15,\s*1,\s*'all',\s*NULL,\s*'',\s*24,\s*0\)/,
    );
    // 「初始化 ≠ 写死」：文件里必须说清写进库的是初始值，代码不引用这几个数字
    expect(standaloneSql).toContain("初始值");
  });

  it("★ 默认那组数能被每元积分数整除（PRD §7.1「需能被换算比例整除」）", () => {
    // 这条是产品决定（任务 #42 决定 3）的**数值自检**：种子若配歪了，保存校验会拒绝它，
    // 于是新环境第一次保存就报错。600/499995/600 三个数与 15 的关系在此钉住。
    expect(600 % 15).toBe(0);
    expect(499_995 % 15).toBe(0);
    expect(600 % 15).toBe(0);
    // 滑杆要能推到两端：max-min 与 default-min 都是步长的整数倍
    expect((499_995 - 600) % 15).toBe(0);
    expect((600 - 600) % 15).toBe(0);
  });

  it("★ 权限列与档位**同一套枚举**（PRD §10.3「与固定积分卡一致」）", () => {
    expect(standaloneSql).toMatch(/`permission`\s+VARCHAR\(16\)\s+NOT NULL DEFAULT 'all'/);
    expect(standaloneSql).toContain("member_tier");
    // 白名单是 JSON：元素是 userId 的十进制字符串（BigInt 超安全整数，存串不丢精度）
    expect(standaloneSql).toMatch(/`permission_allowlist`\s+JSON\s+NULL/);
  });

  it("★ `recharge_orders.tier_id` 改成**可空**：自定义充值没有档位", () => {
    expect(standaloneSql).toMatch(
      /MODIFY COLUMN `tier_id` BIGINT NULL/,
    );
    // 理由要写在文件里：编一个 0/1 出来会被按 tier_id 聚合的对账当成真档位
    expect(standaloneSql).toContain("对账");
    expect(schemaPrisma).toMatch(/tier_id\s+BigInt\?/);
  });

  it("★ Prisma 模型与建表语句同源", () => {
    expect(schemaPrisma).toContain("model recharge_custom_config {");
    // 单行表：Prisma 侧的主键同样不能带 @default(autoincrement())
    expect(schemaPrisma).toMatch(/id\s+Int\s+@id\b/);
    expect(schemaPrisma).not.toMatch(/id\s+Int\s+@id\s+@default\(autoincrement\(\)\)[\s\S]{0,200}recharge_custom_config/);
  });

  it("★ 订单快照里「有效期」这一列的口径改了：自定义充值单会写入非空值", () => {
    // 档位单的 2 年有效期是 #43；自定义充值被 PRD §7.4 明确要求快照有效期，所以那条路径
    // 现在就会算出 credits_expire_at。注释必须跟上，否则下一个人以为这列全是 NULL。
    expect(schemaPrisma).toContain("credits_expire_at");
  });
});
