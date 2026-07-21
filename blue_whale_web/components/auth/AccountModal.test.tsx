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
import { AccountModal } from "./AccountModal";
import { saveUser } from "./authStorage";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@/lib/auth", () => ({
  fetchMe: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public code?: number,
    ) {
      super(message);
    }
  },
}));

// mock 子 modal，避免渲染复杂度，聚焦密码 Row 行为
vi.mock("./RebindPhoneModal", () => ({
  RebindPhoneModal: () => <div data-testid="rebind-mock" />,
}));
vi.mock("./ChangePasswordModal", () => ({
  ChangePasswordModal: () => <div data-testid="change-pwd-mock" />,
}));

expect.extend(jestDomMatchers);

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

const BASE_USER = { userId: 123, username: "用户7281", phone: "13800001234" };

describe("AccountModal 密码 Row", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("hasPassword=false → 密码显示「未设置」，按钮「设置」", async () => {
    saveUser({ ...BASE_USER, hasPassword: false });
    render(
      <AuthProvider>
        <AccountModal onClose={vi.fn()} />
      </AuthProvider>,
    );
    await waitFor(() => screen.getByText("账号信息"));
    expect(screen.getByText("未设置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
  });

  it("hasPassword=true → 密码显示「已设置」，按钮「修改」", async () => {
    saveUser({ ...BASE_USER, hasPassword: true });
    render(
      <AuthProvider>
        <AccountModal onClose={vi.fn()} />
      </AuthProvider>,
    );
    await waitFor(() => screen.getByText("账号信息"));
    expect(screen.getByText("已设置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "修改" })).toBeInTheDocument();
  });

  it("点「设置」→ 挂载 ChangePasswordModal", async () => {
    saveUser({ ...BASE_USER, hasPassword: false });
    render(
      <AuthProvider>
        <AccountModal onClose={vi.fn()} />
      </AuthProvider>,
    );
    await waitFor(() => screen.getByText("账号信息"));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    await waitFor(() => {
      expect(screen.getByTestId("change-pwd-mock")).toBeInTheDocument();
    });
  });
});
