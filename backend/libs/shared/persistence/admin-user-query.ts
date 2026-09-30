import type { PrismaClient } from "@prisma/client";

import { createLogger } from "@lib/core/logging";
import { fetchAdminUserStats } from "@lib/shared/billing/billing-admin-client.js";
import { roleRank } from "@lib/core/identity/roles.js";

const log = createLogger("admin-user-query");

/**
 * 管理端用户列表 —— **读我们自己的库**，不再转发给 new-api。
 *
 * <h2>为什么必须切</h2>
 *
 * 原实现把这条请求转发给 new-api 的 admin API。new-api 独立之后那边不再有用户概念，
 * 这条链路会直接断；而且它要求「调用者在 new-api 那边也是管理员」——于是出现
 * 一个荒唐的状态：`lxq1234` 在我们这有 `super_admin`，却因为 new-api 说它不是管理员
 * 而看不到用户列表。**管理端不该有两个管理员概念。**
 *
 * <h2>余额三列来自 billing（IKJ5M7 回填）</h2>
 *
 * `balance` / `totalRecharge` / `totalSpend` 属于计费域，从前这里是硬编码的 0
 * （注释写着「等计费接上再回填」）。现在接上了：**一页问一次** `AdminQueryUserStats`
 * （批量接口，不是逐用户调——那才是 N+1），口径逐条写在那条 rpc 的契约注释里。
 *
 * ⚠️ **不回落成 0**：billing 不可达时本方法**抛错**，整个用户列表跟着报错。理由见
 * {@link fetchAdminUserStats} —— 回落成 0 会让「计费挂了」与「这个用户真的没积分」
 * 在界面上长得**一模一样**，而「三列全是 0」正是这次要消灭的那个症状。
 * 用户列表是管理端读自己家库、顺手展示计费数据的页面；宁可它报错，也不要它撒谎。
 */
