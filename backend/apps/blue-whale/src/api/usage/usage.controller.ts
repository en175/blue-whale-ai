import { Controller, Get, Headers } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { ok } from "@blue-whale/contracts";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import { toAuthError } from "@lib/shared/errors/auth-error.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";

@Controller("usage")
export class UsageController {
  constructor(private readonly account: AccountService) {}

  @Public()
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
