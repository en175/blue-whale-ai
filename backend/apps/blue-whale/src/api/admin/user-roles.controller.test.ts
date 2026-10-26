import { LastSuperAdminError } from "@lib/core/identity/roles.js";
import { SuperAdminGuard } from "@lib/infra/guard/super-admin.guard.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminUserRolesController } from "./user-roles.controller.js";


const OPERATOR = { userId: "1", username: "admin" } as never;

function createController(overrides: {
  listRoleCodes?: ReturnType<typeof vi.fn>;
  grantRole?: ReturnType<typeof vi.fn>;
  revokeRole?: ReturnType<typeof vi.fn>;
  logCreate?: ReturnType<typeof vi.fn>;
} = {}) {
  const identity = {
    listRoleCodes: overrides.listRoleCodes ?? vi.fn().mockResolvedValue([]),
    grantRole: overrides.grantRole ?? vi.fn().mockResolvedValue(undefined),
    revokeRole: overrides.revokeRole ?? vi.fn().mockResolvedValue(undefined),
  };
  const operationLog = {
    create: overrides.logCreate ?? vi.fn().mockResolvedValue(undefined),
  };
  return {
    controller: new AdminUserRolesController(identity as never, operationLog as never),
    identity,
    operationLog,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminUserRolesController", () => {
  it("列出该用户的角色", async () => {
    const { controller } = createController({
      listRoleCodes: vi.fn().mockResolvedValue(["user", "admin"]),
    });

    await expect(controller.list("7")).resolves.toEqual({
      success: true,
      data: { roles: ["user", "admin"] },
    });
  });

  it("userId 不是正整数 → 400，且不碰角色表", async () => {
    const { controller, identity } = createController();
    await expect(controller.list("abc")).rejects.toMatchObject({ status: 400 });
    expect(identity.listRoleCodes).not.toHaveBeenCalled();
  });

  it("授予角色后回显最新角色集", async () => {
    const listRoleCodes = vi.fn().mockResolvedValue(["user", "admin"]);
    const { controller, identity } = createController({ listRoleCodes });

    const result = await controller.grant(OPERATOR, "7", { code: "admin" }, "203.0.113.9");

    expect(identity.grantRole).toHaveBeenCalledWith("7", "admin", "1");
    expect(result).toEqual({ success: true, data: { roles: ["user", "admin"] } });
  });

  it("code 为空 → 400", async () => {
    const { controller, identity } = createController();
    await expect(controller.grant(OPERATOR, "7", {}, undefined)).rejects.toMatchObject({
      status: 400,
    });
    expect(identity.grantRole).not.toHaveBeenCalled();
  });

  it("★ 撤销最后一个超管 → 409，且提示说得清后果", async () => {
    const revokeRole = vi.fn().mockRejectedValue(new LastSuperAdminError());
    const { controller } = createController({ revokeRole });

    await expect(controller.revoke(OPERATOR, "7", "super_admin")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("无人能进入管理端"),
    });
  });

  it("撤销普通角色照常放行", async () => {
    const { controller, identity } = createController();

    await controller.revoke(OPERATOR, "7", "admin");

    expect(identity.revokeRole).toHaveBeenCalledWith("7", "admin");
  });

  it("授予 / 撤销都记操作日志（带 IP）", async () => {
    const { controller, operationLog } = createController();

    await controller.grant(OPERATOR, "7", { code: "admin" }, "203.0.113.9, 10.0.0.1");
    await controller.revoke(OPERATOR, "7", "admin", "203.0.113.9");

    expect(operationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.role_grant",
        targetUserId: "7",
        ipAddress: "203.0.113.9",
      }),
    );
    expect(operationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.role_revoke" }),
    );
  });

  it("日志写失败不阻断授撤（旁路）", async () => {
    const logCreate = vi.fn().mockRejectedValue(new Error("db down"));
    const { controller, identity } = createController({ logCreate });

    await expect(controller.grant(OPERATOR, "7", { code: "admin" })).resolves.toMatchObject({
      success: true,
    });
    expect(identity.grantRole).toHaveBeenCalled();
  });
});

describe("AdminUserRolesController 超管守卫声明", () => {
  function guardsOf(handler: (...args: never[]) => unknown): unknown[] {
    return (Reflect.getMetadata("__guards__", handler) as unknown[] | undefined) ?? [];
  }

  it("★ 授予与撤销都挂 SuperAdminGuard（普通管理员不可设角色）", () => {
    expect(guardsOf(AdminUserRolesController.prototype.grant)).toContain(SuperAdminGuard);
    expect(guardsOf(AdminUserRolesController.prototype.revoke)).toContain(SuperAdminGuard);
  });

  it("列出角色不要求超管（普通管理员可读）", () => {
    expect(guardsOf(AdminUserRolesController.prototype.list)).not.toContain(SuperAdminGuard);
  });
});
