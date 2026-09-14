import { describe, expect, it, vi } from "vitest";

import { createLogger } from "./logger.js";
import { metricEventsFrom } from "./metric-test-support.js";
import { timedProviderCall } from "./timed-provider-call.js";

const QUIET = { envSource: {} as NodeJS.ProcessEnv };

describe("timedProviderCall（IK7G9Y）", () => {
  it("成功：返回结果并打 provider_call ok 带 duration_ms", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("unit-svc", QUIET);

    const result = await timedProviderCall(
      logger,
      { provider: "p", operation: "op" },
      async () => 42,
    );

    expect(result).toBe(42);
    const events = metricEventsFrom(logSpy.mock.calls);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "provider_call",
      result: "ok",
      provider: "p",
      operation: "op",
    });
    expect(typeof events[0]!.duration_ms).toBe("number");
    logSpy.mockRestore();
  });

  it("失败：原样抛出并打 provider_call fail", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("unit-svc", QUIET);
    const boom = new Error("upstream down");

    await expect(
      timedProviderCall(
        logger,
        { provider: "p", operation: "op" },
        async () => {
          throw boom;
        },
      ),
    ).rejects.toBe(boom);

    const events = metricEventsFrom(logSpy.mock.calls);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "provider_call",
      result: "fail",
      provider: "p",
      operation: "op",
    });
    logSpy.mockRestore();
  });
});
