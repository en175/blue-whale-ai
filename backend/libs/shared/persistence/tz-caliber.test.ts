
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPoolConfig } from "./db.js";

describe("时间口径机制守卫（IKHJ0Q）", () => {
  it("db.ts 的 poolConfig 把会话时区钉在 +08:00", () => {
    expect(buildPoolConfig("mysql://u:p@h:3306/db").timezone).toBe("+08:00");
  });

  it("安装的 @prisma/adapter-mariadb 确实带着补丁", () => {
    const entry = createRequire(import.meta.url).resolve("@prisma/adapter-mariadb");
    const source = readFileSync(entry, "utf8");

    expect(source).toContain("new Date(`${value}+08:00`)");
    expect(source).toContain("date.getTime() + 8 * 3600e3");
  });
});
