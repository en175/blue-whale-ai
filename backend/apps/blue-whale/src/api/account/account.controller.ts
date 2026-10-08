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

const EXPORT_PAGE_SIZE = 100;

function parseTypes(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

const STATUSES = RECHARGE_ORDER_STATUSES;

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

  private async mergeTaskSummaries(items: BillingTransaction[]) {
    const summaries = await this.jobs.loadTaskSummaries(
      items.map((item) => item.generationJobId).filter((id): id is string => id != null),
    );
    return items.map((item) => {
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
        job_id: item.generationJobId,
        task_type: summary?.type ?? null,
        model_id: summary?.modelId ?? null,
        model_label: summary?.modelLabel ?? null,
        prompt: summary?.prompt ?? null,
        specs: summary?.specs ?? null,
      };
    });
  }

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
      userId: Number(user.userId),
      ...(status ? { status: status as RechargeOrderStatus } : {}),
    });

    return ok({
      items: items.map((order) => ({
        trade_no: order.tradeNo,
        product_name: order.productName,
        product_type: order.productType,
        amount_fen: order.amountFen,
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

    const collected = await this.collectExportRows(scope, Number(user.userId), query);
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
