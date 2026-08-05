import { describe, expect, it } from "vitest";

import { createIdentityCache } from "./identity-cache";

describe("createIdentityCache", () => {
  it("expires at now >= expiresAt and does not slide on get", () => {
    let now = 1_000;
    const cache = createIdentityCache({
      ttlMs: 60_000,
      maxEntries: 2,
      now: () => now,
    });

    cache.set("digest-a", {
      userId: "7",
      status: "enabled",
      isAdmin: false,
      username: "alice",
    });
    now = 60_999;
    expect(cache.get("digest-a")?.userId).toBe("7");
    now = 61_000;
    expect(cache.get("digest-a")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("evicts the least recently used entry at capacity", () => {
    const cache = createIdentityCache({
      ttlMs: 60_000,
      maxEntries: 2,
      now: () => 1_000,
    });

    cache.set("a", {
      userId: "1",
      status: "enabled",
      isAdmin: false,
      username: "alice",
    });
    cache.set("b", {
      userId: "2",
      status: "enabled",
      isAdmin: false,
      username: "alice",
    });
    cache.get("a");
    cache.set("c", {
      userId: "3",
      status: "enabled",
      isAdmin: false,
      username: "alice",
    });

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")?.userId).toBe("1");
    expect(cache.get("c")?.userId).toBe("3");
    expect(cache.size()).toBe(2);
  });

  it("deletes an entry by key", () => {
    const cache = createIdentityCache({
      ttlMs: 60_000,
      maxEntries: 2,
      now: () => 1_000,
    });

    cache.set("digest-a", {
      userId: "7",
      status: "enabled",
      isAdmin: false,
      username: "alice",
    });
    cache.delete("digest-a");

    expect(cache.get("digest-a")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("does not cache runtime properties outside the identity contract", () => {
    const cache = createIdentityCache({
      ttlMs: 60_000,
      maxEntries: 2,
      now: () => 1_000,
    });
    const identity: {
      userId: string;
      status: "enabled";
      isAdmin: boolean;
      username: string;
      token: string;
    } = {
      userId: "7",
      status: "enabled",
      isAdmin: true,
      username: "alice",
      token: "secret-token",
    };

    cache.set("digest-a", identity);

    expect(cache.get("digest-a")).toEqual({
      userId: "7",
      status: "enabled",
      isAdmin: true,
      username: "alice",
      expiresAt: 61_000,
    });
    expect(cache.get("digest-a")).not.toHaveProperty("token");
  });

  it("stays bounded when adding entries beyond capacity", () => {
    const cache = createIdentityCache({
      ttlMs: 60_000,
      maxEntries: 1,
      now: () => 1_000,
    });

    cache.set("a", {
      userId: "1",
      status: "enabled",
      isAdmin: false,
      username: "alice",
    });
    cache.set("b", {
      userId: "2",
      status: "enabled",
      isAdmin: false,
      username: "alice",
    });

    expect(cache.size()).toBe(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")?.userId).toBe("2");
  });
});
