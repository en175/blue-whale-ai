// @vitest-environment jsdom
/**
 * 画布入口页凭证失效恢复测试：
 * 401 不落"画布加载失败"死胡同；重新登录后自动重试解析项目。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CanvasPage from "./page";
import { ApiError, listProjects } from "@/lib/canvas";

const nav = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  openLoginMock: vi.fn(),
  authState: { user: null as unknown },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replaceMock }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("./CanvasProjectRuntime", () => ({
  CanvasProjectRuntime: () => null,
}));

vi.mock("@/components/auth/AuthContext", () => ({
  useAuth: () => ({ user: nav.authState.user, openLogin: nav.openLoginMock }),
}));

vi.mock("@/lib/canvas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/canvas")>();
  return {
    ...actual,
    listProjects: vi.fn(),
    createProject: vi.fn(),
  };
});

const mockedListProjects = vi.mocked(listProjects);

const STALE_USER = JSON.stringify({
  userId: 1,
  username: "root",
  phone: "13800000000",
  hasPassword: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  nav.authState.user = null;
});

describe("画布入口页凭证失效恢复", () => {
  it("401 → 不落死胡同，提示重新登录", async () => {
    window.localStorage.setItem("bw-user", STALE_USER);
    mockedListProjects.mockRejectedValue(new ApiError("请求失败: 401", 401));

    render(<CanvasPage />);

    await screen.findByText("登录已失效，请重新登录后继续");
    expect(screen.queryByText("画布加载失败，请刷新重试")).toBeNull();
    expect(nav.replaceMock).not.toHaveBeenCalledWith("/");
  });

  it("401 后重新登录 → 自动重试并进入画布", async () => {
    window.localStorage.setItem("bw-user", STALE_USER);
    mockedListProjects
      .mockImplementationOnce(async () => {
        // 模拟真实链路：401 → AuthContext 清空登录态（含本地用户）
        window.localStorage.removeItem("bw-user");
        throw new ApiError("请求失败: 401", 401);
      })
      .mockResolvedValueOnce([
        { id: 7, name: "p", thumb: null, created_at: "" },
      ]);

    const view = render(<CanvasPage />);
    await screen.findByText("登录已失效，请重新登录后继续");

    // 模拟 signIn 成功：AuthContext 写入 user + 持久化
    nav.authState.user = { userId: 1, username: "root" };
    window.localStorage.setItem("bw-user", STALE_USER);
    view.rerender(<CanvasPage />);

    await waitFor(() =>
      expect(nav.replaceMock).toHaveBeenCalledWith("/canvas?project=7"),
    );
  });

  it("未登录访客 → 回首页并弹登录", async () => {
    render(<CanvasPage />);
    await waitFor(() => expect(nav.replaceMock).toHaveBeenCalledWith("/"));
    expect(nav.openLoginMock).toHaveBeenCalled();
  });

  it("非 401 失败 → 显示加载失败文案", async () => {
    window.localStorage.setItem("bw-user", STALE_USER);
    mockedListProjects.mockRejectedValue(new ApiError("请求失败: 500", 500));

    render(<CanvasPage />);

    await screen.findByText("画布加载失败，请刷新重试");
  });

  it("登录失效提示上的按钮可重新唤起登录框", async () => {
    window.localStorage.setItem("bw-user", STALE_USER);
    mockedListProjects.mockRejectedValue(new ApiError("请求失败: 401", 401));

    render(<CanvasPage />);

    fireEvent.click(await screen.findByRole("button", { name: "重新登录" }));
    expect(nav.openLoginMock).toHaveBeenCalled();
  });
});
