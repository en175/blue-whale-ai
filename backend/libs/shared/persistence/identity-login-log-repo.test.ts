import { describe, expect, it, vi } from "vitest";

import { createIdentityLoginLogRepo } from "./identity-login-log-repo.js";
import {
  OPERATION_STATUS_FAILED,
  OPERATION_STATUS_SUCCEEDED,
} from "./operation-log-repo.js";

function build() {
  const create = vi.fn(
    async (args: { data: Record<string, unknown> }) => ({
      id: 1n,
      ...args.data,
      gmt_create: new Date("2026-10-28T00:00:00.000Z"),
      gmt_modified: new Date("2026-10-28T00:00:00.000Z"),
      version: 0,
      is_delete: 0,
    }),
  );
  const prisma = { bw_operation_logs: { create } } as never;
  return { repo: createIdentityLoginLogRepo(prisma), create };
}

function created(create: ReturnType<typeof build>["create"]) {
  return create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
}

describe("identity-login-log-repo（登录日志并入操作日志）", () => {
  it("登录成功写 auth 类别，手机号脱敏", async () => {
    const { repo, create } = build();

    await repo.record({
      userId: "42",
      username: "13800001234",
      ip: "1.2.3.4",
      userAgent: "ua",
      success: true,
    });

    const { data } = created(create);
    expect(data).toMatchObject({
      category: "auth",
      action: "login_success",
      target: "138****1234",
      operator: "138****1234",
      target_user_id: 42n,
      operator_id: 42n,
      status: OPERATION_STATUS_SUCCEEDED,
    });
    expect(JSON.parse(String(data.detail))).toMatchObject({
      success: true,
      user_agent: "ua",
    });
  });

  it("登录失败保留非手机号标识并记录原因", async () => {
    const { repo, create } = build();

    await repo.record({
      username: "alice",
      ip: "1.2.3.4",
      userAgent: "",
      success: false,
      reason: "账密错误",
    });

    const { data } = created(create);
    expect(data).toMatchObject({
      action: "login_failed",
      target: "alice",
      target_user_id: null,
      status: OPERATION_STATUS_FAILED,
    });
    expect(JSON.parse(String(data.detail))).toMatchObject({
      success: false,
      reason: "账密错误",
    });
  });
});
