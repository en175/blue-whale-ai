// @vitest-environment jsdom
/**
 * 画布入口页凭证失效恢复测试：
 * 401 不落"画布加载失败"死胡同；重新登录后自动重试解析项目。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CanvasPage from "./page";
import { ApiError, createProject, listProjects } from "@/lib/canvas";

const nav = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  openLoginMock: vi.fn(),
  authState: { user: null as unknown },
}));

// IK74TX 1.1/1.2/1.3：首页跳转参数可测——用例里改 params 后再 render。
const paramsState = vi.hoisted(() => ({
  map: new Map<string, string>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replaceMock }),
  useSearchParams: () => ({
    get: (key: string) => paramsState.map.get(key) ?? null,
    toString: () =>
      Array.from(paramsState.map.entries())
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&"),
  }),
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
  paramsState.map.clear();
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

describe("首页跳转（IK74TX 1.1/1.2/1.3）：带 tab 参数 → 新建项目 + 保留参数跳转", () => {
  it("带 tab=video 参数 → 新建项目（提示词命名）并保留全部 query 参数", async () => {
    window.localStorage.setItem("bw-user", STALE_USER);
    paramsState.map.set("tab", "video");
    paramsState.map.set("prompt", "海边黄昏 2 分钟");
    paramsState.map.set("model", "seedance-2");
    paramsState.map.set("ratio", "16:9");
    paramsState.map.set("assets", "1001,1002");
    vi.mocked(createProject).mockResolvedValue({
      id: 99,
      name: "海边黄昏 2 分钟",
      thumb: null,
      created_at: "",
    });

    render(<CanvasPage />);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("海边黄昏 2 分钟");
    });
    await waitFor(() => {
      expect(nav.replaceMock).toHaveBeenCalledWith(
        "/canvas?tab=video&prompt=%E6%B5%B7%E8%BE%B9%E9%BB%84%E6%98%8F+2+%E5%88%86%E9%92%9F&model=seedance-2&ratio=16%3A9&assets=1001%2C1002&project=99",
      );
    });
    // 首页跳转不查已有项目（新建独立会话）
    expect(mockedListProjects).not.toHaveBeenCalled();
  });

  it("带 tab=agent 参数无 prompt → 新建「未命名项目」", async () => {
    window.localStorage.setItem("bw-user", STALE_USER);
    paramsState.map.set("tab", "agent");
    vi.mocked(createProject).mockResolvedValue({
      id: 100,
      name: "未命名项目",
      thumb: null,
      created_at: "",
    });

    render(<CanvasPage />);

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("未命名项目");
    });
    await waitFor(() => {
      expect(nav.replaceMock).toHaveBeenCalledWith("/canvas?tab=agent&project=100");
    });
  });

  it("带 project 参数 + tab → 直接渲染运行时（不新建、不跳转）", async () => {
    window.localStorage.setItem("bw-user", STALE_USER);
    paramsState.map.set("project", "55");
    paramsState.map.set("tab", "video");

    render(<CanvasPage />);

    expect(createProject).not.toHaveBeenCalled();
    expect(mockedListProjects).not.toHaveBeenCalled();
    expect(nav.replaceMock).not.toHaveBeenCalled();
  });
});
