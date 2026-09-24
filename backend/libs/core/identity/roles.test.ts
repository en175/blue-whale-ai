import { describe, expect, it } from "vitest";

import {
  ADMIN_ROLE_CODES,
  BUILTIN_ROLE_CODES,
  isAdmin,
  revokeWouldOrphanSuperAdmin,
  ROLE_ADMIN,
  ROLE_SUPER_ADMIN,
  ROLE_USER,
} from "./roles.js";

describe("isAdmin", () => {
  it("admin 与 super_admin 都是管理员", () => {
    expect(isAdmin([ROLE_ADMIN])).toBe(true);
    expect(isAdmin([ROLE_SUPER_ADMIN])).toBe(true);
  });

  it("普通用户不是管理员", () => {
    expect(isAdmin([ROLE_USER])).toBe(false);
  });

  it("空集合不是管理员", () => {
    expect(isAdmin([])).toBe(false);
  });

  it("认不出的角色不影响判定，但也绝不因此放行", () => {
    // 鉴权路径上的默认值只能是「拒绝」：反过来（默认放行、出错才拒绝）
    // 意味着一次数据异常就是一次越权。
    expect(isAdmin(["vip", "editor"])).toBe(false);
    expect(isAdmin(["vip", ROLE_ADMIN])).toBe(true);
  });

  it("多角色取并集——任一是管理员就是管理员", () => {
    expect(isAdmin([ROLE_USER, ROLE_ADMIN])).toBe(true);
  });

  it("是集合成员判定，不是等级比较", () => {
    // 老写法是 `role >= 10`。换成集合之后，新增一类管理员 = 往
    // ADMIN_ROLE_CODES 加一个 code，不必重新分配数字、不必担心谁比谁大。
    expect(ADMIN_ROLE_CODES).toEqual([ROLE_ADMIN, ROLE_SUPER_ADMIN]);
    // 三道内置角色里，管理员类恰好两席——多一个少一个都说明有人改了判定却忘了改这里
    expect(BUILTIN_ROLE_CODES.filter((code) => ADMIN_ROLE_CODES.includes(code))).toHaveLength(2);
  });
});

describe("revokeWouldOrphanSuperAdmin（不能把最后一个超管撤没了）", () => {
  it("撤掉最后一个超管的超管角色 → 拦", () => {
    expect(revokeWouldOrphanSuperAdmin(ROLE_SUPER_ADMIN, [ROLE_USER, ROLE_SUPER_ADMIN], 1)).toBe(
      true,
    );
  });

  it("还有别的超管 → 放行", () => {
    // 拦的是「最后一个」，不是「超管不能被碰」。留一个能进门的就够了。
    expect(revokeWouldOrphanSuperAdmin(ROLE_SUPER_ADMIN, [ROLE_SUPER_ADMIN], 2)).toBe(false);
  });

  it("★ 从超管身上撤别的角色 → 放行", () => {
    // 判定的第一个参数是**被撤销的角色**。若只看「目标是不是超管」，
    // 这条会被误拦——而它其实毫无风险：撤掉 admin 角色之后他仍然是超管。
    expect(revokeWouldOrphanSuperAdmin(ROLE_ADMIN, [ROLE_ADMIN, ROLE_SUPER_ADMIN], 1)).toBe(false);
    expect(revokeWouldOrphanSuperAdmin(ROLE_USER, [ROLE_USER, ROLE_SUPER_ADMIN], 1)).toBe(false);
  });

  it("目标本来就不是超管 → 放行", () => {
    expect(revokeWouldOrphanSuperAdmin(ROLE_SUPER_ADMIN, [ROLE_ADMIN], 1)).toBe(false);
    expect(revokeWouldOrphanSuperAdmin(ROLE_SUPER_ADMIN, [], 0)).toBe(false);
  });

  it("超管人数为 0（脏数据）时不拦——那是在撤一个并不持有超管角色的人", () => {
    expect(revokeWouldOrphanSuperAdmin(ROLE_SUPER_ADMIN, [ROLE_ADMIN], 0)).toBe(false);
  });
});
