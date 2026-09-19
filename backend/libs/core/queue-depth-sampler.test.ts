import { afterEach, describe, expect, it, vi } from "vitest";

import { createQueueDepthSampler } from "./queue-depth-sampler.js";
import type { Logger, MetricEventInput } from "./logger.js";

function recordingLogger(): {
  logger: Logger;
  metricCalls: MetricEventInput[];
  warnCalls: string[];
} {
  const metricCalls: MetricEventInput[] = [];
  const warnCalls: string[] = [];
  const logger: Logger = {
    name: "test-queue",
    debug: () => {},
    info: () => {},
    warn: (message) => {
      warnCalls.push(message);
    },
    error: () => {},
    metric: (input) => {
      metricCalls.push(input);
    },
  };
  return { logger, metricCalls, warnCalls };
}

describe("createQueueDepthSampler（IK7G9Y）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("启动即采一次，此后每个周期按 (queue,status) 逐条发 queue_depth metric", async () => {
    vi.useFakeTimers();
    const { logger, metricCalls } = recordingLogger();
    const sampler = createQueueDepthSampler({
      logger,
      intervalMs: 30_000,
      sample: async () => [
        { queue: "generation_jobs", status: "queued", depth: 3 },
        { queue: "generation_jobs", status: "processing", depth: 1 },
      ],
    });

    sampler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(metricCalls).toEqual([
      { event: "queue_depth", fields: { queue: "generation_jobs", status: "queued", depth: 3 } },
      { event: "queue_depth", fields: { queue: "generation_jobs", status: "processing", depth: 1 } },
    ]);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(metricCalls).toHaveLength(4);
    await sampler.stop();
  });

  it("sample 抛错只告警不中断定时器", async () => {
    vi.useFakeTimers();
    const { logger, metricCalls, warnCalls } = recordingLogger();
    let calls = 0;
    const sampler = createQueueDepthSampler({
      logger,
      intervalMs: 1_000,
      sample: async () => {
        calls += 1;
        if (calls === 1) throw new Error("db down");
        return [{ queue: "agent_runs", status: "running", depth: 2 }];
      },
    });

    sampler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain("db down");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(metricCalls).toHaveLength(1);
    await sampler.stop();
  });

  it("stop 等待进行中的采样完成且 start 幂等", async () => {
    vi.useFakeTimers();
    const { logger, metricCalls } = recordingLogger();
    let resolveSample: ((value: []) => void) | null = null;
    const sampler = createQueueDepthSampler({
      logger,
      intervalMs: 30_000,
      sample: () =>
        new Promise<[]>((resolve) => {
          resolveSample = resolve;
        }),
    });

    sampler.start();
    sampler.start(); // 幂等：第二次不得叠加定时器
    let stopped = false;
    const stopPromise = sampler.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false); // 采样未 resolve，stop 必须等
    resolveSample!([]);
    await stopPromise;
    expect(stopped).toBe(true);
    expect(metricCalls).toHaveLength(0);
  });
});
