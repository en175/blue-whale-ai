import { describe, expect, it } from "vitest";
import { NewApiError } from "@blue-whale/core";

import {
  authenticationErrorResponse,
  userCredentialRequiredResponse,
} from "./bff";
import { adminErrorResponse } from "@/lib/admin/response";
import {
  USER_AUTH_FAILURE_HEADER,
  USER_AUTH_FAILURE_VALUE,
} from "@/lib/auth/session-failure";

// IK8N1S：只有「用户凭证失效」的 401 才带标记；前端凭标记决定是否登出。
describe("用户会话失效标记（IK8N1S）", () => {
  it("authenticationErrorResponse 401 带标记", () => {
    const response = authenticationErrorResponse(401);
    expect(response.status).toBe(401);
    expect(response.headers.get(USER_AUTH_FAILURE_HEADER)).toBe(
      USER_AUTH_FAILURE_VALUE,
    );
  });

  it("authenticationErrorResponse 403/502/503 不带标记", () => {
    for (const status of [403, 502, 503] as const) {
      expect(authenticationErrorResponse(status).headers.get(USER_AUTH_FAILURE_HEADER)).toBeNull();
    }
  });

  it("userCredentialRequiredResponse 带标记", () => {
    const response = userCredentialRequiredResponse("缺少登录凭证");
    expect(response.status).toBe(401);
    expect(response.headers.get(USER_AUTH_FAILURE_HEADER)).toBe(
      USER_AUTH_FAILURE_VALUE,
    );
  });

  it("adminErrorResponse 透传 new-api 401 时带标记", () => {
    const response = adminErrorResponse(new NewApiError("invalid", 401));
    expect(response.status).toBe(401);
    expect(response.headers.get(USER_AUTH_FAILURE_HEADER)).toBe(
      USER_AUTH_FAILURE_VALUE,
    );
  });

  it("adminErrorResponse 其他状态不带标记", () => {
    const response = adminErrorResponse(new NewApiError("boom", 500));
    expect(response.status).toBe(500);
    expect(response.headers.get(USER_AUTH_FAILURE_HEADER)).toBeNull();
  });
});
