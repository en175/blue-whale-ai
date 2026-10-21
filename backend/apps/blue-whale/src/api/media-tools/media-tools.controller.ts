import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { PARAM_MISSING_CODE, fail, ok } from "@lib/contracts";
import { MediaToolQuoteService } from "@lib/shared/media-tool-pricing/media-tool-quote.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

const TOOL_TYPE_PATTERN = /^[a-z0-9_]+$/;

@Controller("media-tools")
export class MediaToolsController {
  constructor(private readonly quotes: MediaToolQuoteService) {}

  @Post(":toolType/quote")
  @HttpCode(200)
  async quote(
    @CurrentUser() user: AuthenticatedUser,
    @Param("toolType") toolType: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (!TOOL_TYPE_PATTERN.test(toolType)) {
      return fail(PARAM_MISSING_CODE, "工具类型不合法");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return fail(PARAM_MISSING_CODE, "报价参数须为对象");
    }
    return ok(await this.quotes.quote(toolType, user.userId, body));
  }
}
