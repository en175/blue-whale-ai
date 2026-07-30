// @vitest-environment jsdom
/**
 * useVideoJobs 单测：并发轮询层。核心保证——多 job 各自独立 timer + 回调，互不覆盖。
 * 对照旧 useJobStatus（单 jobState/单 timer）：连续 start 会覆盖前一个 → 前一个丢轮询。
 * listJobs 返回 JobListItem（snake_case：job_id/status/progress/output_assets/error）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVideoJobs } from "./useVideoJobs";
import { listJobs } from "../api/generation";
import { ApiError } from "@/lib/api/errors";

vi.mock("../api/generation", () => ({ listJobs: vi.fn() }));
const mockList = listJobs as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

/** 构造 JobStatusData（snake_case），缺省安全值。 */
function job(over: Partial<{ job_id: string; status: string; progress: number; asset: { id: string; url: string; type: string } | null; error: { code: string; message: string; retryable?: boolean } | null }>): unknown {
  const asset = over.asset ?? null;
  return {
    job_id: "0",
    status: "processing",
    progress: 0,
    output_assets: asset ? [{ ...asset, width: null, height: null }] : [],
    error: null,
    ...over,
  };
}

describe("useVideoJobs", () => {
  it("单 job succeeded：回调带 String(asset.id) + url/type", async () => {
    mockList.mockResolvedValue([job({ job_id: "7", status: "succeeded", progress: 100, asset: { id: "42", url: "u42", type: "video" } })]);
    const { result } = renderHook(() => useVideoJobs());
    const onSucceeded = vi.fn();
    act(() => result.current.start(7, { onSucceeded, onFailed: vi.fn() }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(onSucceeded).toHaveBeenCalledWith({ assetId: "42", assetUrl: "u42", assetType: "video" });
    expect(result.current.activeCount()).toBe(0); // succeeded 后自动清理
  });

  it("★并发两 job：各自回调独立触发，互不覆盖（旧 hook 会丢一个）", async () => {
    mockList.mockResolvedValue([
      job({ job_id: "1", status: "succeeded", progress: 100, asset: { id: "11", url: "u11", type: "video" } }),
      job({ job_id: "2", status: "succeeded", progress: 100, asset: { id: "22", url: "u22", type: "video" } }),
    ]);
    const { result } = renderHook(() => useVideoJobs());
    const s1 = vi.fn();
    const s2 = vi.fn();
    act(() => {
      result.current.start(1, { onSucceeded: s1, onFailed: vi.fn() });
      result.current.start(2, { onSucceeded: s2, onFailed: vi.fn() }); // 不覆盖 job1
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(s1).toHaveBeenCalledWith({ assetId: "11", assetUrl: "u11", assetType: "video" });
    expect(s2).toHaveBeenCalledWith({ assetId: "22", assetUrl: "u22", assetType: "video" });
  });

  it("polling 中 onProgress 持续回调，未清理", async () => {
    mockList.mockResolvedValue([job({ job_id: "5", status: "processing", progress: 30 })]);
    const { result } = renderHook(() => useVideoJobs());
    const onProgress = vi.fn();
    act(() => result.current.start(5, { onProgress, onSucceeded: vi.fn(), onFailed: vi.fn() }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(onProgress).toHaveBeenCalledWith(30);
    expect(result.current.activeCount()).toBe(1);
  });

  it("failed → onFailed(error.message) + 清理", async () => {
    mockList.mockResolvedValue([job({ job_id: "9", status: "failed", error: { code: "X", message: "生成失败" } })]);
    const { result } = renderHook(() => useVideoJobs());
    const onFailed = vi.fn();
    act(() => result.current.start(9, { onSucceeded: vi.fn(), onFailed }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(onFailed).toHaveBeenCalledWith("生成失败");
    expect(result.current.activeCount()).toBe(0);
  });

  it("cancelled → onCancelled + 清理，不伪装成 provider failure", async () => {
    mockList.mockResolvedValue([job({ job_id: "12", status: "cancelled" })]);
    const { result } = renderHook(() => useVideoJobs());
    const onCancelled = vi.fn();
    const onFailed = vi.fn();
    act(() =>
      result.current.start(12, {
        onSucceeded: vi.fn(),
        onFailed,
        onCancelled,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();
    expect(result.current.activeCount()).toBe(0);
  });

  it("★轮询瞬时异常（listJobs reject）→ 不判死任何 Job，保留并下轮重试（修假失败）", async () => {
    mockList.mockRejectedValueOnce(new Error("network boom"));
    const { result } = renderHook(() => useVideoJobs());
    const onFailed = vi.fn();
    const onProgress = vi.fn();
    act(() => result.current.start(10, { onSucceeded: vi.fn(), onFailed, onProgress }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(onFailed).not.toHaveBeenCalled(); // 瞬时错误不把 job 判死
    expect(result.current.activeCount()).toBe(1); // job 仍在途
    // 下一轮恢复后正常推进
    mockList.mockResolvedValueOnce([job({ job_id: "10", status: "processing", progress: 50 })]);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(onProgress).toHaveBeenCalledWith(50);
  });

  it("★轮询遇 401（token 过期）→ 不判死 Job 且暂停轮询，避免 401 风暴（修假失败）", async () => {
    // 真实链路：/api/jobs 在 token 过期时返回 HTTP 200 + body {code:401}，
    // apiRequest 据此抛 ApiError(status=200, code="401")。
    mockList.mockRejectedValue(new ApiError({ status: 200, code: "401", message: "未登录或 token 已过期" }));
    const { result } = renderHook(() => useVideoJobs());
    const onFailed = vi.fn();
    act(() => result.current.start(10, { onSucceeded: vi.fn(), onFailed }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(onFailed).not.toHaveBeenCalled(); // 认证失效不把 job 判死
    expect(result.current.activeCount()).toBe(1); // job 保留（刷新后 recover 续上）
    // 轮询已暂停：再推进 9s 不应再发 listJobs（避免每 3s 重复 401）
    const callsAfter = mockList.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(mockList.mock.calls.length).toBe(callsAfter);
  });

  it("同 jobId 重复 start 幂等：只保留一个 timer（不重复轮询）", async () => {
    mockList.mockResolvedValue([job({ job_id: "3", status: "processing", progress: 10 })]);
    const { result } = renderHook(() => useVideoJobs());
    act(() => {
      result.current.start(3, { onSucceeded: vi.fn(), onFailed: vi.fn() });
      result.current.start(3, { onSucceeded: vi.fn(), onFailed: vi.fn() });
    });
    expect(result.current.activeCount()).toBe(1);
  });

  it("★返回对象 + 方法跨 render 引用稳定（消费方 effect 依赖链不被击穿）", () => {
    mockList.mockResolvedValue([job({ job_id: "1", status: "processing", progress: 0 })]);
    const { result, rerender } = renderHook(() => useVideoJobs());
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first); // 对象本身稳定（useMemo）
    expect(result.current.start).toBe(first.start); // 方法稳定（useCallback）
    expect(result.current.stopAll).toBe(first.stopAll);
  });

  it("stopAll 清所有 in-flight job（卸载防泄漏）", async () => {
    mockList.mockResolvedValue([]);
    const { result } = renderHook(() => useVideoJobs());
    act(() => {
      result.current.start(1, { onSucceeded: vi.fn(), onFailed: vi.fn() });
      result.current.start(2, { onSucceeded: vi.fn(), onFailed: vi.fn() });
    });
    expect(result.current.activeCount()).toBe(2);
    act(() => result.current.stopAll());
    expect(result.current.activeCount()).toBe(0);
  });

  it("10 个在途 Job 每个 3 秒周期只发一个 ids 批量请求", async () => {
    mockList.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => job({ job_id: String(i + 1), status: "processing", progress: i })),
    );
    const { result } = renderHook(() => useVideoJobs(7));
    act(() => {
      for (let i = 1; i <= 10; i += 1) {
        result.current.start(i, { onSucceeded: vi.fn(), onFailed: vi.fn() });
      }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith({ projectId: 7, jobIds: Array.from({ length: 10 }, (_, i) => i + 1) });
  });

  it("★批量响应连续缺少 Job 时不判死，保持轮询（修假失败：missing ≠ failed）", async () => {
    mockList.mockResolvedValue([job({ job_id: "1", status: "processing" })]);
    const { result } = renderHook(() => useVideoJobs());
    const onFailed = vi.fn();
    act(() => {
      result.current.start(1, { onSucceeded: vi.fn(), onFailed });
      result.current.start(2, { onSucceeded: vi.fn(), onFailed });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(onFailed).not.toHaveBeenCalled(); // missing 不判死
    expect(result.current.activeCount()).toBe(2); // 两个 job 都保留继续轮询
  });

  it("超过 100 个在途 Job 时按 API 上限分批请求", async () => {
    mockList.mockImplementation(async ({ jobIds }: { jobIds: number[] }) =>
      jobIds.map((jobId) => job({ job_id: String(jobId), status: "processing" })),
    );
    const { result } = renderHook(() => useVideoJobs());
    act(() => {
      for (let i = 1; i <= 101; i += 1) {
        result.current.start(i, { onSucceeded: vi.fn(), onFailed: vi.fn() });
      }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(mockList.mock.calls[0][0].jobIds).toHaveLength(100);
    expect(mockList.mock.calls[1][0].jobIds).toEqual([101]);
  });
});
