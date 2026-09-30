import { Injectable } from "@nestjs/common";

import type { Tier } from "@lib/core/identity/tier.js";
import {
  LastSuperAdminError,
  revokeWouldOrphanSuperAdmin,
  roleRank,
  ROLE_SUPER_ADMIN,
  ROLE_USER,
} from "@lib/core/identity/roles.js";
import { createLogger } from "@lib/core/logging";
import { createIdentityLoginLogRepo } from "@lib/shared/persistence/identity-login-log-repo.js";
import { createAdminUserQuery, type AdminUserListOptions } from "@lib/shared/persistence/admin-user-query.js";
import { createIdentityMembershipRepo } from "@lib/shared/persistence/identity-membership-repo.js";
import { createIdentityRoleRepo } from "@lib/shared/persistence/identity-role-repo.js";
import {
  createIdentityUserRepo,
  USER_STATUS_NORMAL,
  type IdentityUserStatus,
} from "@lib/shared/persistence/identity-user-repo.js";
import {
  burnVerificationTime,
  hashPassword,
  verifyPassword,
} from "@lib/shared/identity/password.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/**
 * 本地登录的结果，形状对齐会话 payload（role/status 是数值）。
 *
 * <p>⚠️ 这里**没有令牌字段**。老的登录结果是「那个用户自己的 new-api sk-」，
 * 而 new-api 独立成上游之后，我们手上只有一把项目级的统一 key——
 * 它属于部署配置，不属于某个人的登录结果。会话凭证由
 * {@code SessionService} 自己签发（`sess_` 不透明令牌）。
 */
export interface LocalLoginResult {
  userId: number;
  username: string;
  email: string | null;
  /** 由角色集合折算的数值档位（见 `roleRank`），只为兼容既有会话与前端口径 */
  role: number;
  /** 1 = 启用 / 0 = 停用，与 `auth.guard.ts` 的 ENABLED_STATUS 一致 */
  status: number;
}

/**
 * 账号或口令不正确。
 *
 * <p>⚠️ **用户名不存在与口令错误共用这一个错误**，调用方必须原样透传。
 * 分开报「该用户不存在」等于免费送出一份有效用户名清单——
 * 而拿到这份清单正是撞库的第一步。
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super("用户名或密码错误");
    this.name = "InvalidCredentialsError";
  }
}

/**
 * 用户身份域的对内入口 —— 三件事：**等级（花多少钱）、角色（能做什么）、登录留痕**。
 *
 * <h2>为什么这一层存在，而不是让调用方直接用 repo</h2>
 *
 * 「认不出的等级」必须被看见。repo 与纯函数都刻意把脏值**原样往上报**而不自己记日志
 * （纯函数不该有副作用），汇聚与留痕放在这里——一处收敛，所有调用方自动获得可观测性。
 *
 * <p>反过来，如果每个调用方各自处理，就会出现「有的地方记了、有的地方吞了」，
 * 而吞掉的那一处正是用户投诉「我升了级却没打折」时最难查的。
 *
 * <p>⚠️ 等级与角色是**两回事**，见 {@code @lib/core/identity/roles.ts}：
 * 一个决定折扣，一个决定权限。这里放在一起只是因为它们同属身份域。
 */
@Injectable()
export class IdentityService {
  private readonly logger = createLogger("identity");
  private readonly memberships;
  private readonly roles;
  private readonly loginLogs;
  private readonly adminUsers;
  private readonly users;

  constructor(prisma: PrismaService) {
    this.memberships = createIdentityMembershipRepo(prisma.client);
    this.roles = createIdentityRoleRepo(prisma.client);
    this.loginLogs = createIdentityLoginLogRepo(prisma.client);
    this.adminUsers = createAdminUserQuery(prisma.client);
    this.users = createIdentityUserRepo(prisma.client);
  }

