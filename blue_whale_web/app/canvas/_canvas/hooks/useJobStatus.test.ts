// @vitest-environment jsdom
/**
 * useJobStatus 单测：视频轮询 succeeded 带 assetId（v2 生成路径要 assetId 入 store.addAsset）。
 * assetId 从 job.asset.id 转 String，全链路与 store.assets key 对齐。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useJobStatus } from "./useJobStatus";
import { getJobStatus } from "../api/generation";

vi.mock("../api/generation", () => ({ getJobStatus: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useJobStatus", () => {
  it("succeeded 带 assetId（String(asset.id)）+ assetUrl/assetType", async () => {
    (getJobStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: 7,
      status: "succeeded",
      progress: 100,
      asset: { id: 42, url: "u42", type: "video" },
    });
    const { result } = renderHook(() => useJobStatus());
    act(() => {
      result.current.start(7);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.state.status).toBe("succeeded");
    expect(result.current.state).toMatchObject({
      assetId: "42",
      assetUrl: "u42",
      assetType: "video",
    });
  });
});
