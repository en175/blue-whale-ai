import { createHash } from "node:crypto";

import { NewApiError, type NewApiAccountIdentity } from "@blue-whale/core";

import { createAccountClient, type AccountClient } from "@/lib/account/bff";
import { parseNewApiBearerToken } from "@/lib/auth/bearer-token";

import { createIdentityCache, type CachedIdentity } from "./identity-cache";

const TTL_MS = 60_000;
const MAX_ENTRIES = 1_024;
const ENABLED_STATUS = 1;
// new-api 角色：1 普通 / 10 管理员 / 100 root；>=10 视为管理身份。
export const ADMIN_ROLE_THRESHOLD = 10;

export type AuthenticatedUser = {
  userId: string;
  status: "enabled";
  isAdmin: boolean;
};

export type AuthenticationPolicy = "ordinary" | "fresh";

type AuthenticationOptions = {
  policy?: AuthenticationPolicy;
};

type IdentityCachePort = {
  get(key: string): CachedIdentity | undefined;
  set(key: string, identity: AuthenticatedUser): void;
  delete(key: string): void;
};

type InFlightMap = Map<string, Promise<AuthenticatedUser>>;

type AuthenticatedUserResolverDependencies = {
  resolveTokenIdentity: AccountClient["resolveTokenIdentity"];
  now: () => number;
  maxEntries: number;
  cache?: IdentityCachePort;
  inFlight?: InFlightMap;
};

const errorMessages: Record<AuthenticationError["status"], string> = {
  401: "登录凭证无效",
  403: "账户已停用",
  502: "账户服务响应异常",
  503: "账户服务暂不可用",
};

export class AuthenticationError extends Error {
  constructor(public readonly status: 401 | 403 | 502 | 503) {
    super(errorMessages[status]);
    this.name = "AuthenticationError";
  }
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function classifyResolverError(error: unknown): AuthenticationError {
  if (error instanceof AuthenticationError) {
    return error;
  }

  if (
    error instanceof NewApiError &&
    (error.status === 401 ||
      error.status === 403 ||
      error.status === 502 ||
      error.status === 503)
  ) {
    return new AuthenticationError(error.status);
  }

  return new AuthenticationError(502);
}

function authenticatedUser(identity: NewApiAccountIdentity): AuthenticatedUser {
  if (!Number.isInteger(identity.userId) || identity.userId <= 0) {
    throw new AuthenticationError(502);
  }

  if (identity.status !== ENABLED_STATUS) {
    throw new AuthenticationError(403);
  }

  return {
    userId: String(identity.userId),
    status: "enabled",
    isAdmin: identity.role >= ADMIN_ROLE_THRESHOLD,
  };
}

export function createAuthenticatedUserResolver({
  resolveTokenIdentity,
  now,
  maxEntries,
  cache = createIdentityCache({
    ttlMs: TTL_MS,
    maxEntries,
    now,
  }),
  inFlight = new Map<string, Promise<AuthenticatedUser>>(),
}: AuthenticatedUserResolverDependencies) {
  return async function getAuthenticatedUser(
    request: Request,
    options: AuthenticationOptions = {},
  ): Promise<AuthenticatedUser> {
    const token = parseNewApiBearerToken(request.headers.get("authorization"));
    if (!token) {
      throw new AuthenticationError(401);
    }

    const digest = tokenDigest(token);
    const policy = options.policy ?? "ordinary";

    if (policy === "ordinary") {
      const cachedIdentity = cache.get(digest);
      if (cachedIdentity) {
        return {
          userId: cachedIdentity.userId,
          status: cachedIdentity.status,
          isAdmin: cachedIdentity.isAdmin,
        };
      }
    }

    if (policy === "fresh") {
      try {
        await inFlight.get(digest);
      } catch {
        // Fresh must still perform its own real-time lookup after an ordinary
        // request settles, regardless of that request's result.
      }
    }

    if (policy === "ordinary") {
      const currentResolution = inFlight.get(digest);
      if (currentResolution) {
        return currentResolution;
      }
    }

    const resolution = (async () => {
      try {
        const identity = await Promise.resolve().then(() =>
          resolveTokenIdentity(token),
        );
        const user = authenticatedUser(identity);

        if (policy === "ordinary") {
          cache.set(digest, user);
        }

        return user;
      } catch (error) {
        const authenticationError = classifyResolverError(error);
        if (
          authenticationError.status === 401 ||
          authenticationError.status === 403
        ) {
          cache.delete(digest);
        }
        throw authenticationError;
      }
    })();

    if (policy === "fresh") {
      return resolution;
    }

    inFlight.set(digest, resolution);

    return resolution.finally(() => {
      if (inFlight.get(digest) === resolution) {
        inFlight.delete(digest);
      }
    });
  };
}

const productionCache = createIdentityCache({
  ttlMs: TTL_MS,
  maxEntries: MAX_ENTRIES,
  now: Date.now,
});
const productionInFlight: InFlightMap = new Map();
const productionResolver = createAuthenticatedUserResolver({
  resolveTokenIdentity: (token) =>
    createAccountClient().resolveTokenIdentity(token),
  now: Date.now,
  maxEntries: MAX_ENTRIES,
  cache: productionCache,
  inFlight: productionInFlight,
});

export function getAuthenticatedUser(
  request: Request,
  options?: AuthenticationOptions,
): Promise<AuthenticatedUser> {
  return productionResolver(request, options);
}
