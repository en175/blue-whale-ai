/* ============================================
 * 身份域的**公开面** —— 域外只能从这里进来
 *
 * <h2>为什么需要它</h2>
 *
 * 在它之前，「identity 对外提供什么」这个问题没有答案，只有各个调用方**实际 import 了什么**：
 * 认证控制器从 `@lib/shared/persistence/identity-user-repo.js` 取 `UsernameTakenError`，
 * 账号域从 `@lib/shared/identity/password.js` 取 `PasswordPolicyError`——
 * 都是**深进实现文件**。于是边界是一条虚线：哪天 identity 拆分或换进程，
 * 断掉的 import 散落在四个域里，得逐个找。
 *
 * <h2>它是什么、不是什么</h2>
 *
 * **是**：`IdentityService` 的契约声明 —— 入口（service/module）、它的返回类型、
 * 它**会抛出的**错误类型（调用方必须能 `instanceof` 判别）、以及公开方法的入参类型。
 *
 * **不是**：identity 的持久化实现（`@lib/shared/persistence/identity-*-repo.js`
 * 那五个文件）与口令算法细节。repo 是 identity 的**内部**（所以它们从来不在
 * persistence 的 barrel 里），口令哈希的唯一入口是 `identity.service`；
 * `BCRYPT_COST` / `MAX_PASSWORD_BYTES` 这类常量域外不需要，故不在这里出现。
 *
 * <h2>⚠️ 这里出现的错误类型是异步边界上的</h2>
 *
 * `UsernameTakenError` / `UnknownRoleError` 目前定义在持久化实现里，本文件**转发**它们。
 * 这是刻意的过渡形态：它们在领域里的身份是「register / grantRole 的失败原因」，
 * 调用方只该经本文件拿到。将来 identity 换进程时，判别从 `instanceof` 换成契约里的错误码，
 * **改动收敛在本文件与各调用点的那一处判别**——而不是连 import 路径都要重新找一遍。
 *
 * <p>`@lib/core/identity` 是纯函数（角色判定与等级解析），它属于本域、随本域一起搬；
 * 这里只转发调用方**必须**用到的 `LastSuperAdminError`（`revokeRole` 的抛出）与 `Tier`
 * （`resolveTier` 的返回），不把整个纯函数模块再倒一遍——那样同一个符号会有两条获取路径。
 * ============================================ */
export { IdentityModule } from "./identity.module.js";
export {
  IdentityService,
  InvalidCredentialsError,
  type LocalLoginResult,
} from "./identity.service.js";
/* 口令策略的失败原因。⚠️ `hashPassword` / `verifyPassword` / `burnVerificationTime`
 *  **不在这里**：它们的唯一调用方是 `IdentityService`，口令的读写只能经服务——
 *  在域外再开一个哈希入口，等于把「注册用什么 cost、改密用什么规则」分回两处。 */
export { PasswordPolicyError } from "./password.js";

/* 身份域的纯规则（`@lib/core/identity`）：只转发调用方绕过不掉的符号。 */
export { LastSuperAdminError } from "@lib/core/identity/roles.js";
export type { Tier } from "@lib/core/identity/tier.js";

/* ⚠️ 下面两组是**实现型的失败原因**，由持久化实现抛出、经 `IdentityService` 冒泡给调用方
 *    （见各方法 JSDoc 的 `@throws`）。它们不属于调用方，只是调用方必须能判别。 */
export { UnknownRoleError } from "@lib/shared/persistence/identity-role-repo.js";
export {
  UsernameTakenError,
  USER_STATUS_DISABLED,
  USER_STATUS_NORMAL,
  type IdentityUserStatus,
} from "@lib/shared/persistence/identity-user-repo.js";
export type {
  AdminUserListOptions,
  AdminUserRow,
} from "@lib/shared/persistence/admin-user-query.js";
