// @vitest-environment jsdom
/**
 * 项目管理页组件测试（IK25EG）。
 *
 * 请求层（canvas / generation-inbox）与 next/navigation 全部 mock；
 * 覆盖：双数据源合并展示、生成空间标识、打开目标、新建、改名、
 * 二次确认删除与各类失败不误报成功。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
} from "@/lib/canvas";
import {
  deleteGenerationInbox,
  getGenerationInbox,
} from "@/lib/generation-inbox";
import ProjectsPage from "./page";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/canvas", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock("@/lib/generation-inbox", () => ({
  getGenerationInbox: vi.fn(),
  deleteGenerationInbox: vi.fn(),
}));

const CANVAS_PROJECTS = [
  { id: 1, name: "海报项目", thumb: null, created_at: "2026-07-18T08:00:00Z" },
  { id: 2, name: "Logo 设计", thumb: null, created_at: "2026-07-19T08:00:00Z" },
];

const INBOX = {
  project: {
    id: 42,
    name: "生成收件箱",
    thumb: null,
    created_at: "2026-07-19T10:00:00Z",
    purpose: "generation_inbox",
  },
  active_conversation_id: 2,
};

const mockedListProjects = vi.mocked(listProjects);
const mockedGetInbox = vi.mocked(getGenerationInbox);
const mockedCreateProject = vi.mocked(createProject);
const mockedRenameProject = vi.mocked(renameProject);
const mockedDeleteProject = vi.mocked(deleteProject);
const mockedDeleteInbox = vi.mocked(deleteGenerationInbox);

beforeEach(() => {
  vi.clearAllMocks();
  mockedListProjects.mockResolvedValue(CANVAS_PROJECTS);
  mockedGetInbox.mockResolvedValue(INBOX);
});

describe("ProjectsPage 列表", () => {
  it("加载后同时显示普通项目与生成收件箱，收件箱带「生成空间」标识", async () => {
    render(<ProjectsPage />);

    await screen.findByText("海报项目");
    expect(screen.getByText("Logo 设计")).toBeInTheDocument();
    expect(screen.getByText("生成收件箱")).toBeInTheDocument();
    expect(screen.getByText("生成空间")).toBeInTheDocument();
  });

  it("收件箱不存在（null）时只显示普通项目，且不显示生成空间标识", async () => {
    mockedGetInbox.mockResolvedValue(null);
    render(<ProjectsPage />);

    await screen.findByText("海报项目");
    expect(screen.queryByText("生成空间")).not.toBeInTheDocument();
  });

  it("空列表显示空态文案与新建提示", async () => {
    mockedListProjects.mockResolvedValue([]);
    mockedGetInbox.mockResolvedValue(null);
    render(<ProjectsPage />);

    await screen.findByText(/还没有项目/);
    expect(screen.getByLabelText("新项目名称")).toBeInTheDocument();
  });

  it("列表加载失败显示错误与重试，不渲染任何项目行", async () => {
    mockedListProjects.mockRejectedValue(new Error("网络异常"));
    render(<ProjectsPage />);

    await screen.findByText("网络异常");
    expect(screen.queryByText("海报项目")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("普通项目链接进入对应 Canvas（稳定身份），收件箱链接进入生成页", async () => {
    render(<ProjectsPage />);

    await screen.findByText("海报项目");
    expect(screen.getByRole("link", { name: "海报项目" })).toHaveAttribute(
      "href",
      "/canvas?project=1",
    );
    expect(screen.getByRole("link", { name: "Logo 设计" })).toHaveAttribute(
      "href",
      "/canvas?project=2",
    );
    expect(screen.getByRole("link", { name: "生成收件箱" })).toHaveAttribute(
      "href",
      "/generate",
    );
  });
});

describe("ProjectsPage 新建", () => {
  it("新建只创建普通项目，成功后进入其空白 Canvas", async () => {
    mockedCreateProject.mockResolvedValue({
      id: 99,
      name: "新项目",
      thumb: null,
      created_at: "2026-07-20T01:00:00Z",
    });
    render(<ProjectsPage />);
    await screen.findByText("海报项目");

    fireEvent.change(screen.getByLabelText("新项目名称"), {
      target: { value: "新项目" },
    });
    fireEvent.click(screen.getByRole("button", { name: /新建项目/ }));

    await waitFor(() =>
      expect(mockedCreateProject).toHaveBeenCalledWith("新项目"),
    );
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/canvas?project=99"),
    );
  });

  it("新建失败显示错误且不跳转", async () => {
    mockedCreateProject.mockRejectedValue(new Error("创建失败"));
    render(<ProjectsPage />);
    await screen.findByText("海报项目");

    fireEvent.change(screen.getByLabelText("新项目名称"), {
      target: { value: "新项目" },
    });
    fireEvent.click(screen.getByRole("button", { name: /新建项目/ }));

    await screen.findByText("创建失败");
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("ProjectsPage 改名", () => {
  it("改名成功后列表显示新名称", async () => {
    mockedRenameProject.mockResolvedValue({
      id: 1,
      name: "海报项目 v2",
      thumb: null,
      created_at: "2026-07-18T08:00:00Z",
    });
    render(<ProjectsPage />);
    await screen.findByText("海报项目");

    fireEvent.click(screen.getByRole("button", { name: "重命名 海报项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), {
      target: { value: "海报项目 v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("海报项目 v2");
    expect(mockedRenameProject).toHaveBeenCalledWith(1, "海报项目 v2");
    expect(screen.queryByText("海报项目")).not.toBeInTheDocument();
  });

  it("改名失败显示错误且保留原名", async () => {
    mockedRenameProject.mockRejectedValue(new Error("重命名失败"));
    render(<ProjectsPage />);
    await screen.findByText("海报项目");

    fireEvent.click(screen.getByRole("button", { name: "重命名 海报项目" }));
    fireEvent.change(screen.getByLabelText("项目名称"), {
      target: { value: "海报项目 v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("重命名失败");
    // 失败不更新为成功状态：错误呈现且未提交；退出编辑后原名仍在列表
    expect(mockedRenameProject).toHaveBeenCalledWith(1, "海报项目 v2");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText("海报项目")).toBeInTheDocument();
  });

  it("生成收件箱同样可在管理页改名，走通用项目改名接口", async () => {
    mockedRenameProject.mockResolvedValue({
      id: 42,
      name: "我的生成空间",
      thumb: null,
      created_at: "2026-07-19T10:00:00Z",
    });
    render(<ProjectsPage />);
    await screen.findByText("生成收件箱");

    fireEvent.click(screen.getByRole("button", { name: "重命名 生成收件箱" }));
    fireEvent.change(screen.getByLabelText("项目名称"), {
      target: { value: "我的生成空间" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await screen.findByText("我的生成空间");
    expect(mockedRenameProject).toHaveBeenCalledWith(42, "我的生成空间");
    // 改名不改变用途标识与打开目标
    expect(screen.getByText("生成空间")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "我的生成空间" })).toHaveAttribute(
      "href",
      "/generate",
    );
  });
});

describe("ProjectsPage 删除", () => {
  it("删除普通项目前明确列出影响并二次确认，确认后从列表移除", async () => {
    mockedDeleteProject.mockResolvedValue(undefined);
    render(<ProjectsPage />);
    await screen.findByText("海报项目");

    fireEvent.click(screen.getByRole("button", { name: "删除 海报项目" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("永久删除「海报项目」？");
    expect(dialog).toHaveTextContent("画布、对话、生成记录和作品");
    expect(dialog).toHaveTextContent("不可恢复");

    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() =>
      expect(screen.queryByText("海报项目")).not.toBeInTheDocument(),
    );
    expect(mockedDeleteProject).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("删除生成收件箱走收件箱删除入口，不走通用项目删除", async () => {
    mockedDeleteInbox.mockResolvedValue(undefined);
    render(<ProjectsPage />);
    await screen.findByText("生成收件箱");

    fireEvent.click(screen.getByRole("button", { name: "删除 生成收件箱" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() =>
      expect(screen.queryByText("生成收件箱")).not.toBeInTheDocument(),
    );
    expect(mockedDeleteInbox).toHaveBeenCalledTimes(1);
    expect(mockedDeleteProject).not.toHaveBeenCalled();
  });

  it("删除失败显示错误且不移除列表项", async () => {
    mockedDeleteProject.mockRejectedValue(new Error("删除失败"));
    render(<ProjectsPage />);
    await screen.findByText("海报项目");

    fireEvent.click(screen.getByRole("button", { name: "删除 海报项目" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await screen.findByText("删除失败");
    expect(screen.getByText("海报项目")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("取消删除不调用删除接口", async () => {
    render(<ProjectsPage />);
    await screen.findByText("海报项目");

    fireEvent.click(screen.getByRole("button", { name: "删除 海报项目" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedDeleteProject).not.toHaveBeenCalled();
    expect(screen.getByText("海报项目")).toBeInTheDocument();
  });
});
