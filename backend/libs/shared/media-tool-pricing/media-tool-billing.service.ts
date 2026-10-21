import { Injectable } from "@nestjs/common";
import { DomainError, FAILURE_CODE } from "@lib/contracts";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { sharedBillingClient } from "@lib/shared/billing/billing-client.js";
import { createBillingCharge, type BillingCharge } from "@lib/shared/billing/billing-charge.js";
import { createBillingQuote, type BillingQuote } from "@lib/shared/billing/billing-quote.js";
import {
  createBillingRelease,
  createOutboxTerminalEnqueue,
  type BillingRelease,
} from "@lib/shared/billing/billing-release.js";
import { quoteRevisionOf } from "@lib/shared/generation/handle-quote-generation-job.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
import type { JobBilling } from "@lib/shared/persistence/job-billing.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

export interface MediaToolPricingSnapshot {
  label: string;
  pricing: unknown;
  version: number;
  charge_enabled: boolean;
}

export interface MediaToolQuote {
  credits: number | null;
  quote_revision: string | null;
}

export interface MediaToolJobBillingArgs {
  row: MediaToolPricingSnapshot;
  toolType: string;
  userId: string;
  input: Record<string, unknown>;
  charge: BillingCharge;
  release: BillingRelease;
}

export function createMediaToolJobBilling(args: MediaToolJobBillingArgs): JobBilling {
  const ruleSnapshot = JSON.stringify(args.row.pricing);
  return {
    charge: (jobId) =>
      args.charge({
        userId: args.userId,
        jobId,
        commandId: `media-tool:${args.toolType}:${jobId}`,
        modelId: args.toolType,
        taskType: args.toolType,
        input: args.input,
        title: args.row.label,
        ruleSnapshot,
      }),
    release: (jobId, reason) =>
      args.release({ userId: args.userId, jobId, reason }),
  };
}

export interface MediaToolQuoteArgs {
  row: MediaToolPricingSnapshot;
  toolType: string;
  userId: string;
  input: Record<string, unknown>;
  quote: BillingQuote;
}

export async function quoteMediaTool(args: MediaToolQuoteArgs): Promise<MediaToolQuote> {
  const quote = await args.quote({
    userId: args.userId,
    modelId: args.toolType,
    taskType: args.toolType,
    input: args.input,
    ruleSnapshot: JSON.stringify(args.row.pricing),
  });
  if (quote === null) {
    return { credits: null, quote_revision: null };
  }
  return {
    credits: Number(quote.credits),
    quote_revision: quoteRevisionOf({
      catalogVersion: quote.catalogVersion,
      capabilityVersion: args.row.version,
      tier: quote.tier,
      quoteInput: args.input,
    }),
  };
}

export function freeMediaToolQuote(
  row: MediaToolPricingSnapshot,
  input: Record<string, unknown>,
): MediaToolQuote {
  return {
    credits: 0,
    quote_revision: quoteRevisionOf({
      catalogVersion: 0,
      capabilityVersion: row.version,
      tier: "free",
      quoteInput: input,
    }),
  };
}

@Injectable()
export class MediaToolBillingService {
  private deps?: {
    charge: BillingCharge;
    release: BillingRelease;
    quote: BillingQuote;
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  private billingDeps() {
    if (this.deps === undefined) {
      const client = sharedBillingClient();
      const resolveTier = (userId: string) => this.identity.resolveTier(userId);
      this.deps = {
        charge: createBillingCharge({ client, resolveTier, logger }),
        release: createBillingRelease({
          enqueue: createOutboxTerminalEnqueue(this.prisma.client),
          logger,
        }),
        quote: createBillingQuote({ client, resolveTier, logger }),
      };
    }
    return this.deps;
  }

  private async load(toolType: string) {
    const row = await this.prisma.client.media_tool_pricing.findUnique({
      where: { tool_type: toolType },
      select: {
        label: true,
        pricing: true,
        version: true,
        charge_enabled: true,
        enabled: true,
        is_delete: true,
      },
    });
    if (!row || row.is_delete || !row.enabled) return null;
    return row;
  }

  async jobBilling(
    toolType: string,
    userId: string,
    input: Record<string, unknown>,
  ): Promise<JobBilling | undefined> {
    const row = await this.load(toolType);
    if (!row) {
      throw new DomainError(
        FAILURE_CODE,
        `工具计价未配置或已停用：${toolType}`,
      );
    }
    if (!row.charge_enabled) return undefined;
    const { charge, release } = this.billingDeps();
    return createMediaToolJobBilling({
      row,
      toolType,
      userId,
      input,
      charge,
      release,
    });
  }

  async quote(
    toolType: string,
    userId: string,
    input: Record<string, unknown>,
  ): Promise<MediaToolQuote> {
    const row = await this.load(toolType);
    if (!row) return { credits: null, quote_revision: null };
    if (!row.charge_enabled) return freeMediaToolQuote(row, input);
    try {
      return await quoteMediaTool({
        row,
        toolType,
        userId,
        input,
        quote: this.billingDeps().quote,
      });
    } catch (error) {
      logger.warn(
        `[billing] 工具报价不可用，本次不显示价格：tool=${toolType} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { credits: null, quote_revision: null };
    }
  }

  async release(userId: string, jobId: number, reason: string): Promise<void> {
    try {
      await this.billingDeps().release({ userId, jobId, reason });
    } catch (error) {
      logger.error(
        `[billing] 工具退款事件发布失败：user=${userId} job=${jobId} 原因=${reason} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
