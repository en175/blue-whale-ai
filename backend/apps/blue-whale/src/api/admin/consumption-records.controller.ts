import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { BillingAdminConfigError, BillingAdminError, listAdminTransactions } from "@lib/shared/billing/billing-admin-client.js";
import { AdminException } from "@lib/shared/errors/admin-error.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parsePageSize(raw: string | undefined): number {
  const size = Number(raw);
  return Number.isInteger(size) && size > 0
    ? Math.min(MAX_PAGE_SIZE, size)
    : DEFAULT_PAGE_SIZE;
}

/** 页码：缺省 / 非法 / 小于 1 一律当第一页（负 OFFSET 会让 MySQL 直接语法错）。 */
function parsePage(raw: string | undefined): number {
  const page = Number(raw);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/**
 * 积分记录（管理端）。
 *
 * <p>数据源是 **billing 的账本**——不是我们的库。判据很简单：钱只从 billing 的
 * 复式账本进出，本地任何一张表都只是它的投影（`recharge_orders` 是充值订单的**订单**，
 * 不是账；`generation_jobs` 是任务的**执行**，不是扣费）。要答「谁在什么时候花了多少」，
 * 唯一权威就是 billing。
 *
 * <p>⚠️ **没有复用用户面那条 gRPC `ListTransactions`**：它的契约里 `user_id` 必填，
 *    语义是「把我的账给我」。管理端要的是「某个人的 / 所有人一起看」——
 *    给**用户面契约**加「userId 可不填」等于给每个持 token 的调用者开了拉全站流水的口子。
 *    所以在 proto 里另开了**独立的一条服务**（`BillingAdminService`），用户面那条一个字没动。
 *    本控制器是它的 BFF。
 *
 * <p>（这段论证曾经用来支持「管理面是 billing 新增的一条 HTTP」。它反驳的是**复用用户面
 *    那条 rpc**，不是「用 gRPC」—— 独立服务同样满足它，还免掉两套协议。2026-09-26 迁到
 *    gRPC 时把这段留在 proto 与这里，防止后来的人照着旧结论回滚。）
 *
 * <p>⚠️ 2026-09-30 分页由**游标**改为 **offset 页码**（与用户面同一次改动，
 *    见 `common/v1/types.proto`）。代价在运营面同样存在：翻页途中新增的行会把后面的行下移，
 *    可能看到重复行。
 *
 * <p>⚠️ **本页仍然不返回 total 的真实值**：上游 `AdminListTransactions` 本轮不统计
 *    （账本 COUNT 的成本随数据量线性上涨）。所以 `total` 在这一层**恒为 null**，
 *    含义是「未统计」而不是「0 条」。要与「真的是 0 条」区分开 —— 后者是查得到 0 的
 *    （关键词查不到人那条早退分支就是），两种在响应里长得不一样。要补是后续独立工单。
 *    这与充值记录页的 offset 分页形状不同——但前端用同一个翻页组件，观感一致。
 *
 * <p><b>消费行为什么还带任务的类型 / 模型 / 提示词</b>：那一行的 id 是 {@code res:7}，
 * 钱的来源是 billing，但任务的语义全在我们自己库里——billing 只存得下
 * {@code generation_job_id}（ADR-0114 不共享库，它读不到 `generation_jobs`）。
 * 所以本控制器是**唯一同时够得着两边的地方**：从 billing 取这一页流水，收齐 job id，
 * 回自己库批量查一次，合并进同一个响应。前端一次请求就能把一行讲清楚，
 * 不必再发第二次、也不必自己做 join（那还会多出两次请求之间的竞态）。
 *
 * <p><b>昵称 / 手机号是同一个道理，第二份实例</b>：billing 的账本里只有 {@code user_id}，
 * 认不出人（同样读不到 `bw_users`）。所以要「按手机号查」没法在 billing 侧做——先回自己库
 * 把关键词**精确**解成一个 userId，再拿这个 id 走 billing 现成的那条 `user_id` 过滤；
 * 列表上的昵称 / 手机号也是这一页的 user_id 集合批量查回来的。**billing 与 proto 一个字没动。**
 */
@Controller("admin/consumption-records")
@UseGuards(AdminGuard)
export class AdminConsumptionRecordsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly identity: IdentityService,
  ) {}

  /**
   * GET /api/admin/consumption-records?keyword=&type=&pageSize=&page=
   *
   * @param keyword 用户 ID / 手机号 / 昵称，**都要完整**（精确匹配）。空 = **全站**（管理端独有；
   *                用户面没有这个自由度）
   * @param type    单值（consume | recharge | ...），空 = 全部
   * @param page    页码，从 1 起
   */
  @Get()
  async list(@Query() query: Record<string, string> = {}) {
    const typeFilter = query.type?.trim() ?? "";

    // ⚠️ 还认着旧的 `userId`。前端与后端**不是原子发版**（本仓 2026-09-26 实测过一次：
    //    3100 上跑着 4 小时前的构建），一个还没刷新的管理页仍会发 `?userId=42`。
    //    不认它的后果不是报错，而是**静默回一页全站流水**——运营以为筛了那个人，
    //    实际拿到的是所有人的账。这正是本文件反复反对的那类「不报错的假话」。
    //    数字落进 findAdminUserIdByKeyword 会被当成用户 ID 解，语义与旧版一致。
    const keyword = (query.keyword ?? query.userId ?? "").trim();

    // 关键词在我们库里解成一个 userId：billing 不共享库（ADR-0114），`bw_users` 它读不到，
    // 手机号这一层它永远答不出。**查不到人就回空页，不问 billing** —— 账本按 user_id 过滤，
    // 这边都认不出这个人，那边一条也对不上。
    //
    // ⚠️ 空页与「查到了人但没有流水」在界面上同形，这是**接受的**：真报错的话，运营只是
    //    打错一位数就得先分清是哪一种，而账本页要的是「输错了立刻看得出来」——
    //    所以页面的空态文案保持中性，不去断言「这个人没消费过」。
    //
    // ⚠️ 这一步刻意留在 try **外面**（同 `parsePageSize`）：它查的是**我们自己的库**，
    //    失败是「我们的库挂了」，不是 `toConsumptionError` 那两种 billing 故障。
    //    塞进去会被兜成 502「积分记录查询失败：未知错误」，把值班的人指向 billing——
    //    而那边其实好好的。让它照常冒成 500。
    let userId: number | undefined;
    if (keyword) {
      userId = await this.identity.findAdminUserIdByKeyword(keyword);
      if (userId === undefined) {
        // 认不出这个人 = 他的流水恒为 0 条，所以 total 是 **0** 而不是 null：
        // 这里真的数得出来，与上面「上游未统计」是两回事，别把两者混成一种「没有」。
        return { success: true, data: { items: [], total: 0 } };
      }
    }

    try {
      const page = await listAdminTransactions({
        ...(userId !== undefined ? { userId } : {}),
        ...(typeFilter ? { type: typeFilter } : {}),
        pageSize: parsePageSize(query.pageSize),
        page: parsePage(query.page),
      });

      // 只有消费行（billing 的 res: 行）带得回 generation_job_id；发放行 / 账本行是 null。
      // 一页最多 100 行，所以这里天然是一次 bounded 的批量查——不设二次上限（见 JobsService）。
      const summaries = await this.jobs.loadTaskSummaries(
        page.items
          .map((item) => item.generationJobId)
          // ⚠️ `== null` 而不是 `=== null`：客户端会把 billing 的缺值收敛成 null，但这里是
          //    对外那一层，按本仓规矩「旧构建回包整个键不存在」也要容得下（undefined）。
          .filter((id): id is string => id != null),
      );

      // 昵称 / 手机号：**一次 IN 查回来**，不逐行查（就是上面任务那套的第二个实例）。
      const identities = await this.identity.loadAdminUserIdentities(
        page.items.map((item) => item.userId),
      );

      return {
        success: true,
        data: {
          items: page.items.map((item) => {
            // 查不到任务（跨库历史、已清理）→ summary 为 undefined → 四字段全 null，
            // 前端回落显示 title。**这不是错误**：那一笔钱确实发生过，只是任务查不到了。
            // 反之 job 在、只是没有提示词（免费工具族）时，prompt 单独是 null——两者可分辨。
            //
            // ⚠️ 这里**不 try/catch**：真查不动自己的库时让它照常失败。悄悄把这些字段填成
            //    null 会让页面显示成「这些行没有任务」——那是一句不报错的假话。
            const summary =
              item.generationJobId == null ? undefined : summaries.get(item.generationJobId);
            return {
              id: item.id,
              user_id: item.userId,
              // 展示身份，来自**我们库**（billing 的账本里只有 user_id）。
              // ⚠️ `|| null` 而不是 `?? null`，两个字段同一条理由：`AdminUserIdentity` 用
              //    **空串**表示「没有」（用户没手机号是常态、存量密码/名字也可能是空串），
              //    落到对外契约里要收敛成**唯一的**一种「没有」——否则前端要判「空串」
              //    「null」「键不存在」三次，而少判的那次会渲染成空白而不是「—」。
              //    用户查不到（跨库历史 / 被清理）时整个 identity 缺席，同样落到 null。
              nickname: identities.get(item.userId)?.nickname || null,
              phone: identities.get(item.userId)?.phone || null,
              type: item.type,
              direction: item.direction,
              title: item.title,
              credits: item.amount,
              // 该行当初冻了多少（**只有消费行有**；发放 / 账本行是 null）。
              // ⚠️ 显式 `?? null` 而不是透传：billing 若哪天不回这个键，前端会拿到
              //    `undefined`，而 `undefined == null` 为真、`undefined !== null` 也为真——
              //    让契约里只有一种「没有」，界面才不需要判两种空。
              reserved_credits: item.reservedCredits ?? null,
              // 任务的三个语义字段（**只有消费行、且任务查得到时有**）。
              task_type: summary?.type ?? null,
              model_id: summary?.modelId ?? null,
              model_label: summary?.modelLabel ?? null,
              // ponytail: 提示词**全文返回**（页面要开弹窗看真的全文，服务端悄悄截断会让
              // 「全文」两个字变成假的）。天花板是「一页 100 行 × 单条提示词长度」——
              // 内网管理页量级可控。真出现 MB 级单条时在这里加单值截断 + 前端标注「已截断」，
              // 别改成「点开再按行拉」：那要新开一条路由，而这一整条链的设计就是不新增路由。
              prompt: summary?.prompt ?? null,
              status: item.status,
              created_at: item.createdAt,
              settled_at: item.settledAt,
            };
          }),
          total: page.total,
        },
      };
    } catch (error) {
      throw toConsumptionError(error);
    }
  }
}

/**
 * billing 的两类失败分开报，各自带一个**可判**的状态码。
 *
 * <p>与 `billing-admin-client` 里那两个错误类型同源：**配置错**（地址没配）要人去改配置
 * 并重启——这一次请求再重试也不会好，所以是 503；**调用失败**可能等 billing 恢复就好，
 * 是 502。混成一个 500，值班的人只能靠读文案猜该找谁。
 *
 * <p>⚠️ 两种情况都**不能**回 200 空列表：空列表会让人得出「这段时间没人消费」，
 *    那是一句不报错的假话——而这一页恰恰是用来对账的。
 */
function toConsumptionError(error: unknown): AdminException {
  if (error instanceof AdminException) return error;
  if (error instanceof BillingAdminConfigError) {
    return new AdminException(503, `积分记录不可用：${error.message}`);
  }
  const detail = error instanceof BillingAdminError ? error.message : "未知错误";
  return new AdminException(502, `积分记录查询失败：${detail}`);
}
