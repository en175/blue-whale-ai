import { describe, expect, it } from "vitest";
import { parseBearerToken } from "./bearer-token.js";

describe("parseBearerToken（凭证分层，ADR-0062 #19）", () => {
  it("解析 AuthGuard 回注后的上游执行凭证 sk-", () => {
    expect(parseBearerToken("Bearer sk-abc123")).toBe("sk-abc123");
  });

  it("拒绝会话令牌 sess_（登录态走 cookie，不入请求头）", () => {
    expect(parseBearerToken("Bearer sess_abc123")).toBeNull();
  });

  it("拒绝缺失/空/非 Bearer 头", () => {
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken("")).toBeNull();
    expect(parseBearerToken("Basic abc")).toBeNull();
    expect(parseBearerToken("Bearer ")).toBeNull();
  });
});
