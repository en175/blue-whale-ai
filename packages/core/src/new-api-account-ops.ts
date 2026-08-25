// IK74V8：从 new-api-client.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 账户面：能力探测、注册/登录、Token 身份与用量日志。
import {NewApiError, positiveInteger} from "./new-api-transport.js";
import type {NewApiEnvelope, NewApiRequest} from "./new-api-transport.js";
import type {NewApiAccountCapabilities, NewApiAccountIdentity, NewApiLog, NewApiLoginInput, NewApiLoginResult, NewApiRegisterInput, NewApiUsage} from "./new-api-types.js";

export function createNewApiAccountOps(request: NewApiRequest) {
  return {
    async getAccountCapabilities(): Promise<NewApiAccountCapabilities> {
      const response = await request<NewApiEnvelope>("/api/status", {
        method: "GET",
      });
      const data = (response.data ?? {}) as Record<string, unknown>;
      return {
        passwordLogin: data.password_login_enabled === true,
        passwordRegister:
          data.register_enabled === true &&
          data.password_register_enabled === true,
        emailVerification: data.email_verification === true,
      };
    },

    async register(input: NewApiRegisterInput): Promise<NewApiLoginResult> {
      const response = await request<NewApiEnvelope>("/api/user/register", {
        method: "POST",
        body: JSON.stringify({
          username: input.username,
          password: input.password,
          ...(input.email ? { email: input.email } : {}),
          ...(input.verificationCode
            ? { verification_code: input.verificationCode }
            : {}),
        }),
      });
      const data = (response.data ?? {}) as Record<string, unknown>;
      const userId = positiveInteger(data.user_id);
      if (
        userId === null ||
        typeof data.token !== "string" ||
        !data.token.startsWith("sk-") ||
        typeof data.username !== "string"
      ) {
        throw new NewApiError(
          "new-api 注册响应无效",
          502,
          "invalid_register_response",
          response,
        );
      }
      const role =
        typeof data.role === "number" && Number.isInteger(data.role)
          ? data.role
          : 1;
      const status =
        typeof data.status === "number" && Number.isInteger(data.status)
          ? data.status
          : 1;
      return {
        token: data.token,
        userId,
        username: data.username,
        email: typeof data.email === "string" ? data.email : null,
        role,
        status,
      };
    },

    async resolveTokenIdentity(token: string): Promise<NewApiAccountIdentity> {
      const response = await request<NewApiEnvelope>(
        "/api/token/identity",
        { method: "GET" },
        token,
      );
      const data = (response.data ?? {}) as Record<string, unknown>;
      const userId = positiveInteger(data.user_id);
      if (
        userId === null ||
        typeof data.username !== "string" ||
        typeof data.status !== "number"
      ) {
        throw new NewApiError(
          "new-api 身份响应无效",
          502,
          "invalid_identity_response",
          response,
        );
      }
      const role =
        typeof data.role === "number" && Number.isInteger(data.role)
          ? data.role
          : 1;
      return {
        userId,
        username: data.username,
        email: typeof data.email === "string" ? data.email : null,
        status: data.status,
        role,
      };
    },

    async login(input: NewApiLoginInput): Promise<NewApiLoginResult> {
      const response = await request<NewApiEnvelope>("/api/user/login", {
        method: "POST",
        body: JSON.stringify(input),
      });
      const data = (response.data ?? {}) as {
        token?: unknown;
        id?: unknown;
        user_id?: unknown;
        username?: unknown;
        email?: unknown;
        role?: unknown;
        status?: unknown;
      };
      const token = data.token;
      const userId = positiveInteger(data.user_id ?? data.id);
      if (
        typeof token !== "string" ||
        !token.startsWith("sk-") ||
        userId === null ||
        typeof data.username !== "string"
      ) {
        throw new NewApiError(
          "new-api 登录响应无效",
          502,
          "invalid_login_response",
          response,
        );
      }
      const role =
        typeof data.role === "number" && Number.isInteger(data.role)
          ? data.role
          : 1;
      const status =
        typeof data.status === "number" && Number.isInteger(data.status)
          ? data.status
          : 1;
      return {
        token,
        userId,
        username: data.username,
        email: typeof data.email === "string" ? data.email : null,
        role,
        status,
      };
    },

    async getTokenUsage(token: string): Promise<NewApiUsage> {
      const response = await request<NewApiEnvelope>(
        "/api/usage/token/",
        { method: "GET" },
        token,
      );
      const data = (response.data ?? {}) as Record<string, unknown>;
      const quota = data.user_quota ?? data.quota ?? data.total_available;
      if (typeof quota !== "number" || !Number.isFinite(quota)) {
        throw new NewApiError(
          "new-api usage 响应缺少 quota",
          502,
          "invalid_usage_response",
          response,
        );
      }
      return { userQuota: quota, raw: response.data };
    },

    async getTokenLogs(token: string): Promise<NewApiLog[]> {
      const response = await request<NewApiEnvelope>(
        "/api/log/token",
        { method: "GET" },
        token,
      );
      return Array.isArray(response.data) ? (response.data as NewApiLog[]) : [];
    },
  };
}
