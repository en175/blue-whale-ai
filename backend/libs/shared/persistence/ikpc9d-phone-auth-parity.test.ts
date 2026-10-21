import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("IKPC9D 三轨 SQL 一致：bw_users.nickname 与 bw_verification_codes.purpose", () => {
  const sql = readFileSync(
    new URL("../../../prisma/schema/072_ikpc9d_phone_login_account_mainline.sql", import.meta.url),
    "utf8",
  );
  expect(
    readFileSync(
      new URL(
        "../../../prisma/migrations/20261021123000_ikpc9d_phone_login_account_mainline/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ).toBe(sql);
  expect(
    readFileSync(
      new URL("../../../../docs/sql/20261021_ikpc9d_phone_login_account_mainline.sql", import.meta.url),
      "utf8",
    ),
  ).toBe(sql);
  expect(sql).toContain("SET NAMES utf8mb4");
  expect(sql).toContain("ADD COLUMN `nickname` VARCHAR(50) NULL");
  expect(sql).toContain("ADD COLUMN `purpose` VARCHAR(20) NOT NULL DEFAULT 'login'");
  expect(sql).toContain("ADD COLUMN `attempts` INT NOT NULL DEFAULT 0");
  expect(sql).toContain("`idx_phone_purpose_unused` (`phone`, `purpose`, `is_used`, `gmt_expire`)");
});
