// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { useProjectConversation } from "./useProjectConversation";

const { applyPlanMessageMock } = vi.hoisted(() => ({
  applyPlanMessageMock: vi.fn(),
}));

vi.mock("@/lib/conversation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/conversation")>()),
  applyPlanMessage: applyPlanMessageMock,
}));

vi.mock("@/lib/project-recovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/project-recovery")>()),
  runProjectRecovery: vi.fn(() => new Promise(() => {})),
}));

describe("useProjectConversation 手动应用计划 CommandId", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("网络结果未知时重试同一计划复用 CommandId", async () => {
    applyPlanMessageMock.mockRejectedValue(new Error("network unavailable"));
    const { result } = renderHook(() =>
      useProjectConversation("project-1", true),
    );

    await expect(result.current.applyPlan(7)).rejects.toThrow(
      "network unavailable",
    );
    await expect(result.current.applyPlan(7)).rejects.toThrow(
      "network unavailable",
    );

    expect(applyPlanMessageMock).toHaveBeenCalledTimes(2);
    expect(applyPlanMessageMock.mock.calls[1]?.[2]).toBe(
      applyPlanMessageMock.mock.calls[0]?.[2],
    );
  });

  it("网络结果未知后切换项目再返回仍复用原 CommandId", async () => {
    applyPlanMessageMock.mockRejectedValue(new Error("network unavailable"));
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) =>
        useProjectConversation(projectId, true),
      { initialProps: { projectId: "project-1" } },
    );

    await expect(result.current.applyPlan(7)).rejects.toThrow(
      "network unavailable",
    );
    const originalCommandId = applyPlanMessageMock.mock.calls[0]?.[2];

    rerender({ projectId: "project-2" });
    rerender({ projectId: "project-1" });
    await expect(result.current.applyPlan(7)).rejects.toThrow(
      "network unavailable",
    );

    expect(applyPlanMessageMock).toHaveBeenCalledTimes(2);
    expect(applyPlanMessageMock.mock.calls[1]?.[2]).toBe(originalCommandId);
  });

  it("明确零写入失败后重试同一计划使用新 CommandId", async () => {
    applyPlanMessageMock.mockRejectedValue(
      new ApiError({ status: 200, code: "100405", message: "余额不足" }),
    );
    const { result } = renderHook(() =>
      useProjectConversation("project-1", true),
    );

    await expect(result.current.applyPlan(7)).rejects.toThrow("余额不足");
    await expect(result.current.applyPlan(7)).rejects.toThrow("余额不足");

    expect(applyPlanMessageMock).toHaveBeenCalledTimes(2);
    expect(applyPlanMessageMock.mock.calls[1]?.[2]).not.toBe(
      applyPlanMessageMock.mock.calls[0]?.[2],
    );
  });
});
