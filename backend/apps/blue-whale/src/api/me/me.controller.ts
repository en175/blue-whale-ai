import { Controller, Get, Headers } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { ok } from "@blue-whale/contracts";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import { toAuthError } from "@lib/shared/errors/auth-error.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";

const ADMIN_ROLE_THRESHOLD = 10;

@Controller()
export class MeController {
  constructor(private readonly account: AccountService) {}

  @Public()
  @Get("me")
  async me(@Headers("authorization") authorization?: string) {
    const token = parseBearerToken(authorization);
    if (!token) {
      throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    }
    try {
      const identity = await this.account.resolveTokenIdentity(token);
      return ok({
        user_id: identity.userId,
        username: identity.username,
        email: identity.email,
        phone: "",
        has_password: true,
        is_admin: identity.role >= ADMIN_ROLE_THRESHOLD,
      });
    } catch (error) {
      throw toAuthError(error);
    }
  }
}
