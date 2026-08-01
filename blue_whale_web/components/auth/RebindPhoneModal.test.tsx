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
import { RebindPhoneModal } from "./RebindPhoneModal";
import { saveUser } from "./authStorage";

// mock next/navigation（AuthProvider 用了 useRouter/usePathname）
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

// mock lib/auth：所有网络调用都 mock，changePhone 可控成败（测失败清字段）
vi.mock("@/lib/auth", () => ({
  fetchCaptcha: vi.fn().mockResolvedValue({
    captcha_token: "tok-1",
    captcha_image: "data:image/png;base64,xxx",
  }),
  sendChangePhoneCode: vi
    .fn()
    .mockResolvedValue({ success: true, expires_in: 300 }),
  changePhone: vi.fn(),
  fetchMe: vi.fn().mockResolvedValue({
    user_id: 123,
    username: "用户7281",
    phone: "13800001234",
  }),
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public code?: number,
    ) {
      super(message);
    }
  },
}));

const { changePhone } = await import("@/lib/auth");

expect.extend(jestDomMatchers);

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

const LOGGED_USER = { userId: 123, username: "用户7281", phone: "13800001234" };

function renderWithLogin() {
  // 只存 user 不存 token，跳过 AuthProvider mount 的 refresh 分支
  saveUser(LOGGED_USER);
  render(
    <AuthProvider>
      <RebindPhoneModal onClose={vi.fn()} />
    </AuthProvider>,
  );
}

// 从 step1 走到 step3 确认页（填新号 + 验证码）
async function proceedToConfirm() {
  // step1：点下一步
  await waitFor(() => screen.getByText("138****1234"));
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));

  // step2：填新号 + 获取验证码 + 填短信码 + 下一步
  fireEvent.change(screen.getByPlaceholderText("请输入新手机号"), {
    target: { value: "13900005678" },
  });
  fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
  // 图形验证码叠加层：填图形码 + 发送短信
  await waitFor(() => screen.getByPlaceholderText("验证码"));
  fireEvent.change(screen.getByPlaceholderText("验证码"), {
    target: { value: "ab12" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送短信" }));
  // 短信码倒计时开始后填短信码
  await waitFor(() => screen.getByPlaceholderText("6 位验证码"));
  fireEvent.change(screen.getByPlaceholderText("6 位验证码"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));

  // 应进入 confirm 步
  await waitFor(() => screen.getByRole("button", { name: "确认换绑" }));
}

describe("RebindPhoneModal", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("step1 初始：显示当前手机号（脱敏）", async () => {
    renderWithLogin();
    await waitFor(() => {
      expect(screen.getByText("138****1234")).toBeInTheDocument();
    });
  });

  it("S1: 换绑失败 → 清空短信码，回退 step2（不留旧码残留）", async () => {
    // changePhone 失败（如占用）
    vi.mocked(changePhone).mockRejectedValueOnce(
      new Error("该手机号已被其他账号绑定"),
    );
    renderWithLogin();
    await proceedToConfirm();

    // 点确认换绑 → 失败
    fireEvent.click(screen.getByRole("button", { name: "确认换绑" }));

    // 应回退 step2，且短信码清空
    await waitFor(() => {
      expect(screen.getByPlaceholderText("6 位验证码")).toHaveValue("");
    });
    expect(screen.getByText("该手机号已被其他账号绑定")).toBeInTheDocument();
    // 回到 step2（有新手机号输入框）
    expect(screen.getByPlaceholderText("请输入新手机号")).toBeInTheDocument();
  });

  it("换绑成功 → 显示成功态", async () => {
    vi.mocked(changePhone).mockResolvedValueOnce(undefined);
    renderWithLogin();
    await proceedToConfirm();
    fireEvent.click(screen.getByRole("button", { name: "确认换绑" }));
    await waitFor(() => {
      expect(screen.getByText("手机号换绑成功")).toBeInTheDocument();
    });
  });
});