  /**
   * 口令登录 —— **查我们自己的库**，不再转发给 new-api。
   *
   * <h2>为什么必须切</h2>
   *
   * new-api 从「我们的用户体系提供方」变成「带一把统一 key 的上游供应商」，
   * 它那边不再有我们的用户。继续转发的话，它独立的那天所有人一起登不上。
   *
   * <h2>三条刻意的行为</h2>
   *
   * <ul>
   *   <li><b>用户不存在也要烧掉一次 bcrypt</b>：否则「查无此人」比「密码错」快 60ms，
   *       响应时间就成了一个用户名枚举接口。</li>
   *   <li><b>没有口令的账号一律登不上</b>：`bw_users.password` 允许为 null
   *       （手机号注册、以及刚从 new-api 迁来还没设口令的行）。把 null 当作
   *       「都能登」是把一个数据状态变成一次越权。</li>
   *   <li><b>停用账号照常返回身份</b>，由 Guard 拦。登录处判状态会多一份判定，
   *       而两份判定迟早有一份忘了改——一处拦，就一处生效。</li>
   * </ul>
   *
   * @throws InvalidCredentialsError 账号不存在 / 无口令 / 口令不匹配
   */
  async login(input: { username: string; password: string }): Promise<LocalLoginResult> {
    const user = await this.users.findByLoginName(input.username);

    if (!user) {
      // 时间抹平：正常路径在这里已经跑过一次 bcrypt 了，两条路径必须一样慢
      await burnVerificationTime(input.password);
      throw new InvalidCredentialsError();
    }

    if (!(await verifyPassword(input.password, user.password))) {
      throw new InvalidCredentialsError();
    }

    return {
      userId: Number(user.id),
      username: user.username,
      email: user.email,
      role: roleRank(await this.roles.listRoleCodes(user.id)),
      status: user.status === "NORMAL" ? 1 : 0,
    };
  }

