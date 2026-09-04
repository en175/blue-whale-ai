import { describe, expect, it, vi } from "vitest";

describe("video worker loop", () => {
  it("runs steps serially and backs off only when the queue is empty", async () => {
    const module = await import("./video-worker-loop.js").catch(() => ({}));
    const runLoop = (module as {
      runVideoWorkerLoop?: (options: Record<string, unknown>) => Promise<void>;
    }).runVideoWorkerLoop;

    expect(runLoop).toBeTypeOf("function");
    if (!runLoop) return;

    let active = 0;
    let maxActive = 0;
    let calls = 0;
    let stopping = false;
    const runStep = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls += 1;
      active -= 1;
      if (calls === 2) stopping = true;
      return calls === 1 ? "300" : null;
    });
    const wait = vi.fn().mockResolvedValue(undefined);

    await runLoop({
      runStep,
      shouldStop: () => stopping,
      wait,
      idleDelayMs: 500,
    });

    expect(runStep).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(500);
  });
});
