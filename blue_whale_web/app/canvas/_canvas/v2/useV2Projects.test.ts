// @vitest-environment jsdom
/**
 * useV2Projects 单测：projectId 由 URL 路由传入（非内部 state）。
 * seam = hook 公共返回。覆盖：list + activeProject 命中、messages 隔离、createProject 返回 id。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/lib/canvas", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  loadCanvas: vi.fn(),
  saveCanvas: vi.fn(),
}));
vi.mock("@/components/auth/authStorage", () => ({
  loadAccessToken: () => "tok",
}));

import { useV2Projects } from "./useV2Projects";
import * as canvasApi from "@/lib/canvas";

const listProjects = canvasApi.listProjects as ReturnType<typeof vi.fn>;
const createProjectApi = canvasApi.createProject as ReturnType<typeof vi.fn>;

const dto = (id: number | string, name: string) => ({
  id,
  name,
  thumb: null as null,
  created_at: "",
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useV2Projects", () => {
  it("list 成功 + projectId 匹配 → activeProject 命中（active 来自 URL）", async () => {
    listProjects.mockResolvedValue([dto(1, "A"), dto(2, "B")]);
    const { result } = renderHook(() => useV2Projects("2"));
    await waitFor(() => expect(result.current.backendReady).toBe(true));
    expect(result.current.projects).toHaveLength(2);
    expect(result.current.activeProject?.id).toBe("2");
    expect(result.current.booting).toBe(false);
  });

  it("messages 按 projectId 隔离（rerender 模拟 URL 切换）", async () => {
    listProjects.mockResolvedValue([dto(1, "A"), dto(2, "B")]);
    const { result, rerender } = renderHook(({ pid }) => useV2Projects(pid), {
      initialProps: { pid: "1" as string | null },
    });
    await waitFor(() => expect(result.current.backendReady).toBe(true));
    act(() =>
      result.current.appendMessages([{ id: "m1", type: "user", text: "hi" }]),
    );
    expect(result.current.messages).toHaveLength(1);
    rerender({ pid: "2" });
    expect(result.current.activeProject?.id).toBe("2");
    expect(result.current.messages).toEqual([]); // B 无消息
    rerender({ pid: "1" });
    expect(result.current.messages).toHaveLength(1); // 回 A，消息保留
  });

  it("createProject：落库 + 入列 + 返回新 id（调用方 router.push）", async () => {
    listProjects.mockResolvedValue([dto(1, "A")]);
    createProjectApi.mockResolvedValue(dto(5, "2026-07-22 10:00"));
    const { result } = renderHook(() => useV2Projects("1"));
    await waitFor(() => expect(result.current.backendReady).toBe(true));
    let id: string | null = null;
    await act(async () => {
      id = await result.current.createProject();
    });
    expect(result.current.projects).toHaveLength(2);
    expect(id).toBe("5");
  });

  it("超大项目 ID 重命名和删除时保持十进制字符串精度", async () => {
    const projectId = "9007199254740993";
    listProjects.mockResolvedValue([dto(projectId, "A")]);
    vi.mocked(canvasApi.renameProject).mockResolvedValue(dto(projectId, "B"));
    vi.mocked(canvasApi.deleteProject).mockResolvedValue(undefined);
    const { result } = renderHook(() => useV2Projects(projectId));
    await waitFor(() => expect(result.current.backendReady).toBe(true));

    await act(async () => {
      await result.current.renameProject(projectId, "B");
      await result.current.deleteProject(projectId);
    });

    expect(canvasApi.renameProject).toHaveBeenCalledWith(projectId, "B");
    expect(canvasApi.deleteProject).toHaveBeenCalledWith(projectId);
  });
});
