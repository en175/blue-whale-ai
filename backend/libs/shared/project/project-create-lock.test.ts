import { describe, expect, it, vi } from "vitest";

import { ProjectCreateLock } from "./project-create-lock.js";

function buildLock(redis: { set: unknown; eval: unknown }) {
  const lock = Object.create(ProjectCreateLock.prototype) as ProjectCreateLock;
  (lock as unknown as { redis: typeof redis }).redis = redis;
  return lock;
}

describe("ProjectCreateLock（IKST3D）", () => {
  it("按用户维度取锁，未抢到返回 null", async () => {
    const set = vi.fn().mockResolvedValue(null);
    const lock = buildLock({ set, eval: vi.fn() });

    await expect(lock.acquire("9")).resolves.toBeNull();
    expect(set).toHaveBeenCalledWith(
      "project:create:user:9",
      expect.any(String),
      "PX",
      30_000,
      "NX",
    );
  });

  it("抢到锁后可释放，且只删自己的 token", async () => {
    const set = vi.fn().mockResolvedValue("OK");
    const evalFn = vi.fn().mockResolvedValue(1);
    const lock = buildLock({ set, eval: evalFn });

    const lease = await lock.acquire("9");
    expect(lease).not.toBeNull();
    await lease!.release();

    expect(evalFn).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL', KEYS[1])"),
      1,
      "project:create:user:9",
      set.mock.calls[0][1],
    );
  });

  it("Redis 异常时放行，不阻断创建", async () => {
    const lock = buildLock({
      set: vi.fn().mockRejectedValue(new Error("redis down")),
      eval: vi.fn(),
    });

    const lease = await lock.acquire("9");
    expect(lease).not.toBeNull();
    await expect(lease!.release()).resolves.toBeUndefined();
  });

  it("释放失败不抛错", async () => {
    const lock = buildLock({
      set: vi.fn().mockResolvedValue("OK"),
      eval: vi.fn().mockRejectedValue(new Error("redis down")),
    });

    const lease = await lock.acquire("9");
    await expect(lease!.release()).resolves.toBeUndefined();
  });
});
