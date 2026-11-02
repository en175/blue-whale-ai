import { afterEach, describe, expect, it, vi } from "vitest";

async function loadQueueConstant(envSuffix?: string): Promise<string> {
  if (envSuffix === undefined) {
    delete process.env.MQ_ENV_SUFFIX;
  } else {
    process.env.MQ_ENV_SUFFIX = envSuffix;
  }
  vi.resetModules();
  const module = await import("./queue.constants.js");
  return module.GENERATION_TASK_QUEUE;
}

describe("GENERATION_TASK_QUEUE 环境后缀", () => {
  afterEach(() => {
    delete process.env.MQ_ENV_SUFFIX;
  });

  it("未配置 MQ_ENV_SUFFIX 时保持原 topic", async () => {
    expect(await loadQueueConstant(undefined)).toBe("generation-task");
    expect(await loadQueueConstant("")).toBe("generation-task");
    expect(await loadQueueConstant("  ")).toBe("generation-task");
  });

  it("配置 MQ_ENV_SUFFIX 时按 <名称>-<后缀> 拼接", async () => {
    expect(await loadQueueConstant("dev")).toBe("generation-task-dev");
    expect(await loadQueueConstant("-dev")).toBe("generation-task-dev");
  });
});
