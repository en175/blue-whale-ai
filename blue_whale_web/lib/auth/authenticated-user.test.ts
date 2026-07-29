import { NewApiError, type NewApiAccountIdentity } from "@blue-whale/core";
import { describe, expect, it, vi } from "vitest";

import {
  AuthenticationError,
  createAuthenticatedUserResolver,
  getAuthenticatedUser,
  type AuthenticationPolicy,
} from "./authenticated-user";

function identity(userId = 42, status = 1): NewApiAccountIdentity {
  return {
    userId,
    username: "alice",
    email: null,
    status,
  };
}

function auth(
  getUser: ReturnType<typeof createAuthenticatedUserResolver>,
  token: string,
  policy?: AuthenticationPolicy,
) {
  return getUser(
    new Request("http://test", {
      headers: { Authorization: `Bearer ${token}` },
    }),
    policy ? { policy } : undefined,
  );
}

function resolver(
  resolveTokenIdentity: ReturnType<typeof vi.fn>,
  now: () => number = () => 0,
) {
  return createAuthenticatedUserResolver({
    resolveTokenIdentity,
    now,
    maxEntries: 1_024,
  });
}

describe("createAuthenticatedUserResolver", () => {
  it("rejects a missing authorization header without calling new-api", async () => {
    const resolveTokenIdentity = vi.fn();
    const getUser = resolver(resolveTokenIdentity);

    const result = getUser(new Request("http://test"));

    await expect(result).rejects.toBeInstanceOf(AuthenticationError);
    await expect(result).rejects.toMatchObject({ status: 401 });
    expect(resolveTokenIdentity).not.toHaveBeenCalled();
  });

  it("rejects an empty bearer token without calling new-api", async () => {
    const resolveTokenIdentity = vi.fn();
    const getUser = resolver(resolveTokenIdentity);

    await expect(
      getUser(
        new Request("http://test", {
          headers: { Authorization: "Bearer " },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(resolveTokenIdentity).not.toHaveBeenCalled();
  });

  it("rejects a non-sk token without calling new-api", async () => {
    const resolveTokenIdentity = vi.fn();
    const getUser = resolver(resolveTokenIdentity);

    await expect(auth(getUser, "not-an-api-key")).rejects.toMatchObject({
      status: 401,
    });
    expect(resolveTokenIdentity).not.toHaveBeenCalled();
  });

  it("rejects an empty sk token without calling new-api", async () => {
    const resolveTokenIdentity = vi.fn();
    const getUser = resolver(resolveTokenIdentity);

    await expect(auth(getUser, "sk-")).rejects.toMatchObject({ status: 401 });
    expect(resolveTokenIdentity).not.toHaveBeenCalled();
  });

  it("rejects old Java JWT without calling new-api", async () => {
    const resolveTokenIdentity = vi.fn();
    const getUser = resolver(resolveTokenIdentity);

    await expect(
      auth(getUser, "eyJhbGciOiJIUzI1NiJ9.old.jwt"),
    ).rejects.toMatchObject({ status: 401 });
    expect(resolveTokenIdentity).not.toHaveBeenCalled();
  });

  it("uses stable new-api user id instead of token fingerprint", async () => {
    const resolveTokenIdentity = vi.fn().mockResolvedValue(identity());
    const getUser = resolver(resolveTokenIdentity);

    await expect(auth(getUser, "sk-one")).resolves.toEqual({
      userId: "42",
      status: "enabled",
    });
    await expect(auth(getUser, "sk-two")).resolves.toEqual({
      userId: "42",
      status: "enabled",
    });
  });

  it("uses an ordinary cache hit without extending its absolute TTL", async () => {
    let now = 0;
    const resolveTokenIdentity = vi.fn().mockResolvedValue(identity());
    const getUser = resolver(resolveTokenIdentity, () => now);

    await auth(getUser, "sk-one");
    now = 59_999;
    await auth(getUser, "sk-one");
    expect(resolveTokenIdentity).toHaveBeenCalledTimes(1);

    now = 60_000;
    await auth(getUser, "sk-one");
    expect(resolveTokenIdentity).toHaveBeenCalledTimes(2);
  });

  it("fresh bypasses a valid cache without replacing the ordinary entry", async () => {
    const resolveTokenIdentity = vi
      .fn()
      .mockResolvedValueOnce(identity(42))
      .mockResolvedValueOnce(identity(43));
    const getUser = resolver(resolveTokenIdentity);

    await expect(auth(getUser, "sk-one")).resolves.toMatchObject({
      userId: "42",
    });
    await expect(auth(getUser, "sk-one", "fresh")).resolves.toMatchObject({
      userId: "43",
    });
    await expect(auth(getUser, "sk-one")).resolves.toMatchObject({
      userId: "42",
    });
    expect(resolveTokenIdentity).toHaveBeenCalledTimes(2);
  });

  it("fresh does not reuse an in-flight ordinary lookup", async () => {
    let resolveOrdinary!: (value: NewApiAccountIdentity) => void;
    const ordinaryIdentity = new Promise<NewApiAccountIdentity>((resolve) => {
      resolveOrdinary = resolve;
    });
    const resolveTokenIdentity = vi
      .fn()
      .mockImplementationOnce(() => ordinaryIdentity)
      .mockResolvedValueOnce(identity(43));
    const getUser = resolver(resolveTokenIdentity);

    const ordinaryRequest = auth(getUser, "sk-one");
    await vi.waitFor(() =>
      expect(resolveTokenIdentity).toHaveBeenCalledTimes(1),
    );
    const freshRequest = auth(getUser, "sk-one", "fresh");
    await Promise.resolve();

    try {
      expect(resolveTokenIdentity).toHaveBeenCalledTimes(1);
      resolveOrdinary(identity(42));
      await ordinaryRequest;
      await expect(freshRequest).resolves.toMatchObject({ userId: "43" });
      expect(resolveTokenIdentity).toHaveBeenCalledTimes(2);
    } finally {
      resolveOrdinary(identity(42));
      await Promise.allSettled([ordinaryRequest, freshRequest]);
    }
  });

  it("fresh 401 wins over an earlier ordinary lookup that succeeds late", async () => {
    let resolveOrdinary!: (value: NewApiAccountIdentity) => void;
    const ordinaryIdentity = new Promise<NewApiAccountIdentity>((resolve) => {
      resolveOrdinary = resolve;
    });
    const resolveTokenIdentity = vi
      .fn()
      .mockImplementationOnce(() => ordinaryIdentity)
      .mockRejectedValueOnce(new NewApiError("invalid token", 401))
      .mockResolvedValueOnce(identity(43));
    const getUser = resolver(resolveTokenIdentity);

    const ordinaryRequest = auth(getUser, "sk-one");
    await vi.waitFor(() =>
      expect(resolveTokenIdentity).toHaveBeenCalledTimes(1),
    );
    const freshRequest = auth(getUser, "sk-one", "fresh");
    await Promise.resolve();
    expect(resolveTokenIdentity).toHaveBeenCalledTimes(1);

    resolveOrdinary(identity(42));
    await ordinaryRequest;
    await expect(freshRequest).rejects.toMatchObject({
      status: 401,
    });

    await expect(auth(getUser, "sk-one")).resolves.toMatchObject({
      userId: "43",
    });
    expect(resolveTokenIdentity).toHaveBeenCalledTimes(3);
  });

  it("maps upstream 401 to 401 and evicts a cached identity", async () => {
    const resolveTokenIdentity = vi
      .fn()
      .mockResolvedValueOnce(identity(42))
      .mockRejectedValueOnce(new NewApiError("invalid token", 401))
      .mockResolvedValueOnce(identity(43));
    const getUser = resolver(resolveTokenIdentity);

    await auth(getUser, "sk-one");
    await expect(auth(getUser, "sk-one", "fresh")).rejects.toMatchObject({
      status: 401,
    });
    await expect(auth(getUser, "sk-one")).resolves.toMatchObject({
      userId: "43",
    });
    expect(resolveTokenIdentity).toHaveBeenCalledTimes(3);
  });

  it("maps upstream 403 to 403 and evicts a cached identity", async () => {
    const resolveTokenIdentity = vi
      .fn()
      .mockResolvedValueOnce(identity(42))
      .mockRejectedValueOnce(new NewApiError("disabled", 403))
      .mockResolvedValueOnce(identity(43));
    const getUser = resolver(resolveTokenIdentity);

    await auth(getUser, "sk-one");
    await expect(auth(getUser, "sk-one", "fresh")).rejects.toMatchObject({
      status: 403,
    });
    await expect(auth(getUser, "sk-one")).resolves.toMatchObject({
      userId: "43",
    });
    expect(resolveTokenIdentity).toHaveBeenCalledTimes(3);
  });

  it("rejects a successful disabled identity with 403 and evicts it", async () => {
    const resolveTokenIdentity = vi
      .fn()
      .mockResolvedValueOnce(identity(42))
      .mockResolvedValueOnce(identity(42, 2))
      .mockResolvedValueOnce(identity(43));
    const getUser = resolver(resolveTokenIdentity);

    await auth(getUser, "sk-one");
    await expect(auth(getUser, "sk-one", "fresh")).rejects.toMatchObject({
      status: 403,
    });
    await expect(auth(getUser, "sk-one")).resolves.toMatchObject({
      userId: "43",
    });
    expect(resolveTokenIdentity).toHaveBeenCalledTimes(3);
  });

  it.each([0, -1, 1.5])(
    "rejects malformed userId %s with 502",
    async (userId) => {
      const resolveTokenIdentity = vi.fn().mockResolvedValue(identity(userId));
      const getUser = resolver(resolveTokenIdentity);

      await expect(auth(getUser, "sk-one")).rejects.toMatchObject({
        status: 502,
      });
    },
  );

  it("retains upstream malformed-response status 502", async () => {
    const resolveTokenIdentity = vi
      .fn()
      .mockRejectedValue(new NewApiError("malformed response", 502));
    const getUser = resolver(resolveTokenIdentity);

    await expect(auth(getUser, "sk-one")).rejects.toMatchObject({
      status: 502,
    });
  });

  it("retains upstream unavailable status 503", async () => {
    const resolveTokenIdentity = vi
      .fn()
      .mockRejectedValue(new NewApiError("unavailable", 503));
    const getUser = resolver(resolveTokenIdentity);

    await expect(auth(getUser, "sk-one")).rejects.toMatchObject({
      status: 503,
    });
  });

  it("maps an unknown resolver error to 502", async () => {
    const resolveTokenIdentity = vi
      .fn()
      .mockRejectedValue(new Error("unexpected"));
    const getUser = resolver(resolveTokenIdentity);

    await expect(auth(getUser, "sk-one")).rejects.toMatchObject({
      status: 502,
    });
  });

  it("clears in-flight state after a synchronously thrown resolver error", async () => {
    const resolveTokenIdentity = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new NewApiError("unavailable", 503);
      })
      .mockResolvedValueOnce(identity());
    const getUser = resolver(resolveTokenIdentity);

    await expect(auth(getUser, "sk-one")).rejects.toMatchObject({
      status: 503,
    });
    await expect(auth(getUser, "sk-one")).resolves.toEqual({
      userId: "42",
      status: "enabled",
    });
    expect(resolveTokenIdentity).toHaveBeenCalledTimes(2);
  });

  it("maps missing production account configuration to 503 at request time", async () => {
    vi.stubEnv("NEW_API_BASE_URL", "");

    try {
      await expect(
        getAuthenticatedUser(
          new Request("http://test", {
            headers: { Authorization: "Bearer sk-no-production-config" },
          }),
          { policy: "fresh" },
        ),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fails closed on 503 after the cached identity expires", async () => {
    let now = 0;
    const resolveTokenIdentity = vi
      .fn()
      .mockResolvedValueOnce(identity())
      .mockRejectedValueOnce(new NewApiError("unavailable", 503));
    const getUser = resolver(resolveTokenIdentity, () => now);

    await auth(getUser, "sk-one");
    now = 60_000;

    await expect(auth(getUser, "sk-one")).rejects.toMatchObject({
      status: 503,
    });
    expect(resolveTokenIdentity).toHaveBeenCalledTimes(2);
  });

  it("shares one resolver promise for simultaneous misses of one digest", async () => {
    let complete!: (value: NewApiAccountIdentity) => void;
    const pendingIdentity = new Promise<NewApiAccountIdentity>((resolve) => {
      complete = resolve;
    });
    const resolveTokenIdentity = vi.fn(() => pendingIdentity);
    const getUser = resolver(resolveTokenIdentity);

    const first = auth(getUser, "sk-one");
    const second = auth(getUser, "sk-one");
    await Promise.resolve();
    expect(resolveTokenIdentity).toHaveBeenCalledTimes(1);

    complete(identity());
    await expect(Promise.all([first, second])).resolves.toEqual([
      { userId: "42", status: "enabled" },
      { userId: "42", status: "enabled" },
    ]);
  });

  it("uses only a 64-character hex digest as the injected cache key", async () => {
    const token = "sk-secret-that-must-not-enter-the-cache";
    const cache = {
      get: vi.fn(() => undefined),
      set: vi.fn(),
      delete: vi.fn(),
    };
    const resolveTokenIdentity = vi.fn().mockResolvedValue(identity());
    const getUser = createAuthenticatedUserResolver({
      resolveTokenIdentity,
      now: () => 0,
      maxEntries: 1_024,
      cache,
    });

    await auth(getUser, token);

    const cacheKeys = [cache.get, cache.set, cache.delete].flatMap((method) =>
      method.mock.calls.map(([key]) => key),
    );
    expect(cacheKeys.length).toBeGreaterThan(0);
    expect(cacheKeys).not.toContain(token);
    expect(cacheKeys).toEqual(
      expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/)]),
    );
    expect(cacheKeys.every((key) => /^[a-f0-9]{64}$/.test(key))).toBe(true);
  });
});
