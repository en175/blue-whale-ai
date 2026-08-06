import { describe, expect, it, vi } from "vitest";

import { loadTextCompletionsConfig, resolveTextModel } from "./completions";

describe("loadTextCompletionsConfig", () => {
  it("NEW_API_BASE_URL 缺失 → null", () => {
    expect(loadTextCompletionsConfig({})).toBeNull();
  });

  it("NEW_API_BASE_URL 存在 → {baseUrl}", () => {
    expect(
      loadTextCompletionsConfig({ NEW_API_BASE_URL: "http://go.test" }),
    ).toEqual({ baseUrl: "http://go.test" });
  });
});

describe("resolveTextModel 白名单闸", () => {
  it("invalid_model: model 非字符串或空串", async () => {
    const listEnabledByType = vi.fn();
    const deps = { models: { listEnabledByType } };
    expect(await resolveTextModel("", [], deps)).toMatchObject({
      ok: false,
      status: 400,
      code: "invalid_model",
    });
    expect(await resolveTextModel(123, [], deps)).toMatchObject({
      ok: false,
      status: 400,
      code: "invalid_model",
    });
    expect(listEnabledByType).not.toHaveBeenCalled();
  });

  it("invalid_messages: messages 非数组", async () => {
    const listEnabledByType = vi.fn();
    const deps = { models: { listEnabledByType } };
    expect(await resolveTextModel("MiniMax-M3", "你好", deps)).toMatchObject({
      ok: false,
      status: 400,
      code: "invalid_messages",
    });
    expect(listEnabledByType).not.toHaveBeenCalled();
  });

  it("model_not_in_whitelist: 不在启用 text 行", async () => {
    const listEnabledByType = vi
      .fn()
      .mockResolvedValue([{ model_id: "MiniMax-M3" }]);
    const result = await resolveTextModel("gpt-4", [], {
      models: { listEnabledByType },
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "model_not_in_whitelist",
    });
    expect(listEnabledByType).toHaveBeenCalledWith("text");
  });

  it("ok: 命中启用 text 行，以 text 查白名单", async () => {
    const listEnabledByType = vi
      .fn()
      .mockResolvedValue([{ model_id: "MiniMax-M3" }]);
    const result = await resolveTextModel(
      "MiniMax-M3",
      [{ role: "user", content: "hi" }],
      { models: { listEnabledByType } },
    );
    expect(result).toEqual({ ok: true });
    expect(listEnabledByType).toHaveBeenCalledWith("text");
  });
});
