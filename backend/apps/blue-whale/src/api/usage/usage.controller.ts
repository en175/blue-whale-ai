import { Controller, Get, Headers } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { ok } from "@blue-whale/contracts";
import { AccountService } from "@lib/shared/account/account.service.js";
import { toAuthError } from "@lib/shared/errors/auth-error.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";

/** 走全局 AuthGuard：守卫已把 sess_ 会话回注为真实 sk-，此处照旧自解析代打 new-api。 */
@Controller("usage")
export class UsageController {
  constructor(private readonly account: AccountService) {}

  @Get("token")
  async token(@Headers("authorization") authorization?: string) {
    const token = parseBearerToken(authorization);
    if (!token) throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    try {
      const usage = await this.account.getTokenUsage(token);
      return ok({ quota: usage.userQuota });
    } catch (error) {
      throw toAuthError(error);
    }
  }
}
