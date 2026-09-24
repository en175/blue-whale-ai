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

/** 该角色集合里有没有超级管理员。 */
export function isSuperAdmin(roleCodes: readonly string[]): boolean {
  return roleCodes.includes(ROLE_SUPER_ADMIN);
}

/**
 * 这次撤销会不会让系统失去**最后一个**超级管理员？
 *
 * <p>对应 geekai 里那条 `manager.Username != SuperUsername && !manager.Status`——
 * 它硬编码了一个用户名（`const SuperUsername = "admin"`）来保证「超管踢不掉」。
 * 我们把它做成**数据判定**：看的是「持有 `super_admin` 的人还剩几个」，
 * 而不是某个固定用户名。这样换人不需要改代码，也支持多个超管互相兜底。
 *
 * <p>⚠️ 拦的是「撤掉 `super_admin` 这最后一个持有者」，不是「超管不能被碰」：
 * 从超管身上撤销**别的**角色（比如 `admin`）不受影响。所以判定的第一个参数是
 * **被撤销的角色**，而不是被操作者。只有一个超管时，撤它的超管角色才锁死；
 * 有两个的时候随你撤——留一个能进门的就够了。
 *
 * <p>放在纯函数里而不是写在 controller 里，是因为它是一条**不该被绕过**的规则：
 * 将来做批量授撤、脚本、或别的入口，都得走同一个判定。
 *
 * @param roleBeingRevoked      这次要撤销的角色 code
 * @param targetRoleCodes       被操作者当前持有的角色
 * @param superAdminHolderCount 全系统持有 super_admin 的人数（**含被操作者**）
 */
export function revokeWouldOrphanSuperAdmin(
  roleBeingRevoked: string,
  targetRoleCodes: readonly string[],
  superAdminHolderCount: number,
): boolean {
  return (
    roleBeingRevoked === ROLE_SUPER_ADMIN &&
    isSuperAdmin(targetRoleCodes) &&
    superAdminHolderCount <= 1
  );
}

/**
 * 这次操作会撤掉系统里最后一个超级管理员。
 *
 * <p>单独成一个错误类型而不是抛通用的「参数非法」：它不是「你传错了」，
 * 是「这么做完之后没人能进管理端了」。调用方要能把它翻成一个**说人话**的提示，
 * 否则运维看到「参数错误」只会换个参数再试一次。
 */
export class LastSuperAdminError extends Error {
  constructor() {
    super("系统必须保留至少一个超级管理员：这是最后一个，撤销后将无人能进入管理端");
    this.name = "LastSuperAdminError";
  }
}
