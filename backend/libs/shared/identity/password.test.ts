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

    // $2b$10$... —— 代价字段必须是 10：存量哈希全是 10，混用会让登录耗时随注册时间变
    expect(hash).toMatch(new RegExp(`^\\$2[aby]\\$${BCRYPT_COST}\\$`));
    // 数据库列是 VARCHAR(63)，超了会在写入时被截断成一段永远算不出的垃圾
    expect(hash.length).toBeLessThanOrEqual(63);
  });

  it("同一口令两次哈希不同（加盐）", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("★ 超长口令被**拒绝**而不是被静默截断", async () => {
    // bcrypt 只取前 72 字节。不拦的话用户以为设了 80 位密码，
    // 实际只有 72 位有效——而他永远不会知道。
    const tooLong = "a".repeat(MAX_PASSWORD_BYTES + 1);

    await expect(hashPassword(tooLong)).rejects.toThrow(PasswordPolicyError);
  });

  it(`★ 短于 ${MIN_PASSWORD_LENGTH} 位被拒绝 —— 下限只作用于设置，不作用于校验`, async () => {
    // 与前端「密码长度需为 8-20 个字符」对齐：两边不一致时，
    // 通过 API 注册的短口令用户会在登录页被前端自己拦住。
    await expect(hashPassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).rejects.toThrow(
      PasswordPolicyError,
    );
    await expect(hashPassword("a".repeat(MIN_PASSWORD_LENGTH))).resolves.toBeTruthy();
  });

  it("按**字节**而不是字符算长度：24 个汉字 = 72 字节，放行；25 个超限", async () => {
    // 一个汉字 3 字节。按字符数判会把这两者都当成「很短」
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
    // bcryptjs 产出 $2b$，而 Go 的 x/crypto/bcrypt 产出 $2a$。
    // 换前缀对 72 字节以内的口令是等价的（2a/2b 的差异只在超长口令的符号扩展上），
    // 所以这条钉的是「我们的实现不挑前缀」。
    const mine = await hashPassword("legacy-user-pass");
    const asGoWouldStoreIt = mine.replace(/^\$2b\$/, "$2a$");

    await expect(verifyPassword("legacy-user-pass", asGoWouldStoreIt)).resolves.toBe(true);
    await expect(verifyPassword("wrong", asGoWouldStoreIt)).resolves.toBe(false);
  });

  it("★ 没有口令的账号一律 false —— null 不是「都能登」", async () => {
    // bw_users.password 可空（手机号注册、刚从 new-api 迁来的行）。
    // 把 null 当成放行是把一个**数据状态**变成一次越权。
    await expect(verifyPassword("anything", null)).resolves.toBe(false);
    await expect(verifyPassword("anything", undefined)).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });

  it("★ 哈希损坏时返回 false 而不是抛错 —— 坏数据不该变成 500", async () => {
    // 列被截断、写进了明文、从别处搬来的非 bcrypt 串，都会走到这里
    await expect(verifyPassword("x", "not-a-bcrypt-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "$2b$garbage")).resolves.toBe(false);
  });

  it("★ 短口令照常校验（下限只约束设置）—— 老账号可能是 6 位的", async () => {
    // MIN_PASSWORD_LENGTH 是**设置时**的规则。加到校验上会把历史账号锁在门外，
    // 而他们没做错任何事——是当时的实现允许了短口令。
    const hash = await hashPassword("abcdefgh");
    await expect(verifyPassword("abcdefgh", hash)).resolves.toBe(true);
  });

  it("★ 超长口令照常校验（不拒绝）—— 历史实现允许过，拦下来等于锁人", async () => {
    // 设置时被 hashPassword 挡住，但存量库里可能有 new-api 时期留下的超长口令，
    // 那些用户没做错任何事。bcrypt 截断的行为与 Go 实现一致，所以他们登得上。
    const long = "a".repeat(MAX_PASSWORD_BYTES + 10);
    const hash = await hashPassword(long.slice(0, MAX_PASSWORD_BYTES));

    await expect(verifyPassword(long, hash)).resolves.toBe(true);
  });
});

describe("burnVerificationTime", () => {
  it("★ 真的跑一次 bcrypt —— 否则「查无此人」比「密码错」快 60ms", async () => {
    // 时间抹平是**唯一**的目的：响应时间不能成为用户名枚举接口。
    // 断言用「耗时可观测」而不是精确毫秒——精确值在不同机器上会漂。
    const started = Date.now();
    await burnVerificationTime("whatever");

    // cost 10 的 bcrypt 是几十毫秒量级；10ms 是个宽松下界，
    // 足以区分「真的算了」和「直接 return」。
    expect(Date.now() - started).toBeGreaterThan(10);
  });

  it("连调两次都稳定返回（哑哈希只生成一次，不影响正确性）", async () => {
    await expect(burnVerificationTime("a")).resolves.toBeUndefined();
    await expect(burnVerificationTime("b")).resolves.toBeUndefined();
  });
});