  /**
   * 注册 —— 同样落**我们自己的库**。
   *
   * <h2>为什么登录切了、注册也必须跟着切</h2>
   *
   * 只切一半是最糟的状态：新用户注册进的是 new-api 的库，而我们登录查的是
   * `bw_users`——**注册完立刻登不上**，且报的还是「用户名或密码错误」，
   * 用户只会以为自己记错了密码。
   *
   * <h2>口令策略的最小集</h2>
   *
   * 只做两件事：**非空**、**不超过 bcrypt 的 72 字节**（见 `password.ts`，
   * 超了会被算法悄悄截断，用户以为设了 80 位而实际只有 72 位有效）。
   * 复杂度规则（大小写/符号）不做：它们把用户推向 `Passw0rd!` 这类可预测的口令，
   * 收益远不如长度。真要提升强度应该上强度表，而不是加字符集要求。
   *
   * @throws UsernameTakenError 用户名已被占用
   * @throws PasswordPolicyError 口令超长
   */
  async register(input: {
    username: string;
    password: string;
    email?: string | undefined;
  }): Promise<LocalLoginResult> {
    const passwordHash = await hashPassword(input.password);
    const created = await this.users.create({
      username: input.username,
      passwordHash,
      email: input.email ?? null,
    });

    // 显式授予内置的 user 角色。
    //
    // ⚠️ 不授也能用（`roleRank([])` 也是 1），但那样「这个用户有哪些角色」在两个
    //    用户之间就有了两种表示（[] 与 ['user']），而角色列表是要拿来做权限判定的。
    //    统一成一条基线，将来加「批量授权」「按角色查人」时才不会漏掉这一批。
    //    失败不阻断注册：角色行缺失只影响将来的扩展权限，不影响登录与生成。
    try {
      await this.roles.grant(created.id, ROLE_USER, "self-register");
    } catch (error) {
      this.logger.error(
        `注册后授予 ${ROLE_USER} 角色失败（用户 ${created.id}）：` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      userId: Number(created.id),
      username: created.username,
      email: created.email,
      role: roleRank(await this.roles.listRoleCodes(created.id)),
      status: 1,
    };
  }

  /**
   * 修改口令 —— 校验原密码后写**我们自己的库**（`bw_users.password`）。
   *
   * <h2>为什么不再转发 new-api</h2>
   *
   * 原先这条走网关的 `PUT /api/user/self`，而会话里能回注的只有那把**项目级统一
   * key**——等于拿一把跟这个用户无关的凭证去校验「原密码」。new-api 独立之后
   * 那边更没有我们的用户，这条链路整个消失。
   *
   * <p>两处刻意：**先验原密码、再判新口令策略**（原密码就不对时，不该顺带告诉
   * 调用方新口令合不合规）；以及原密码错误只报 {@link InvalidCredentialsError}——
   * 与 {@link login} 同口径，不区分「账号没设过口令」和「密码错」。
   *
   * @throws InvalidCredentialsError 用户不存在 / 账号没有口令 / 原密码不匹配
   * @throws PasswordPolicyError 新口令超过 bcrypt 的 72 字节上限
   */
  async changePassword(
    userId: string | number,
    input: { oldPassword: string; newPassword: string },
  ): Promise<void> {
    const user = await this.users.findById(String(userId));
    if (!user || !(await verifyPassword(input.oldPassword, user.password))) {
      throw new InvalidCredentialsError();
    }
    // hashPassword 内部做策略判定（超长即拒，不截断），失败时一个字节都不会落库。
    const passwordHash = await hashPassword(input.newPassword);
    await this.users.updatePassword(String(userId), passwordHash);
  }

  /**
   * 管理端用户列表 —— 读我们自己的库。
   *
   * <p>原先这条转发给 new-api，导致「管理员」有两个概念：进不进得了管理端看我们的角色表，
   * 查不查得到列表看 new-api 的 role。new-api 独立后后者消失，列表会直接断。
   */
  async listAdminUsers(options: AdminUserListOptions) {
    return this.adminUsers.listAdminUsers(options);
  }

  /**
   * 管理端用户**总数** —— 只数，不取列表、不碰计费。
   *
   * <p>给仪表盘用。原先它调 {@link #listAdminUsers} 再读 `total`：那会顺带跑整个列表
   * 查询与角色批量查询，IKJ5M7 之后还会多一次计费调用 —— 于是**计费不可达会把
   * 「总用户数」一起带走**，而 `DashboardService#stats` 的注释恰好写着计费那趟的失败
   * 不该影响另外几个数。这条入口把那个耦合彻底断掉。
   */
  async countAdminUsers(): Promise<number> {
    return this.adminUsers.countAdminUsers();
  }

  /**
   * 关键词 → 一个 userId（**精确**）。给积分记录页用：账本只认 `user_id`，
   * 而运营手上只有手机号或昵称。
   *
   * <p>与 {@link #listAdminUsers} 的模糊关键词刻意分开：那边多命中几行是正常的，
   * 这边必须是一个人或没有人——billing 那条 rpc 只收一个 `user_id`。
   */
  async findAdminUserIdByKeyword(keyword: string) {
    return this.adminUsers.findUserIdByKeyword(keyword);
  }

  /** 按 userId 批量取昵称 / 手机号，给积分记录页回填展示用。 */
  async loadAdminUserIdentities(userIds: readonly number[]) {
    return this.adminUsers.loadUserIdentities(userIds);
  }

  /**
   * 冻结 / 解冻账号 —— 写 `bw_users.status`。
   *
   * <p>原先这条和「加扣余额」挤在 new-api 的同一个 manage 接口里。new-api 独立后
   * 这两件事必须分开：**状态是我们自己的账号属性，余额是计费域的事**——
   * 所以这里只做前者，也不再需要一个上游凭证。
   *
   * @returns 目标用户不存在时 false（调用方应回 404，而不是静默成功）
   */
  async setUserStatus(
    userId: string | number,
    status: IdentityUserStatus,
  ): Promise<boolean> {
    return this.users.updateStatus(String(userId), status);
  }

  /** 该用户持有的角色 code（已排除软删的角色行）。 */
  async listRoleCodes(userId: string | number): Promise<string[]> {
    return this.roles.listRoleCodes(String(userId));
  }

  /**
   * 该用户是否存在（软删的不算）—— 供**下游不认识我们用户表**的写操作先做归属校验。
   *
   * <p>为什么需要单独一个：冻结/解冻自带这层保护（`setUserStatus` 找不到就返回 false），
   * 因为它们写的就是 `bw_users` 自己。而发积分写的是 **billing 的库**，那边压根没有
   * 用户表（只有批次 / 账本 / 预留三张）—— 给一个不存在的 userId 发放，它照样收下，
   * 造出一个谁都花不到、也追不回的批次。打错一位 id 与「刻意发给某人」在那边长得一样。
   */
  async userExists(userId: string | number): Promise<boolean> {
    return (await this.users.findById(String(userId))) !== null;
  }

  /** 是否具备管理员权限（持有 admin / super_admin 中任意一个）。 */
  async isAdmin(userId: string | number): Promise<boolean> {
    return this.roles.isAdmin(String(userId));
  }

  /**
   * 会话复核用的授权状态快照：角色档位（`roleRank`）+ 账号状态（1 启用 / 0 停用）。
   *
   * <h2>为什么不直接用会话里那份</h2>
   *
   * 会话里的 role/status 是**登录那一刻**的快照。停用一个账号、或撤掉一个人的管理员角色，
   * 不能让对方一直用到会话自然过期（最长 7 天），所以超时后要回源权威表复核。
   *
   * <p>⚠️ **判据只能是我们自己的库**。曾经的实现是拿会话里的 key 去问 new-api
   * 「这把 key 的属主是谁」。那把 key 现在是**项目级统一 key**，返回的是统一 key 属主
   * 一个人的 role/status——所有用户会塌缩成同一个账号的值，那位属主被禁用就是全站 403。
   *
   * <p>用户不存在（或已软删）时返回「停用 + 普通角色」而不是抛错：抛错会被调用方
   * 当作「身份库不可达」而沿用缓存里的旧状态，于是一个已被删除的账号反而能继续用。
   */
  async resolveAccessState(
    userId: string | number,
  ): Promise<{ role: number; status: number }> {
    const user = await this.users.findById(String(userId));
    if (!user) return { role: roleRank([]), status: 0 };
    return {
      role: roleRank(await this.roles.listRoleCodes(user.id)),
      status: user.status === USER_STATUS_NORMAL ? 1 : 0,
    };
  }

  /** 授予角色。角色 code 不存在时由 repo 抛 {@link UnknownRoleError}。 */
  async grantRole(userId: string | number, code: string, grantedBy: string): Promise<void> {
    await this.roles.grant(String(userId), code, grantedBy);
  }

  /**
   * 撤销角色。
   *
   * @throws LastSuperAdminError 会撤掉系统里最后一个超级管理员——**删掉之后就没人能进管理端了**
   */
  async revokeRole(userId: string | number, code: string): Promise<void> {
    const targetRoles = await this.roles.listRoleCodes(String(userId));
    // 判定用纯函数（见 roles.ts）：规则只有一处定义，将来做批量授撤、脚本、
    // 或别的入口时都走同一个判定，不会各写一份。
    if (revokeWouldOrphanSuperAdmin(code, targetRoles, await this.roles.countHolders(ROLE_SUPER_ADMIN))) {
      throw new LastSuperAdminError();
    }
    await this.roles.revoke(String(userId), code);
  }

  /**
   * 记一条登录日志。
   *
   * <p>⚠️ **写失败不阻断登录**——日志是旁路。但调用方要 catch 并记 error，
   * 别让它静默消失：一个坏掉的日志表不该表现为「一切正常」。
   */
  async recordLogin(entry: {
    // ⚠️ 可选属性显式带 `| undefined`：本仓开了 `exactOptionalPropertyTypes`，
    //    不加的话调用方传一个可能为 undefined 的值（如未取的 @Headers）就编译不过。
    userId?: string | null | undefined;
    username: string;
    ip: string;
    userAgent: string;
    success: boolean;
    reason?: string | undefined;
  }): Promise<void> {
    await this.loginLogs.record(entry);
  }

  /**
   * 用户的当前会员等级；无有效会员时返回 `free`。
   *
   * @param now 判定时刻。默认取当前时间，**测试与批处理应显式传入**——
   *            同一批处理里的「现在」必须是一个值。
   */
  async resolveTier(userId: string | number, now: Date = new Date()): Promise<Tier> {
    const resolution = await this.memberships.resolveTier(String(userId), now);

    if (resolution.unknownTiers.length > 0) {
      // 不静默：此刻这个用户正被当成 free，而根源是库里的脏数据。
      // 等级是计费折扣的输入，少给权益与多给钱都要有人知道。
      this.logger.error(
        `用户 ${userId} 的会员周期含认不出的等级 [${resolution.unknownTiers.join(", ")}]，` +
          `本次按 ${resolution.tier} 处理（该用户此刻可能被少给权益）`,
      );
    }

    return resolution.tier;
  }
}
