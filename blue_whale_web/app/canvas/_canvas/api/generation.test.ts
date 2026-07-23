// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateAudio } from "./generation";

/**
 * generateAudio mock 单测（IJZXW7-B 占位）：后端无音频生成，前端 mock 兜底。
 * 验证：固定延迟后返 sample url + 假 assetId；mock 不发真 HTTP（边界）。
 */
describe("generateAudio mock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("固定延迟（1500ms）后 resolve sample url + 假 assetId", async () => {
    const p = generateAudio({ prompt: "猫叫", projectId: 1, duration: 5, modelId: "mock-tts" });
    await vi.advanceTimersByTimeAsync(1499);
    // 未到延迟不应 resolve（此时 p 仍 pending，无法同步断言；推进到 1500）
    await vi.advanceTimersByTimeAsync(1);
    const r = await p;
    expect(r.url).toMatch(/^https:\/\/www\.soundhelix\.com\/examples\/mp3\//);
    expect(typeof r.assetId).toBe("number");
    expect(r.assetId).toBeGreaterThan(0);
  });

  it("mock 不发真 HTTP（fetch 未被调）", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    const p = generateAudio({ prompt: "x", projectId: 1 });
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
