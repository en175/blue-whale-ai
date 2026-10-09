import { describe, expect, it } from "vitest";

import {
  BCRYPT_COST,
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  PasswordPolicyError,
  burnVerificationTime,
  hashPassword,
  verifyPassword,
} from "./password.js";

describe("hashPassword", () => {
  it("产出 bcrypt 哈希，且与 new-api 的代价因子一致", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toMatch(new RegExp(`^\\$2[aby]\\$${BCRYPT_COST}\\$`));
    expect(hash.length).toBeLessThanOrEqual(63);
  });

  it("同一口令两次哈希不同（加盐）", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("★ 超长口令被**拒绝**而不是被静默截断", async () => {
    const tooLong = "a".repeat(MAX_PASSWORD_BYTES + 1);

    await expect(hashPassword(tooLong)).rejects.toThrow(PasswordPolicyError);
  });

  it(`★ 短于 ${MIN_PASSWORD_LENGTH} 位被拒绝 —— 下限只作用于设置，不作用于校验`, async () => {
    await expect(hashPassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).rejects.toThrow(
      PasswordPolicyError,
    );
    await expect(hashPassword("a".repeat(MIN_PASSWORD_LENGTH))).resolves.toBeTruthy();
  });

  it("按**字节**而不是字符算长度：24 个汉字 = 72 字节，放行；25 个超限", async () => {
    expect(Buffer.byteLength("汉".repeat(24), "utf8")).toBe(MAX_PASSWORD_BYTES);
    await expect(hashPassword("汉".repeat(24))).resolves.toBeTruthy();
    await expect(hashPassword("汉".repeat(25))).rejects.toThrow(PasswordPolicyError);
  });
});

describe("verifyPassword", () => {
  it("正确口令通过，错误口令不通过", async () => {
    const hash = await hashPassword("s3cret-pass");

    await expect(verifyPassword("s3cret-pass", hash)).resolves.toBe(true);
    await expect(verifyPassword("s3cret-pas", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("★ 认 Go 的 $2a$ 前缀 —— 存量哈希是从 new-api 搬来的", async () => {
    const mine = await hashPassword("legacy-user-pass");
    const asGoWouldStoreIt = mine.replace(/^\$2b\$/, "$2a$");

    await expect(verifyPassword("legacy-user-pass", asGoWouldStoreIt)).resolves.toBe(true);
    await expect(verifyPassword("wrong", asGoWouldStoreIt)).resolves.toBe(false);
  });

  it("★ 没有口令的账号一律 false —— null 不是「都能登」", async () => {
    await expect(verifyPassword("anything", null)).resolves.toBe(false);
    await expect(verifyPassword("anything", undefined)).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });

  it("★ 哈希损坏时返回 false 而不是抛错 —— 坏数据不该变成 500", async () => {
    await expect(verifyPassword("x", "not-a-bcrypt-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "$2b$garbage")).resolves.toBe(false);
  });

  it("★ 短口令照常校验（下限只约束设置）—— 老账号可能是 6 位的", async () => {
    const hash = await hashPassword("abcdefgh");
    await expect(verifyPassword("abcdefgh", hash)).resolves.toBe(true);
  });

  it("★ 超长口令照常校验（不拒绝）—— 历史实现允许过，拦下来等于锁人", async () => {
    const long = "a".repeat(MAX_PASSWORD_BYTES + 10);
    const hash = await hashPassword(long.slice(0, MAX_PASSWORD_BYTES));

    await expect(verifyPassword(long, hash)).resolves.toBe(true);
  });
});

describe("burnVerificationTime", () => {
  it("★ 真的跑一次 bcrypt —— 否则「查无此人」比「密码错」快 60ms", async () => {
    const started = Date.now();
    await burnVerificationTime("whatever");

    expect(Date.now() - started).toBeGreaterThan(10);
  });

  it("连调两次都稳定返回（哑哈希只生成一次，不影响正确性）", async () => {
    await expect(burnVerificationTime("a")).resolves.toBeUndefined();
    await expect(burnVerificationTime("b")).resolves.toBeUndefined();
  });
});
