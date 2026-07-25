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
import { ChangePasswordModal } from "./ChangePasswordModal";
import { saveUser } from "./authStorage";

// mock next/navigation（AuthProvider 用了 useRouter/usePathname）
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

// mock lib/auth：所有网络调用 mock，setPassword/changePassword 可控成败
vi.mock("@/lib/auth", () => ({
  fetchCaptcha: vi.fn().mockResolvedValue({
    captcha_token: "tok-1",
    captcha_image: "data:image/png;base64,xxx",
  }),
  sendVerificationCode: vi
    .fn()
    .mockResolvedValue({ success: true, expires_in: 300 }),
  setPassword: vi.fn(),
  changePassword: vi.fn(),
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

const { setPassword, changePassword, sendVerificationCode } =
  await import("@/lib/auth");

expect.extend(jestDomMatchers);

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

const BASE_USER = { userId: 123, username: "用户7281", phone: "13800001234" };

function renderWithLogin(hasPassword: boolean) {
  saveUser({ ...BASE_USER, hasPassword });
  render(
    <AuthProvider>
      <ChangePasswordModal onClose={vi.fn()} />
    </AuthProvider>,
  );
}

// 走完发码流程（图形码 → 短信码），并填好 6 位短信码
async function sendCodeAndFill() {
  fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
  await waitFor(() => screen.getByPlaceholderText("验证码"));
  fireEvent.change(screen.getByPlaceholderText("验证码"), {
    target: { value: "ab12" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送短信" }));
  await waitFor(() => screen.getByPlaceholderText("6 位验证码"));
  fireEvent.change(screen.getByPlaceholderText("6 位验证码"), {
    target: { value: "123456" },
  });
}

describe("ChangePasswordModal", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("hasPassword=false：不显示旧密码，按钮为「确认设置」", async () => {
    renderWithLogin(false);
    await waitFor(() => screen.getByText("设置密码"));
    expect(
      screen.queryByPlaceholderText("请输入旧密码"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "确认设置" }),
    ).toBeInTheDocument();
  });

  it("hasPassword=true：显示旧密码，按钮为「确认修改」", async () => {
    renderWithLogin(true);
    await waitFor(() => screen.getByText("修改密码"));
    expect(screen.getByPlaceholderText("请输入旧密码")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "确认修改" }),
    ).toBeInTheDocument();
  });

  it("弱密码 → 提示需含字母和数字", async () => {
    renderWithLogin(false);
    await waitFor(() => screen.getByText("设置密码"));
    fireEvent.change(screen.getByPlaceholderText("8-128 位，含字母和数字"), {
      target: { value: "12345678" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入新密码"), {
      target: { value: "12345678" },
    });
    await sendCodeAndFill();
    fireEvent.click(screen.getByRole("button", { name: "确认设置" }));
    await waitFor(() => {
      expect(
        screen.getByText("密码需 8-128 位，且包含字母和数字"),
      ).toBeInTheDocument();
    });
  });

  it("两次新密码不一致 → 提示", async () => {
    renderWithLogin(false);
    await waitFor(() => screen.getByText("设置密码"));
    fireEvent.change(screen.getByPlaceholderText("8-128 位，含字母和数字"), {
      target: { value: "abcd1234" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入新密码"), {
      target: { value: "abcd5678" },
    });
    await sendCodeAndFill();
    fireEvent.click(screen.getByRole("button", { name: "确认设置" }));
    await waitFor(() => {
      expect(screen.getByText("两次输入的新密码不一致")).toBeInTheDocument();
    });
  });

  it("发码流程：图形码 → 短信码（sendVerificationCode 用当前手机号）", async () => {
    renderWithLogin(false);
    await waitFor(() => screen.getByText("设置密码"));
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    await waitFor(() => screen.getByPlaceholderText("验证码"));
    fireEvent.change(screen.getByPlaceholderText("验证码"), {
      target: { value: "ab12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送短信" }));
    await waitFor(() => {
      expect(sendVerificationCode).toHaveBeenCalledWith(
        "13800001234",
        "tok-1",
        "ab12",
      );
    });
  });

  it("setPassword 成功（首次设置）→ 显示成功态", async () => {
    vi.mocked(setPassword).mockResolvedValueOnce(undefined);
    renderWithLogin(false);
    await waitFor(() => screen.getByText("设置密码"));
    fireEvent.change(screen.getByPlaceholderText("8-128 位，含字母和数字"), {
      target: { value: "abcd1234" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入新密码"), {
      target: { value: "abcd1234" },
    });
    await sendCodeAndFill();
    fireEvent.click(screen.getByRole("button", { name: "确认设置" }));
    await waitFor(() => {
      expect(setPassword).toHaveBeenCalledWith("123456", "abcd1234");
      expect(screen.getByText("密码设置成功")).toBeInTheDocument();
    });
  });

  it("changePassword 成功（修改）→ signOut 触发，弹窗内容消失（强制重登）", async () => {
    vi.mocked(changePassword).mockResolvedValueOnce(undefined);
    renderWithLogin(true);
    await waitFor(() => screen.getByText("修改密码"));
    fireEvent.change(screen.getByPlaceholderText("请输入旧密码"), {
      target: { value: "oldpass1" },
    });
    fireEvent.change(screen.getByPlaceholderText("8-128 位，含字母和数字"), {
      target: { value: "newpass1" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入新密码"), {
      target: { value: "newpass1" },
    });
    await sendCodeAndFill();
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));
    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith(
        "123456",
        "oldpass1",
        "newpass1",
      );
    });
    // signOut 同步清 user → ChangePasswordModal if(!user) return null，标题消失；openLogin 弹登录窗
    await waitFor(() => {
      expect(screen.queryByText("修改密码")).not.toBeInTheDocument();
    });
  });

  it("失败 → 清空短信码 + 显示错误（S1）", async () => {
    vi.mocked(setPassword).mockRejectedValueOnce(new Error("验证码错误"));
    renderWithLogin(false);
    await waitFor(() => screen.getByText("设置密码"));
    fireEvent.change(screen.getByPlaceholderText("8-128 位，含字母和数字"), {
      target: { value: "abcd1234" },
    });
    fireEvent.change(screen.getByPlaceholderText("再次输入新密码"), {
      target: { value: "abcd1234" },
    });
    await sendCodeAndFill();
    fireEvent.click(screen.getByRole("button", { name: "确认设置" }));
    await waitFor(() => {
      expect(screen.getByText("验证码错误")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("6 位验证码")).toHaveValue("");
    });
  });
});
