/**
 * 角色判定 —— 替代 `auth.guard.ts` 里的 `role >= 10` 魔数。
 *
 * <h2>为什么是集合成员，不是数值阈值</h2>
 *
 * 老的写法把「是不是管理员」压成一个数字比较。它有三个说不清的地方：
 * 10 是什么、谁定的、新增一个「比 10 小的管理员」该怎么办。
 * 而真正的问题从来不是「等级够不够高」，是「**有没有这个权限**」——
 * 那是集合成员问题：持有 `admin` 或 `super_admin` 就是管理员。
 *
 * <p>换成集合之后，「新增一个能进后台的角色」= 往 {@link ADMIN_ROLE_CODES} 加一个 code，
 * 不必重新分配数字、不必担心谁比谁大。
 *
 * <p>⚠️ 与 `tier`（会员等级，见 `./tier.ts`）是**两回事**：
 * tier 决定**花多少钱**（折扣），role 决定**能做什么**（权限）。
 * 把 tier 当 role 用会让付费用户获得后台权限，反之会让管理员白丢折扣。
 */

/** 登录即有的基础角色。 */
export const ROLE_USER = "user";
/** 可访问管理端接口。 */
export const ROLE_ADMIN = "admin";
/** 可访问管理端接口，并管理他人角色。 */
export const ROLE_SUPER_ADMIN = "super_admin";

/** 内置角色，与 migration 20260924200000 的种子行一一对应。 */
export const BUILTIN_ROLE_CODES: readonly string[] = [ROLE_USER, ROLE_ADMIN, ROLE_SUPER_ADMIN];

/**
 * 持有其中**任意一个**即为管理员。
 *
 * <p>要新增一类管理员，往这里加 code 即可——这是唯一的改动点。
 */
export const ADMIN_ROLE_CODES: readonly string[] = [ROLE_ADMIN, ROLE_SUPER_ADMIN];

/**
 * 该角色集合是否具备管理员权限。
 *
 * <p><b>默认拒绝</b>：认不出的 code、空的角色集合、角色行被软删导致的悬空 role_id，
 * 一律判为不是管理员。鉴权路径上的默认值只能是「拒绝」——
 * 反过来（默认放行、出错才拒绝）意味着一次数据异常就是一次越权。
 */
export function isAdmin(roleCodes: readonly string[]): boolean {
  return roleCodes.some((code) => ADMIN_ROLE_CODES.includes(code));
}
