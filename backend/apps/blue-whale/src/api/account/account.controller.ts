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
  type BillingCreditLot,
  type BillingListLotsQuery,
  type BillingListTransactionsQuery,
  type BillingTransaction,
} from "@lib/shared/billing/billing-client.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { RECHARGE_LOT_BIZ_TYPE } from "@lib/shared/billing/lot-biz-type.js";
import { RechargeService } from "@lib/shared/recharge/recharge.service.js";
import {
  USER_ORDER_STATUSES,
  isUserOrderStatus,
  toStoredOrderStatuses,
  toUserOrderStatus,
  type UserOrderStatus,
} from "@lib/shared/recharge/user-order-status.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import type { Response } from "express";
import { consumeDetail } from "./consumption-detail.js";
import {
  EXPORT_SCOPES,
  MAX_EXPORT_ROWS,
  buildExportWorkbook,
  exportFieldKeys,
  exportFileName,
  type ExportRows,
  type ExportScope,
} from "./account-export.js";

const EXPORT_PAGE_SIZE = 100;

const MAX_FILTER_JOB_IDS = 10_000;

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseTypes(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function parseInstant(raw: string | undefined, field: string): string | undefined {
  const value = (raw ?? "").trim();
  if (!value) return undefined;
  if (!RFC3339.test(value) || Number.isNaN(Date.parse(value))) {
    throw new NewApiError(`${field} 须为带时区的 RFC3339 时间`, 400);
  }
  return value;
}

function parseUserStatus(raw: string | undefined): UserOrderStatus | undefined {
  const value = (raw ?? "").trim();
  if (!value) return undefined;
  if (!isUserOrderStatus(value)) {
    throw new NewApiError(`status 须为 ${USER_ORDER_STATUSES.join("/")}`, 400);
  }
  return value;
}

@Controller("account")
export class AccountController {
  constructor(
    private readonly jobs: JobsService,
    private readonly recharge: RechargeService,
  ) {}

  @Get("consumptions")
  async consumptions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
  ) {
    const types = parseTypes(query.type);
    const createdFrom = parseInstant(query.created_from, "created_from");
    const createdTo = parseInstant(query.created_to, "created_to");
    const taskType = (query.task_type ?? "").trim();
    const model = (query.model ?? "").trim();

    let generationJobIds: string[] | undefined;
    if (taskType || model) {
      const resolved = await this.jobs.listJobIds({
        userId: user.userId,
        ...(taskType ? { type: taskType } : {}),
        ...(model ? { modelId: model } : {}),
        ...(createdFrom ? { createdFrom: new Date(createdFrom) } : {}),
        ...(createdTo ? { createdTo: new Date(createdTo) } : {}),
        limit: MAX_FILTER_JOB_IDS,
      });
      if (resolved.truncated) {
        throw new NewApiError(
          `按任务类型/模型命中的任务超过 ${MAX_FILTER_JOB_IDS} 条，请先缩小日期范围`,
          400,
        );
      }
      if (resolved.ids.length === 0) {
        return ok({ items: [], total: 0 });
      }
      generationJobIds = resolved.ids;
    }

    const request: BillingListTransactionsQuery = {
      userId: Number(user.userId),
      pageSize: parsePageSizeParam(query.page_size),
      page: parsePageParam(query.page),
      ...(types.length ? { typeFilters: types } : {}),
      ...(createdFrom ? { createdFrom } : {}),
      ...(createdTo ? { createdTo } : {}),
      ...(generationJobIds ? { generationJobIds } : {}),
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

  private async mergeTaskSummaries(items: BillingTransaction[]) {
    const summaries = await this.jobs.loadTaskSummaries(
      items.map((item) => item.generationJobId).filter((id): id is string => id != null),
    );
    return items.map((item) => {
      const summary =
        item.generationJobId == null ? undefined : summaries.get(item.generationJobId);
      const row = {
        id: item.id,
        type: item.type,
        direction: item.direction,
        title: item.title,
        credits: item.credits,
        status: item.status,
        created_at: item.createdAt,
        settled_at: item.settledAt,
        task_type: summary?.type ?? null,
        model_id: summary?.modelId ?? null,
        model_label: summary?.modelLabel ?? null,
        prompt: summary?.prompt ?? null,
        specs: summary?.specs ?? null,
        lot_source: item.lotSource === "" ? null : item.lotSource,
        lot_created_at: item.lotCreatedAt === "" ? null : item.lotCreatedAt,
      };
      return { ...row, detail: consumeDetail(row) };
    });
  }

  @Get("credit-lots")
  async creditLots(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
  ) {
    const createdFrom = parseInstant(query.created_from, "created_from");
    const createdTo = parseInstant(query.created_to, "created_to");

    const request: BillingListLotsQuery = {
      userId: Number(user.userId),
      pageSize: parsePageSizeParam(query.page_size),
      page: parsePageParam(query.page),
      ...(createdFrom ? { createdFrom } : {}),
      ...(createdTo ? { createdTo } : {}),
    };

    try {
      const page = await sharedBillingClient().listCreditLots(request);
      const productNames = await this.loadLotProductNames(page.items);
      return ok({
        items: page.items.map((item) => ({
          lot_id: item.lotId,
          source: item.source,
          amount: item.amount,
          remaining: item.remaining,
          created_at: item.createdAt,
          expires_at: item.expiresAt,
          product_name: productNames.get(item.bizId) ?? null,
        })),
        total: page.total,
      });
    } catch (error) {
      throw toBillingError(error, "积分批次查询不可用");
    }
  }

  private async loadLotProductNames(
    items: BillingCreditLot[],
  ): Promise<Map<string, string>> {
    const tradeNos = items
      .filter((item) => item.bizType === RECHARGE_LOT_BIZ_TYPE && item.bizId !== "")
      .map((item) => item.bizId);
    if (tradeNos.length === 0) return new Map();
    const orders = await this.recharge.loadOrdersByTradeNos(tradeNos);
    return new Map([...orders].map(([tradeNo, order]) => [tradeNo, order.productName]));
  }

  @Get("orders")
  async orders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
  ) {
    const status = parseUserStatus(query.status);
    const createdFrom = parseInstant(query.created_from, "created_from");
    const createdTo = parseInstant(query.created_to, "created_to");

    const { items, total } = await this.recharge.listOrdersForAdmin({
      page: parsePageParam(query.page),
      pageSize: parsePageSizeParam(query.page_size),
      userId: Number(user.userId),
      ...(createdFrom ? { createdFrom: new Date(createdFrom) } : {}),
      ...(createdTo ? { createdTo: new Date(createdTo) } : {}),
      ...(status ? { statuses: toStoredOrderStatuses(status) } : {}),
    });

    return ok({
      items: items.map((order) => ({
        product_name: order.productName,
        product_type: order.productType,
        amount_fen: order.amountFen,
        credits: order.credits,
        bonus_credits: order.bonusCredits,
        status: toUserOrderStatus(order.status),
        created_at: order.createdAt,
        paid_at: order.paidAt,
        credits_valid_months: order.creditsValidMonths,
      })),
      total,
    });
  }

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
      throw new NewApiError(`未知导出字段：${unknown.join("/")}`, 400);
    }

    const collected = await this.collectExportRows(scope, user, query);
    const buffer = await buildExportWorkbook(collected, fields);

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

  private async collectExportRows(
    scope: ExportScope,
    user: AuthenticatedUser,
    query: Record<string, string>,
  ): Promise<ExportRows> {
    const createdFrom = parseInstant(query.created_from, "created_from");
    const createdTo = parseInstant(query.created_to, "created_to");
    const userId = Number(user.userId);

    if (scope === "orders") {
      const status = parseUserStatus(query.status);
      const { rows, total } = await this.paged(
        (page) =>
          this.recharge.listOrdersForAdmin({
            page,
            pageSize: EXPORT_PAGE_SIZE,
            userId,
            ...(createdFrom ? { createdFrom: new Date(createdFrom) } : {}),
            ...(createdTo ? { createdTo: new Date(createdTo) } : {}),
            ...(status ? { statuses: toStoredOrderStatuses(status) } : {}),
          }),
        (orders) =>
          orders.map((order) => ({
            product_name: order.productName,
            amount_fen: order.amountFen,
            credits: order.credits,
            bonus_credits: order.bonusCredits,
            status: toUserOrderStatus(order.status),
            created_at: order.createdAt,
            paid_at: order.paidAt,
          })),
      );
      return { scope: "orders", rows, total };
    }

    if (scope === "gain") {
      const { rows, total } = await this.paged(
        (page) =>
          sharedBillingClient().listCreditLots({
            userId,
            page,
            pageSize: EXPORT_PAGE_SIZE,
            ...(createdFrom ? { createdFrom } : {}),
            ...(createdTo ? { createdTo } : {}),
          }),
        async (lots) => {
          const productNames = await this.loadLotProductNames(lots);
          return lots.map((lot) => ({
            source: lot.source,
            amount: lot.amount,
            remaining: lot.remaining,
            created_at: lot.createdAt,
            expires_at: lot.expiresAt,
            product_name: productNames.get(lot.bizId) ?? null,
          }));
        },
      );
      return { scope: "gain", rows, total };
    }

    const types = parseTypes(query.type);
    const taskType = (query.task_type ?? "").trim();
    const model = (query.model ?? "").trim();

    let generationJobIds: string[] | undefined;
    if (taskType || model) {
      const resolved = await this.jobs.listJobIds({
        userId: user.userId,
        ...(taskType ? { type: taskType } : {}),
        ...(model ? { modelId: model } : {}),
        ...(createdFrom ? { createdFrom: new Date(createdFrom) } : {}),
        ...(createdTo ? { createdTo: new Date(createdTo) } : {}),
        limit: MAX_FILTER_JOB_IDS,
      });
      if (resolved.truncated) {
        throw new NewApiError(
          `按任务类型/模型命中的任务超过 ${MAX_FILTER_JOB_IDS} 条，请先缩小日期范围`,
          400,
        );
      }
      if (resolved.ids.length === 0) {
        return { scope: "consume", rows: [], total: 0 };
      }
      generationJobIds = resolved.ids;
    }

    const { rows, total } = await this.paged(
      (page) =>
        sharedBillingClient().listTransactions({
          userId,
          page,
          pageSize: EXPORT_PAGE_SIZE,
          ...(types.length ? { typeFilters: types } : {}),
          ...(createdFrom ? { createdFrom } : {}),
          ...(createdTo ? { createdTo } : {}),
          ...(generationJobIds ? { generationJobIds } : {}),
        }),
      (items) => this.mergeTaskSummaries(items),
    );
    return { scope: "consume", rows, total };
  }

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