export interface AdminUserRow {
  userId: number;
  nickname: string;
  phone: string;
  balance: number;
  totalRecharge: number;
  totalSpend: number;
  /** 1 普通用户 / 10 管理员 / 100 超级管理员 —— 由我们自己的角色 code 映射而来 */
  role: number;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserListOptions {
  keyword?: string;
  status?: number;
  page?: number;
  pageSize?: number;
}

/** 一个用户的**展示身份**：只有界面上用来认人的两样东西。 */
export interface AdminUserIdentity {
  /** 界面上的「昵称」——**就是 `bw_users.username`**，与 {@link AdminUserRow.nickname} 同一口径 */
  nickname: string;
  /** 空串 = 没有。存量用户没手机号（见 `schema.prisma` 里 `phone` 那段注释），这是常态不是异常 */
  phone: string;
}

export interface AdminUserQuery {
  listAdminUsers(options: AdminUserListOptions): Promise<{ items: AdminUserRow[]; total: number }>;
  /**
   * 按关键词**精确定位一个用户**，返回其 userId；查不到返回 `undefined`。
   *
   * <p>与 {@link #listAdminUsers} 的 `keyword` 有两点不同，都是为了给**账本**用：
   * 那边是模糊匹配（给运营翻列表，多命中几行没关系）；这里必须收敛到**唯一一个人**——
   * 积分记录按 `user_id` 过滤，而 billing 那条 rpc 只收这一个参数，多命中就没法查。
   */
  findUserIdByKeyword(keyword: string): Promise<number | undefined>;
  /**
   * 按 userId **批量**取展示身份（昵称 / 手机号）。
   *
   * <p>查不到的 id **不出现在 Map 里**。这个形状保留了「这个用户查不到」与「他有用户、
   * 只是没手机号」的分别（`AdminUserIdentity.phone` 用空串表示后者），是因为批量接口
   * 不该替调用方决定怎么显示；**积分记录那个唯一的调用方把两者都渲染成同一格「—」**，
   * 那是有意为之，不是把这里的分辨力浪费掉了。
   */
  loadUserIdentities(userIds: readonly number[]): Promise<Map<number, AdminUserIdentity>>;
  /**
   * **只数用户总数**，不取列表。
   *
   * <p>给不需要行的调用方（仪表盘的「总用户数」）。它原先调 `listAdminUsers` 再读 `total`，
   * 代价是顺带跑完整个列表查询与角色批量查询 —— IKJ5M7 之后还会多一次**计费调用**，
   * 于是计费不可达会把「总用户数」一起带走（见 `countAdminUsers` 实现处的注释）。
   */
  countAdminUsers(): Promise<number>;
}

/**
 * 用户列表的**基线条件**（不含任何筛选）—— 列表与计数共用同一个。
 *
 * <p>刻意提出来而不是各写一遍：两处一旦分叉（比如给列表加了新过滤却忘了给计数加），
 * 仪表盘的「总用户数」与用户列表翻到底的行数就会对不上，而两边看起来都正常。
 */
const BASE_WHERE = { is_delete: false } as const;

/** 真实用户 id 的最大位数。`bw_users.id` 是 BIGINT（19 位封顶），留一位余量。 */
const MAX_USER_ID_DIGITS = 18;

/**
 * 这个关键词该不该当成用户 ID 去精确匹配。
 *
 * <p>整串是数字**且不超过 {@link MAX_USER_ID_DIGITS} 位**。长度那条不是洁癖：
 * `BigInt()` 咽得下任意长的数字串，而这种关键词只会来自搜索框里粘错的东西，
 * 真拿去查 BIGINT 列，要么驱动层报错、要么一条都查不到 —— 两种都不是
 * 「没有这个用户」该有的表现。
 */
function isUserIdKeyword(keyword: string): boolean {
  return keyword.length <= MAX_USER_ID_DIGITS && /^\d+$/.test(keyword);
}

export function createAdminUserQuery(prisma: PrismaClient): AdminUserQuery {
  return {
    async countAdminUsers() {
      // 只查总用户数，**不碰计费** —— 仪表盘只要这一个数，没必要为它拉一页用户、
      // 也没道理让计费不可达把仪表盘上另外四个数与它一起带走。
      return prisma.bw_users.count({ where: BASE_WHERE });
    },

    async listAdminUsers({ keyword, status, page = 1, pageSize = 100 }) {
      const where = {
        ...BASE_WHERE,
        // status: 1 = 启用（我们库里存 'NORMAL'）；0 = 禁用
        // 本仓开了 exactOptionalPropertyTypes：不能给 ?: 属性传 undefined，只能条件展开
        ...(status === undefined ? {} : { status: status === 1 ? "NORMAL" : "DISABLED" }),
        ...(keyword
          ? {
              OR: [
                { username: { contains: keyword } },
                { phone: { contains: keyword } },
                // ★ 关键词**整串是数字**时再按用户 ID 精确匹配一次 —— 搜索框的
                //   placeholder 承诺了「用户 ID」，少了这条那句承诺就是假的。
                //
                //   ⚠️ 这里用**等值**而不是 contains：敲一个数字，运营想要的是
                //      「这个用户」，不是「ID 里带这个数字的所有人」；而
                //      `CAST(id AS CHAR) LIKE '%42%'` 还会让 id 上的索引彻底失效
                //      （一张随注册量增长的表，为少数用法换全表扫描不划算）。
                //      代价是搜「42」不再返回 142 —— 那是 IKJ5M7 之前前端本地
                //      contains 的旧行为，这次一并改掉。
                //
                //   ⚠️ 长度也要卡住：`BigInt()` 咽得下任意长的数字串，而这一列是
                //      BIGINT（19 位封顶）。粘贴一串 30 位的东西进来，值本身就把
                //      列的范围撑爆了 —— 表现是驱动层报错或者一条都查不到，两种都
                //      不是「用户不存在」该有的样子。18 位足够装下任何真实用户 id。
                ...(isUserIdKeyword(keyword) ? [{ id: BigInt(keyword) }] : []),
              ],
            }
          : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.bw_users.count({ where }),
        prisma.bw_users.findMany({
          where,
          orderBy: { id: "asc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            username: true,
            phone: true,
            status: true,
            gmt_create: true,
            gmt_modified: true,
          },
        }),
      ]);

      // 角色一次查完（按用户批量取），避免每行一次查询
      const ids = rows.map((r) => r.id);
      const grants = ids.length
        ? await prisma.bw_user_roles.findMany({
            where: { user_id: { in: ids }, is_delete: false },
            select: { user_id: true, role_id: true },
          })
        : [];
      const roleIdToCode = new Map(
        (await prisma.bw_roles.findMany({
          where: { is_delete: false },
          select: { id: true, code: true },
        })).map((r) => [r.id.toString(), r.code]),
      );
      const codesByUser = new Map<string, string[]>();
      for (const g of grants) {
        const key = g.user_id.toString();
        const code = roleIdToCode.get(g.role_id.toString());
        if (!code) continue;
        codesByUser.set(key, [...(codesByUser.get(key) ?? []), code]);
      }

      // 余额三列（IKJ5M7）：属于计费域，**一页一次批量问过来**——逐用户调就是 100 次
      // 跨进程往返。⚠️ 它抛错就整条列表失败，故意不兜成 0（见文件头那段）。
      const stats = await fetchAdminUserStats(rows.map((r) => Number(r.id)));

      const items: AdminUserRow[] = rows.map((r) => {
        const userId = Number(r.id);
        const stat = stats.get(userId);
        if (!stat) {
          // ⚠️ 服务端保证「请求里的每个 id 都回一项」，所以走到这里说明**契约破了**。
          //    兜 0 是为了不让整页炸在渲染上，但必须留一行证据 —— 静默的 0 正是
          //    这单要消灭的那个症状（「计费没数据」与「真的没有积分」长得一样）。
          log.warn(`计费未返回用户 ${userId} 的三列（契约：请求里的每个 id 都应有回项），按 0 渲染`);
        }
        return {
          userId,
          nickname: r.username,
          phone: r.phone ?? "",
          balance: stat?.availableCredits ?? 0,
          totalRecharge: stat?.totalRecharged ?? 0,
          totalSpend: stat?.totalConsumed ?? 0,
          role: roleRank(codesByUser.get(r.id.toString()) ?? []),
          status: r.status === "NORMAL" ? "active" : "disabled",
          createdAt: r.gmt_create.toISOString(),
          updatedAt: r.gmt_modified.toISOString(),
        };
      });

      return { items, total };
    },

    async findUserIdByKeyword(rawKeyword) {
      const keyword = rawKeyword.trim();
      if (!keyword) return undefined;

      const asId = isUserIdKeyword(keyword);

      // **一次查询同时试三种解释**（用户 ID / 手机号 / 用户名）——这三样共用一个输入框
      // （三个记录页那个「用户 ID / 手机号 / 用户名」），光看输入分不出是哪一种。
      //
      // ⚠️ 但**挑哪一行必须有优先级**，少了它会**错人**：用户名的形状不受限（注册只要求
      //    非空，new-api 时代的历史名字更是随便取），所以「一个叫 123456 的用户」是存在的。
      //    没有优先级时，输 `123456` 只会拿到 id=123456 那个人的账——**错的人，还不报错**，
      //    而这一页恰恰是用来对账的。`rows[0]` 这种取法就是把优先级交给了数据库的返回顺序。
      //
      // ⚠️ 优先级 = 用户名 / 手机号的精确命中 > 「这串数字恰好等于某个用户 ID」。
      //    两个**不同的人**同时命中（A 的用户名 = B 的手机号）时更要小心，见下面那段。
      const rows = await prisma.bw_users.findMany({
        where: {
          OR: [
            ...(asId ? [{ id: BigInt(keyword) }] : []),
            { phone: keyword },
            { username: keyword },
          ],
        },
        // 手机号与用户名各自唯一、id 是主键 ⇒ 最多三行
        take: 3,
        select: { id: true, username: true, phone: true },
      });

      // 用户名用**不区分大小写**比较：库的排序规则是 `*_ci`，`Admin` 会匹配到 `admin`，
      // 逐字比较会让这类命中落空、退回成 id 那一行——又回到错人。
      const lower = keyword.toLowerCase();
      const named = rows.filter(
        (r) => r.phone === keyword || r.username.toLowerCase() === lower,
      );

      // ⚠️ 手机号与用户名各自唯一，但**两者可以撞在同一个关键词上**（某人的用户名叫
      //    `13800008888`，另一个人拿它当手机号）。这时「运营要找的是谁」本来就无从判断，
      //    挑一行就是替他猜——而这一页是用来对账的。**当作查不到**（宁可空页，不可错人）。
      //    软删用户也在这张表里（下面 loadUserIdentities 说明过为什么不过滤 is_delete），
      //    所以这种撞车不是理论上的。
      if (named.length > 1) return undefined;

      const byId = asId ? rows.find((r) => r.id === BigInt(keyword)) : undefined;

      const row = named[0] ?? byId;
      return row ? Number(row.id) : undefined;
    },

    async loadUserIdentities(userIds) {
      const ids = [...new Set(userIds)];
      if (ids.length === 0) return new Map();

      // ⚠️ **不过滤 `is_delete`**（与上面的 {@link BASE_WHERE} 不同，是故意的）：积分记录是
      //    账本，已软删用户的历史流水仍是账的一部分——全站模式下那些行照常列在表里。
      //    这里过滤掉的话，同一页里它们的用户名会显示成「—」，反而自相矛盾。
      const rows = await prisma.bw_users.findMany({
        where: { id: { in: ids.map((id) => BigInt(id)) } },
        select: { id: true, username: true, phone: true },
      });
      return new Map(
        rows.map((r) => [Number(r.id), { nickname: r.username, phone: r.phone ?? "" }]),
      );
    },
  };
}
