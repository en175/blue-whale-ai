// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AuthProvider } from "./AuthContext";
import { ProfileModal } from "./ProfileModal";
import { saveUser } from "./authStorage";

// mock next/navigation（AuthProvider 用了 useRouter/usePathname）
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

// mock lib/auth 的网络调用（updateUsername + refreshToken 都 mock，避免 AuthProvider mount 时真调）
vi.mock("@/lib/auth", () => ({
  updateUsername: vi.fn(),
  refreshToken: vi.fn().mockResolvedValue(null), // AuthProvider mount 会调，mock 成功
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public code?: number,
    ) {
      super(message);
    }
  },
}));

const { updateUsername } = await import("@/lib/auth");

expect.extend(jestDomMatchers);

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

// 简化：直接预设 localStorage 模拟登录态，AuthProvider mount 会 loadUser 恢复。
// 故意不存 refresh token，让 AuthProvider mount 的 refresh 分支 `if (!u || !rt) return` 跳过，
// 避免触发 refreshToken 网络调用。
function renderWithLogin(user: {
  userId: number;
  username: string;
  phone: string;
}) {
  saveUser(user);
  render(
    <AuthProvider>
      <ProfileModal onClose={vi.fn()} />
    </AuthProvider>,
  );
}

const LOGGED_USER = { userId: 123, username: "用户7281", phone: "13800001234" };

describe("ProfileModal", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("初始：显示头像（昵称首字）+ 当前昵称 + 脱敏手机号", async () => {
    renderWithLogin(LOGGED_USER);
    // 昵称在 input value 里，user 异步恢复后填充
    await waitFor(() => {
      expect(screen.getByPlaceholderText("请输入昵称")).toHaveValue("用户7281");
    });
    expect(screen.getByText("138****1234")).toBeInTheDocument();
    expect(screen.getByText("用")).toBeInTheDocument();
  });

  it("昵称太短（1 位）→ 提示长度错误，保存禁用", async () => {
    renderWithLogin(LOGGED_USER);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("请输入昵称")).toHaveValue("用户7281"),
    );
    fireEvent.change(screen.getByPlaceholderText("请输入昵称"), {
      target: { value: "a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("昵称长度 2-20 位")).toBeInTheDocument();
    expect(updateUsername).not.toHaveBeenCalled();
  });

  it("昵称含特殊字符 → 提示格式错误", async () => {
    renderWithLogin(LOGGED_USER);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("请输入昵称")).toHaveValue("用户7281"),
    );
    fireEvent.change(screen.getByPlaceholderText("请输入昵称"), {
      target: { value: "用户@123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("仅支持中英文和数字")).toBeInTheDocument();
  });

  it("合法昵称 + 保存成功 → 调 updateUsername", async () => {
    vi.mocked(updateUsername).mockResolvedValue(undefined);
    renderWithLogin(LOGGED_USER);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("请输入昵称")).toHaveValue("用户7281"),
    );
    fireEvent.change(screen.getByPlaceholderText("请输入昵称"), {
      target: { value: "新昵称abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(updateUsername).toHaveBeenCalledWith("新昵称abc");
    });
  });

  it("后端报错（如昵称被占用）→ 显示后端错误 message", async () => {
    vi.mocked(updateUsername).mockRejectedValue(
      new (class extends Error {})("昵称已被占用"),
    );
    renderWithLogin(LOGGED_USER);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("请输入昵称")).toHaveValue("用户7281"),
    );
    fireEvent.change(screen.getByPlaceholderText("请输入昵称"), {
      target: { value: "新昵称abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(screen.getByText("昵称已被占用")).toBeInTheDocument();
    });
  });

  it("昵称未改动 → 保存按钮禁用", async () => {
    renderWithLogin(LOGGED_USER);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("请输入昵称")).toHaveValue("用户7281"),
    );
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
