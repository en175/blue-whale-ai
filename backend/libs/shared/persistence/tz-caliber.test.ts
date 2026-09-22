// IKHJ0Q 时间口径：**不连库**的机制守卫。
//
// 为什么单独有这一层：口径的完整验证在 tz-caliber.integration.test.ts，但那是 DB 门控的
// （IKHJ0Q_DATABASE_URL），CI/门禁默认不设 → 整组跳过。而这里守的不是应用行为，是
// **让所有写入成立的那两处机制本身**，失效模式静默且全仓 —— 跳过等于没有。
// 所以把两处机制的「存在性」提成纯单测，默认门禁就能拦住。
//
// 与集成测试分工：
//   本文件      → 机制还在不在（配置项取值、补丁是否落到安装副本）
//   集成测试    → 机制合起来是否真的让两条写入路径落在同一个钟

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPoolConfig } from "./db.js";

describe("时间口径机制守卫（IKHJ0Q）", () => {
  it("db.ts 的 poolConfig 把会话时区钉在 +08:00", () => {
    // 这一项管 DB 端求值：NOW()、CURRENT_TIMESTAMP(0)、DDL 的 DEFAULT CURRENT_TIMESTAMP(0)。
    // 删掉它 → gmt_create（DB 默认值）走 UTC 而 gmt_modified（应用写入）走北京，同行差 8 小时。
    expect(buildPoolConfig("mysql://u:p@h:3306/db").timezone).toBe("+08:00");
  });

  it("安装的 @prisma/adapter-mariadb 确实带着补丁", () => {
    // 读**实际被解析到的**那份 dist，而不是仓库里的 patch 文件——只有安装副本被打上才算数。
    // 覆盖的失效模式：backend/patches/ 没被 pnpm 应用、patchedDependencies key 与解析版本不匹配
    // （backend/package.json 已锁死精确版本 7.9.0 来防这一条）、有人把 patch 文件删了。
    const entry = createRequire(import.meta.url).resolve("@prisma/adapter-mariadb");
    const source = readFileSync(entry, "utf8");

    // 读方向：裸字面量按 +08:00 解释（原本是硬编码的 Z）
    expect(source).toContain("new Date(`${value}+08:00`)");
    // 写方向：先偏移到北京墙钟再取 UTC 分量（原本直接 getUTC*）
    expect(source).toContain("date.getTime() + 8 * 3600e3");
  });
});
