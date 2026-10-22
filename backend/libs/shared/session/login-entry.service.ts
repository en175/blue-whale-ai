import { Injectable } from "@nestjs/common";

import { ApiError } from "@lib/core";
import { createLogger } from "@lib/core/logging";
import {
  IdentityService,
  type LocalLoginResult,
} from "@lib/shared/identity/index.js";
import { SessionService } from "./session.service.js";

export interface LoginResponseData {
  token: string;
  user_id: number;
  username: string;
  nickname: string;
  email: string | null;
  phone: string;
  is_new_user: boolean;
  has_password: boolean;
  must_change_password: boolean;
}

export interface LoginEntry {
  token: string;
  data: LoginResponseData;
}

interface LoginAuditInput {
  userId?: string | null | undefined;
  username: string;
  ip: string;
  userAgent?: string | undefined;
  reason?: string | undefined;
}

function loginResponse(
  result: LocalLoginResult,
  isNewUser: boolean,
  token: string,
): LoginResponseData {
  return {
    token,
    user_id: result.userId,
    username: result.username,
    nickname: result.nickname ?? result.username,
    email: result.email ?? null,
    phone: result.phone ?? "",
    is_new_user: isNewUser,
    has_password: result.hasPassword,
    must_change_password: result.mustChangePassword,
  };
}

@Injectable()
export class LoginEntryService {
  private readonly logger = createLogger("login-entry");

  constructor(
    private readonly sessions: SessionService,
    private readonly identity: IdentityService,
  ) {}

  private async record(
    input: LoginAuditInput & { success: boolean },
  ): Promise<void> {
    try {
      await this.identity.recordLogin({
        userId: input.userId ?? null,
        username: input.username,
        ip: input.ip,
        userAgent: input.userAgent ?? "",
        success: input.success,
        reason: input.reason,
      });
    } catch (error) {
      this.logger.error(
        `登录日志写入失败（username=${input.username} success=${input.success}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async audit(input: LoginAuditInput): Promise<void> {
    await this.record({ ...input, success: true });
  }

  async fail(input: LoginAuditInput): Promise<void> {
    await this.record({ ...input, success: false });
  }

  async succeed(input: {
    result: LocalLoginResult;
    isNewUser: boolean;
    clientId?: unknown | undefined;
    ip: string;
    userAgent?: string | undefined;
    revokeOthers?: boolean;
  }): Promise<LoginEntry> {
    const { result } = input;
    if (result.userId == null || !result.username) {
      throw new ApiError("账户服务响应异常", 502, "invalid_identity");
    }
    const token = await this.sessions.issueToken(String(result.userId));
    await this.sessions.createSession(token, {
      userId: result.userId,
      username: result.username,
      role: result.role,
      status: result.status,
      email: result.email ?? null,
      ...(input.clientId ? { clientId: input.clientId } : {}),
    });
    if (input.revokeOthers) {
      await this.sessions.revokeAllForUser(result.userId, token);
    }
    await this.audit({
      userId: String(result.userId),
      username: result.username,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return {
      token,
      data: loginResponse(result, input.isNewUser, token),
    };
  }
}
