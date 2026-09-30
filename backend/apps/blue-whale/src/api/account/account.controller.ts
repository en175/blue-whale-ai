import { NewApiError } from "@lib/core";
import { Controller, Get, Query, Res, StreamableFile } from "@nestjs/common";
import { ok } from "@lib/contracts";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import {
  parsePageParam,
  parsePageSizeParam,
} from "@lib/shared/account/admin-paging.js";
import {
  sharedBillingClient,
  toBillingError,
  type BillingListLotsQuery,
  type BillingListTransactionsQuery,
  type BillingTransaction,
} from "@lib/shared/billing/billing-client.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { RechargeService } from "@lib/shared/recharge/recharge.service.js";
import {
  RECHARGE_ORDER_STATUSES,
  type RechargeOrderStatus,
} from "@lib/shared/persistence/index.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import type { Response } from "express";
import {
  EXPORT_SCOPES,
  MAX_EXPORT_ROWS,
  buildExportWorkbook,
  exportFieldKeys,
  exportFileName,
  type ExportRows,
  type ExportScope,
} from "./account-export.js";

/** 导出分页拉取时的每页条数（= 上游上限，尽量少往返）。 */
const EXPORT_PAGE_SIZE = 100;

/**
 * 类型过滤：**逗号分隔的多值**。
 *
 * <p>空串、纯空白、多余分隔符都会滤掉，所以 `type=consume,,expire,` 等价于两个值。
 * 校验在 billing 侧做（含未知值 → INVALID_ARGUMENT），这一层只负责拆分。
 */
