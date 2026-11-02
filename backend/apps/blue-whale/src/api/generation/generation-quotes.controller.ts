import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { PARAM_MISSING_CODE, fail, ok } from "@lib/contracts";
import { generationEstimateRequestSchema } from "@lib/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { sharedBillingClient } from "@lib/shared/billing/billing-client.js";
import { createBillingQuote, type BillingQuote } from "@lib/shared/billing/billing-quote.js";
import { handleEstimateGeneration } from "@lib/shared/generation/handle-estimate-generation.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { AccountDirectoryService } from "@lib/shared/identity/index.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("generation-quotes")
export class GenerationQuotesController {
  constructor(
    private readonly models: ModelCapabilityReadService,
    private readonly directory: AccountDirectoryService,
  ) {}

  private billingQuoteDep?: BillingQuote;

  private billingQuote(): BillingQuote {
    if (this.billingQuoteDep === undefined) {
      this.billingQuoteDep = createBillingQuote({
        client: sharedBillingClient(),
        resolveTier: (userId) => this.directory.resolveTier(userId),
        logger,
      });
    }
    return this.billingQuoteDep;
  }

  @Post()
  @HttpCode(200)
  async estimate(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = generationEstimateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, "报价参数不合法");
    }

    let quote: BillingQuote;
    try {
      quote = this.billingQuote();
    } catch (error) {
      logger.warn(
        `[generation] 报价不可用，本次不显示价格：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return ok({ credits: null });
    }
    return handleEstimateGeneration(user.userId, parsed.data, {
      models: this.models,
      quote,
    });
  }
}
