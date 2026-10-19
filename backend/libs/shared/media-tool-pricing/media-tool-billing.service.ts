import { Injectable } from "@nestjs/common";
import { DomainError, FAILURE_CODE } from "@lib/contracts";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { sharedBillingClient } from "@lib/shared/billing/billing-client.js";
import { createBillingCharge, type BillingCharge } from "@lib/shared/billing/billing-charge.js";
import { createBillingQuote, type BillingQuote } from "@lib/shared/billing/billing-quote.js";
import {
  createBillingRelease,
  publishBillingJobTerminal,
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
          publish: publishBillingJobTerminal,
          logger,
        }),
        quote: createBillingQuote({ client, resolveTier, logger }),
      };
    }
    return this.deps;
  }

  private load(toolType: string) {
    return this.prisma.client.media_tool_pricing.findFirst({
      where: { tool_type: toolType, is_delete: false, enabled: true },
      select: {
        label: true,
        pricing: true,
        version: true,
        charge_enabled: true,
      },
    });
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
    return quoteMediaTool({
      row,
      toolType,
      userId,
      input,
      quote: this.billingDeps().quote,
    });
  }

  async release(
    toolType: string,
    userId: string,
    jobId: number,
    reason: string,
  ): Promise<void> {
    const row = await this.load(toolType);
    if (!row?.charge_enabled) return;
    await this.billingDeps().release({ userId, jobId, reason });
  }
}
