// @vitest-environment jsdom
/**
 * useJobStatus 单测：Node GenerationJob 轮询的三态迁移（succeeded/failed/processing）。
 * getJobStatus 返回 JobStatusData（snake_case：job_id/status/progress/asset{id,url,type}/error{code,message}）。
 * assetId 从 job.asset.id 转 String，全链路与 store.assets key 对齐（v2 生成出图要 assetId 入 store.addAsset）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useJobStatus } from "./useJobStatus";
import { getJobStatus } from "../api/generation";

vi.mock("../api/generation", () => ({ getJobStatus: vi.fn() }));
const mockGet = getJobStatus as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useJobStatus", () => {
  it("succeeded 带 assetId（String(asset.id)）+ assetUrl/assetType", async () => {
    mockGet.mockResolvedValue({
      job_id: "7",
      status: "succeeded",
      progress: 100,
      asset: { id: "42", url: "u42", type: "video" },
      error: null,
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

  it("failed → state.failed + error.message（asset 无），不进 succeeded", async () => {
    mockGet.mockResolvedValue({
      job_id: "8",
      status: "failed",
      progress: 0,
      asset: null,
      error: {
        code: "PROVIDER_ERROR",
        message: "模型调用失败",
        retryable: true,
      },
    });
    const { result } = renderHook(() => useJobStatus());
    act(() => {
      result.current.start(8);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.state).toMatchObject({
      status: "failed",
      jobId: 8,
      message: "模型调用失败",
    });
  });

  it("processing → state.polling + progress 持续更新（未清理）", async () => {
    mockGet.mockResolvedValue({
      job_id: "9",
      status: "processing",
      progress: 42,
      asset: null,
      error: null,
    });
    const { result } = renderHook(() => useJobStatus());
    act(() => {
      result.current.start(9);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.state).toMatchObject({
      status: "polling",
      jobId: 9,
      progress: 42,
    });
  });

  it("轮询异常（getJobStatus reject）→ state.failed + 异常 message", async () => {
    mockGet.mockRejectedValue(new Error("网络中断"));
    const { result } = renderHook(() => useJobStatus());
    act(() => {
      result.current.start(10);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.state).toMatchObject({
      status: "failed",
      message: "网络中断",
    });
  });
});
