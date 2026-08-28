import { Controller, Get, Headers } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { FAILURE_CODE, ok } from "@blue-whale/contracts";
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
      if (error instanceof NewApiError && error.status === 200) {
        // 上游业务失败为 HTTP 200+success:false，透传原文，避免 toAuthError 吞成 502；
        // HTTP 用 400，否则前端 code===200 会当成功读到 null data。
        throw new NewApiError(error.message, FAILURE_CODE, error.code);
      }
      throw toAuthError(error);
    }
  }
}
