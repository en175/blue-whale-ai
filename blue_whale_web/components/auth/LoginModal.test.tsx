// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LoginModal } from "./LoginModal";

// Mock AuthContext
const mockSignIn = vi.fn();
vi.mock("./AuthContext", () => ({
  useAuth: () => ({
    signIn: mockSignIn,
    user: null,
    isLoginOpen: false,
    pendingAction: null,
    requireAuth: vi.fn(),
    signOut: vi.fn(),
    openLogin: vi.fn(),
    closeLogin: vi.fn(),
  }),
}));

expect.extend(jestDomMatchers);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("LoginModal", () => {
  it("初始：协议未勾 → 登录按钮禁用", () => {
    render(<LoginModal onClose={vi.fn()} />);
    const login = screen.getByRole("button", { name: /^登录$/ });
    expect(login).toBeDisabled();
  });

  it("手机号格式错 → 获取验证码按钮禁用", () => {
    render(<LoginModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("请输入手机号"), {
      target: { value: "123" },
    });
    expect(screen.getByRole("button", { name: "获取验证码" })).toBeDisabled();
  });

  it("合法手机号 → 获取验证码按钮启用", () => {
    render(<LoginModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("请输入手机号"), {
      target: { value: "13800001234" },
    });
    expect(screen.getByRole("button", { name: "获取验证码" })).toBeEnabled();
  });

  it("协议未勾 → 登录按钮禁用", () => {
    render(<LoginModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("请输入手机号"), {
      target: { value: "13800001234" },
    });
    expect(screen.getByRole("button", { name: /^登录$/ })).toBeDisabled();
  });
});