function parseTypes(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * 订单状态白名单：传别的当场拒绝 —— 静默回空列表与「真的没有」长得一模一样。
 *
 * <p>清单**不在这里手写**，同管理端充值记录页：状态一扩（2026-09-26 由 4 态到 6 态），
 * 手写的数组不会报错，只会让新状态的单筛不出来。
 */
const STATUSES = RECHARGE_ORDER_STATUSES;

@Controller("account")
export class AccountController {
  constructor(
    private readonly jobs: JobsService,
    private readonly recharge: RechargeService,
  ) {}

  /**
   * 用户流水 —— 读 billing 的账本（`ListTransactions`）。
   *
   * <p>原先这条转发 new-api 的 `/api/log/self`，而 new-api 已降级成「带一把统一 key
   * 的上游供应商」：那把 key 是全项目共用的，问它「我的消费」只会拿到统一 key 属主的账。
   *
   * <p>⚠️ **分页是 offset 页码 + 总数**（2026-09-30 由游标改来，见契约的
   * `common/v1/types.proto`）。入参 `page`（从 1 起，缺省 1）、`page_size`（缺省 20、上限 100）；
   * 响应 `total` 是满足同一组条件的总条数。
   *
   * <p>⚠️ 换 offset 的代价是真实的：账本持续追加，翻页途中新插入的行会把后面的行整体下移，
   * 用户可能看到重复行。换的是列表上的「共 N 条」与页码，留痕见前端对接文档 §6.2。
   *
   * <p>⚠️ `type` 是**逗号分隔的多值**（consume | recharge | refund | expire | ...），空 = 全部。
   * 用户的「已消耗」页签要一次取 `consume,expire`（过期核销并入消耗）。未知值由 billing
   * 拒成 INVALID_ARGUMENT —— **每一个值都校验**，不是只看第一个。
   *
   * <p>⚠️ **用户 id 只来自会话**（`@CurrentUser()`），这条路由**不接受**任何形式的
   * `user_id` / `userId` 传参。billing 的用户面 `ListTransactions` 里 `user_id` 是必填的，
   * 而填进去的只能是这里解析出来的那一个 —— 没有「查别人的账」这条路径。
   */
  @Get("consumptions")
  async consumptions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
  ) {
    const types = parseTypes(query.type);
    const request: BillingListTransactionsQuery = {
      userId: Number(user.userId),
      pageSize: parsePageSizeParam(query.page_size),
      page: parsePageParam(query.page),
      ...(types.length ? { typeFilters: types } : {}),
    };

    try {
      const page = await sharedBillingClient().listTransactions(request);
      return ok({
        items: await this.mergeTaskSummaries(page.items),
        total: page.total,
      });
    } catch (error) {
      throw toBillingError(error, "消费记录查询不可用");
    }
  }

  /**
   * 把一页账本行与任务语义合并（`consumptions` 与导出**共用**）。
   *
   * <p>抽出来是为了两处不漂移：导出里的「任务类型 / 模型 / 任务详情」必须与页面上看到的
   * 一致，各写一遍迟早会出现「列表里查得到、导出来是空」。
   *
   * <p>任务的语义字段在**我们自己的库**里：billing 只存得下 `generation_job_id`
   * （ADR-0114 不共享库，它读不到 `generation_jobs`）。所以本控制器是唯一同时够得着
   * 两边的地方 —— 从 billing 取这一页流水，收齐 job id，回自己库批量查一次。
   *
   * <p>⚠️ **不 try/catch**：真查不动自己的库时让它照常失败。悄悄把这些字段填成 null
   * 会让页面显示成「这些行没有任务」——那是一句不报错的假话。
   */
  private async mergeTaskSummaries(items: BillingTransaction[]) {
    const summaries = await this.jobs.loadTaskSummaries(
      items.map((item) => item.generationJobId).filter((id): id is string => id != null),
    );
    return items.map((item) => {
      // 查不到任务（跨库历史、已清理）→ summary 为 undefined → 四字段全 null，
      // 前端回落显示 title。**这不是错误**：那笔钱确实发生过，只是任务查不到了。
      // 反之 job 在、只是没有提示词（免费工具族）时，prompt 单独是 null——两者可分辨。
      const summary =
        item.generationJobId == null ? undefined : summaries.get(item.generationJobId);
      return {
        id: item.id,
        type: item.type,
        direction: item.direction,
        title: item.title,
        credits: item.credits,
        status: item.status,
        created_at: item.createdAt,
        settled_at: item.settledAt,
        // 这一行关联的任务 id；发放行、过期行没有任务，为 null
        job_id: item.generationJobId,
        task_type: summary?.type ?? null,
        model_id: summary?.modelId ?? null,
        model_label: summary?.modelLabel ?? null,
        prompt: summary?.prompt ?? null,
      };
    });
  }

  /**
   * 积分**批次台账** —— 积分明细「已获取」页签。
   *
   * <p>与 `consumptions` 是两个维度，不是重复：流水是「一个业务动作一行」，批次是
   * 「一笔发放一行」。**到期明细只有这条给得出** —— 流水行没有到期时间，而 PRD §9.5
   * 要求用户侧能在积分记录里查看到期明细。
   *
   * <p>⚠️ **列的是全部批次**：用光了的、已过期的同样会出现。少了它们，「我已获取」
   * 会变成一份自己缩短的清单 —— 与流水里退回行凭空消失是同一类问题。
   *
   * <p>⚠️ 三个字段的「空」都有讲究：
   * <ul>
   *   <li>`expires_at` 为空串 = **永久有效**（不是「查不到」）。这与 `settled_at`
   *       用空串表示「未结算」是同一种收敛：对外只留**一种**「没有」，
   *       前端不必判 null / undefined / 空串三次。</li>
   *   <li>`remaining` 是**可用量**（上游已按 `remaining − frozen` 算好），冻结中的部分
   *       已经许给在途任务，对用户来说不能用。</li>
   *   <li>`source` 是**批次口径**（`purchased | bonus | …`），不是流水口径的 `recharge`。
   *       同一件事两个词，前端别拿同一张文案表去套。</li>
   * </ul>
   *
   * <p>⚠️ **用户 id 只来自会话**，这条路由不接受任何 `user_id` 传参。上游 billing 的
   * `ListLots` 对 `user_id <= 0` 直接拒 —— 用户面没有「查全部人的台账」这条路径。
   */
  @Get("credit-lots")
  async creditLots(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
  ) {
    const request: BillingListLotsQuery = {
      userId: Number(user.userId),
      pageSize: parsePageSizeParam(query.page_size),
      page: parsePageParam(query.page),
    };

    try {
      const page = await sharedBillingClient().listCreditLots(request);
      return ok({
        items: page.items.map((item) => ({
          lot_id: item.lotId,
          source: item.source,
          amount: item.amount,
          remaining: item.remaining,
          created_at: item.createdAt,
          expires_at: item.expiresAt,
          biz_type: item.bizType,
          biz_id: item.bizId,
        })),
        total: page.total,
      });
    } catch (error) {
      throw toBillingError(error, "积分批次查询不可用");
    }
  }

  /**
   * 订单记录 —— 用户自己的充值订单。
   *
   * <p>数据源是**我们自己的** `recharge_orders`（ADR-0114 决策 7：充值已接回，走
   * BlueWhalePay 的杭州银行渠道）。所以这条与上面两条不同：它读本地表、offset 分页、
   * **total 是真实数出来的**（不是 billing 那条要另跑 COUNT 的）。
   *
   * <p>⚠️ 与管理端 `/api/admin/recharge-records` **复用同一个 `listOrdersForAdmin`**，
   * 差别只有一处、但那一处是要害：**归属在这里被钉死**。管理端可以不传 `userId` =
   * 全站订单；这条路由**永远**把 `userId` 填成会话里的那一个，调用方传什么（`user_id`、
   * `keyword`、`tradeNo`）都不参与用户归属的判定 —— 没有「查别人的单」这条路径。
   *
   * <p>⚠️ **状态是六态、且没有「已退款」**：`recharge-order-repo.ts` 里写着「退款功能
   * 先不做，一个没有出口的状态就是死状态」。白名单取自 `RECHARGE_ORDER_STATUSES`，
   * 不在这里手写 —— 手写的数组在状态扩张时不会报错，只会让新状态的单筛不出来。
   *
   * <p>⚠️ 筛选项非法时**当场 400**，不是回空列表：空列表与「真的没有」长得一模一样。
   */
  @Get("orders")
  async orders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
  ) {
    const status = (query.status ?? "").trim();
    if (status && !STATUSES.includes(status as RechargeOrderStatus)) {
      throw new NewApiError(`status 须为 ${STATUSES.join("/")}`, 400);
    }

    const { items, total } = await this.recharge.listOrdersForAdmin({
      page: parsePageParam(query.page),
      pageSize: parsePageSizeParam(query.page_size),
      // ★ 归属只认会话。见方法注释：不传 userId 就是全站，这条路由绝不能走到那个分支
      userId: Number(user.userId),
      ...(status ? { status: status as RechargeOrderStatus } : {}),
    });

    return ok({
      items: items.map((order) => ({
        trade_no: order.tradeNo,
        product_name: order.productName,
        product_type: order.productType,
        // 单位是**分**，前端展示前 /100
        amount_fen: order.amountFen,
        // 下单快照（基础 + 赠送），**支付前就有值**：前端按 status 决定展不展示，
        // 非 paid 一律显示「—」。拿「有没有值」判断到没到账是错的
        credits: order.credits,
        bonus_credits: order.bonusCredits,
        status: order.status,
        created_at: order.createdAt,
        paid_at: order.paidAt,
        credits_valid_months: order.creditsValidMonths,
      })),
      total,
    });
  }

  /**
   * **导出明细**（xlsx）—— 当前页签的**全部记录**，不是当前页。
   *
   * <p>⚠️ 三条与外层约定不同的地方，前端接的时候必须照做：
   * <ol>
   *   <li><b>不套 `{code,data,msg}` 信封</b>，回的是二进制流（路由上标了
   *       `@BypassTransform()`）。前端要用原生 `fetch` 取 blob，**不能**走
   *       `http.ts` 那套统一解析 —— 它会把响应体当 JSON 解。</li>
   *   <li><b>行数有上限</b>（{@link MAX_EXPORT_ROWS}）。到顶时文件**末行**会写明
   *       「仅导出前 N 条，共 M 条」—— 不静默截断，一个看起来完整的文件比少几行的文件危险。</li>
   *   <li><b>文件名用 RFC 5987 的 `filename*`</b> 带中文（裸 `filename` 里的中文在部分
   *       浏览器会乱码），所以前端应从 `Content-Disposition` 里读名字，别自己拼。</li>
   * </ol>
   *
   * <p>⚠️ 与另外三条一样：**用户 id 只来自会话**。传 `scope` 之外的参数一律不改变归属。
   */
  @Get("export")
  @BypassTransform()
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const rawScope = (query.scope ?? "").trim();
    if (!EXPORT_SCOPES.includes(rawScope as ExportScope)) {
      throw new NewApiError(`scope 须为 ${EXPORT_SCOPES.join("/")}`, 400);
    }
    const scope = rawScope as ExportScope;

    const fields = parseTypes(query.fields);
    const known = exportFieldKeys(scope);
    const unknown = fields.filter((field) => !known.includes(field));
    if (unknown.length) {
      // 静默忽略未知字段会导出一个**少了几列**的文件，而用户以为导出成功了
      throw new NewApiError(`未知导出字段：${unknown.join("/")}`, 400);
    }

    const collected = await this.collectExportRows(scope, Number(user.userId), query);
    const buffer = await buildExportWorkbook(collected, fields);

    // 文件名：`filename=` 给一个 ASCII 兜底，中文走 `filename*=UTF-8''…`（RFC 5987）。
    // 只给裸 `filename` 的话，Chrome 之外的浏览器会把中文名渲染成一串乱码
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const name = exportFileName(scope, stamp);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    return new StreamableFile(buffer);
  }

  /**
   * 按页签把**全部**记录拉下来（导出专用，不受页面分页影响）。
   *
   * <p>⚠️ 每个分支都必须**显式投影**成导出行的形状。**不要**把 repo / billing 客户端的
   * 返回值直接塞进 `rows`：那些是 camelCase 对象（`createdAt` / `amountFen`），
   * 而导出的列定义读 snake_case（`created_at` / `amount_fen`）—— 键对不上时服务端一声不响，
   * 用户下载下来才发现大半格子是空的。上一版就是这么错的，`ExportRows` 的判别联合现在
   * 让这种错**编不过**。</p>
   *
   * <p>⚠️ 到 {@link MAX_EXPORT_ROWS} 就停：无上限时一个重度用户（两年积累上万条流水）
   * 就能把这一条请求的内存撑爆。截断由 {@link buildExportWorkbook} 写进文件，
   * 不在这里吞掉。
   */
  private async collectExportRows(
    scope: ExportScope,
    userId: number,
    query: Record<string, string>,
  ): Promise<ExportRows> {
    if (scope === "orders") {
      const status = (query.status ?? "").trim();
      if (status && !STATUSES.includes(status as RechargeOrderStatus)) {
        throw new NewApiError(`status 须为 ${STATUSES.join("/")}`, 400);
      }
      const { rows, total } = await this.paged(
        (page) =>
          this.recharge.listOrdersForAdmin({
            page,
            pageSize: EXPORT_PAGE_SIZE,
            // ★ 归属只认会话，同 `orders`
            userId,
            ...(status ? { status: status as RechargeOrderStatus } : {}),
          }),
        (orders) =>
          orders.map((order) => ({
            trade_no: order.tradeNo,
            product_name: order.productName,
            amount_fen: order.amountFen,
            credits: order.credits,
            bonus_credits: order.bonusCredits,
            status: order.status,
            created_at: order.createdAt,
            paid_at: order.paidAt,
          })),
      );
      return { scope: "orders", rows, total };
    }

    if (scope === "gain") {
      const { rows, total } = await this.paged(
        (page) => sharedBillingClient().listCreditLots({ userId, page, pageSize: EXPORT_PAGE_SIZE }),
        (lots) =>
          lots.map((lot) => ({
            lot_id: lot.lotId,
            source: lot.source,
            amount: lot.amount,
            remaining: lot.remaining,
            created_at: lot.createdAt,
            expires_at: lot.expiresAt,
            biz_type: lot.bizType,
            biz_id: lot.bizId,
          })),
      );
      return { scope: "gain", rows, total };
    }

    const types = parseTypes(query.type);
    const { rows, total } = await this.paged(
      (page) =>
        sharedBillingClient().listTransactions({
          userId,
          page,
          pageSize: EXPORT_PAGE_SIZE,
          ...(types.length ? { typeFilters: types } : {}),
        }),
      // 与页面同一套合并（批量查任务，不是逐行），导出里的任务类型 / 模型 / 详情才会和列表一致
      (items) => this.mergeTaskSummaries(items),
    );
    return { scope: "consume", rows, total };
  }

  /**
   * 逐页拉到上限为止，每页整批交给 `project` 投影。
   *
   * <p>⚠️ `project` 收的是**一整批**而不是一行：任务语义那一步要批量查（一页 100 行
   * 就是一次库往返），逐行映射会让它退化成 N 次查询。
   */
  private async paged<S, T>(
    fetchPage: (page: number) => Promise<{ items: S[]; total: number }>,
    project: (items: S[]) => Promise<T[]> | T[],
  ): Promise<{ rows: T[]; total: number }> {
    const rows: T[] = [];
    let total = 0;
    for (let page = 1; rows.length < MAX_EXPORT_ROWS; page++) {
      const chunk = await fetchPage(page);
      total = chunk.total;
      rows.push(...(await project(chunk.items)));
      if (chunk.items.length < EXPORT_PAGE_SIZE) break;
    }
    return { rows: rows.slice(0, MAX_EXPORT_ROWS), total };
  }
}
