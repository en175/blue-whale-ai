import { describe, expect, it, vi } from "vitest";
import {
  LOGIN_FAILURE_SCOPE,
  LOGIN_LOCK_SCOPE,
  LoginFailureTracker,
} from "./login-failure-tracker.js";
import type { RateLimiter } from "./rate-limiter.js";

function fakeLimiter() {
  return {
    take: vi.fn(),
    reset: vi.fn(async () => undefined),
    block: vi.fn(async () => undefined),
    isBlocked: vi.fn(async () => false),
  };
}

describe("LoginFailureTracker", () => {
  it("does not lock before the threshold", async () => {
    const limiter = fakeLimiter();
    limiter.take.mockResolvedValue({ allowed: true });
    const tracker = new LoginFailureTracker(limiter as unknown as RateLimiter);
    tracker.configure({
      threshold: 3,
      windowMs: 60_000,
      blockMs: 120_000,
    });
    const blocked = vi.fn();
    tracker.onBlocked(blocked);

    await expect(tracker.recordFailure("alice")).resolves.toEqual({ locked: false });
    expect(limiter.take).toHaveBeenCalledWith({
      scope: LOGIN_FAILURE_SCOPE,
      key: "alice",
      limit: 2,
      windowMs: 60_000,
    });
    expect(limiter.block).not.toHaveBeenCalled();
    expect(blocked).not.toHaveBeenCalled();
  });

  it("blocks and notifies subscribers when take is denied", async () => {
    const limiter = fakeLimiter();
    limiter.take.mockResolvedValue({ allowed: false, retryAfter: 60 });
    const tracker = new LoginFailureTracker(limiter as unknown as RateLimiter);
    tracker.configure({
      threshold: 3,
      windowMs: 60_000,
      blockMs: 120_000,
    });
    const blocked = vi.fn();
    tracker.onBlocked(blocked);

    await expect(tracker.recordFailure("alice")).resolves.toEqual({ locked: true });
    expect(limiter.block).toHaveBeenCalledWith(LOGIN_LOCK_SCOPE, "alice", 120_000);
    expect(blocked).toHaveBeenCalledWith("alice");
  });

  it("clear resets failure count and lock", async () => {
    const limiter = fakeLimiter();
    const tracker = new LoginFailureTracker(limiter as unknown as RateLimiter);
    await tracker.clear("alice");
    expect(limiter.reset).toHaveBeenCalledWith(LOGIN_FAILURE_SCOPE, "alice", 15 * 60 * 1000);
    expect(limiter.reset).toHaveBeenCalledWith(LOGIN_LOCK_SCOPE, "alice");
  });
});
