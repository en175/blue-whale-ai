// 登录隔离（ADR-0080）：上游 HTTP 200+success:false 业务失败透传投影单测。
// login(401)/register(400) 共用，避免 toAuthError 的 status 映射吞掉业务文案。
import { describe, expect, it } from "vitest";

import { NewApiError } from "@lib/core";
import { projectAccountBusinessFailure } from "./auth-error.js";

describe("projectAccountBusinessFailure", () => {
  it("白名单拒绝（HTTP 200）→ 透传原文到指定状态（登录 401）", () => {
    const out = projectAccountBusinessFailure(
      new NewApiError("This account is not allowed to log into the current system", 200),
      401,
    );
    expect(out).toEqual(
      new NewApiError(
        "This account is not allowed to log into the current system",
        401,
        undefined,
      ),
    );
  });

  it("保留上游 code（如有）", () => {
    const out = projectAccountBusinessFailure(
      new NewApiError("账号未开通", 200, "not_allowed"),
      401,
    );
    expect(out?.code).toBe("not_allowed");
    expect(out?.message).toBe("账号未开通");
  });

  it("非 200 NewApiError → null，走 toAuthError 映射", () => {
    const out = projectAccountBusinessFailure(
      new NewApiError("bad gateway", 502),
      401,
    );
    expect(out).toBeNull();
  });

  it("非 NewApiError → null", () => {
    expect(projectAccountBusinessFailure(new Error("boom"), 401)).toBeNull();
    expect(projectAccountBusinessFailure("boom", 401)).toBeNull();
  });

  it("login 与 register 投影状态可分别指定", () => {
    const upstream = new NewApiError("用户名重复", 200);
    expect(projectAccountBusinessFailure(upstream, 401)?.status).toBe(401);
    expect(projectAccountBusinessFailure(upstream, 400)?.status).toBe(400);
  });
});
