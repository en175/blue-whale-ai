import { describe, expect, it } from "vitest";
import { sessionJwtSecret } from "./jwt-secret.js";

describe("sessionJwtSecret（登录凭证签名密钥）", () => {
  it("配了就取配的那把（两端空白不算）", () => {
    expect(
      sessionJwtSecret({
        SESSION_JWT_SECRET: "  configured-secret  ",
        NODE_ENV: "production",
      }),
    ).toBe("configured-secret");
  });

  it("★ 生产环境没配 → 抛，不回退默认值", () => {
    expect(() => sessionJwtSecret({ NODE_ENV: "production" })).toThrow(
      /SESSION_JWT_SECRET 必填/,
    );
  });

  it("★ 生产环境只配了空白 → 同样抛（别让空白串混过去）", () => {
    expect(() =>
      sessionJwtSecret({ SESSION_JWT_SECRET: "   ", NODE_ENV: "production" }),
    ).toThrow(/SESSION_JWT_SECRET 必填/);
  });

  it("非生产环境没配 → 回退到开发默认值，本地起服务不用多配一项", () => {
    expect(sessionJwtSecret({})).toBe("dev-only-unsafe-session-jwt-secret");
    expect(sessionJwtSecret({ NODE_ENV: "test" })).toBe(
      "dev-only-unsafe-session-jwt-secret",
    );
  });

  it("非生产环境配了也用配的那把（默认值只是兜底）", () => {
    expect(sessionJwtSecret({ SESSION_JWT_SECRET: "local-secret" })).toBe(
      "local-secret",
    );
  });
});
