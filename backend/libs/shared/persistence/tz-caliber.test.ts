import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPoolConfig } from "./db.js";

describe("时间口径机制守卫（IKHJ0Q）", () => {
  it("会话时区由连接串给，代码里不钉任何偏移", () => {
    expect(buildPoolConfig("mysql://u:p@h:3306/db").timezone).toBeUndefined();
    expect(buildPoolConfig("mysql://u:p@h:3306/db?timezone=%2B08%3A00").timezone).toBe("+08:00");
    expect(buildPoolConfig("mysql://u:p@h:3306/db?timezone=+08:00").timezone).toBe("+08:00");
  });

  it("安装的 @prisma/adapter-mariadb 用自洽的命名偏移解释与生成 DATETIME", () => {
    const entry = createRequire(import.meta.url).resolve("@prisma/adapter-mariadb");
    const source = readFileSync(entry, "utf8");

    expect(source).toContain('const BLUE_WHALE_DB_OFFSET = "+08:00";');
    expect(source).toContain("date.getTime() + BLUE_WHALE_DB_OFFSET_MS");
    expect(source).not.toContain("date.getFullYear()");
  });
});
