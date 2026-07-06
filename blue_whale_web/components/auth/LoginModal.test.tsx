// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LoginModal } from "./LoginModal";

expect.extend(jestDomMatchers);

// 登录按钮无 aria-label、文本「登录」；X 按钮 aria-label「关闭登录」含「登录」。
// 用正则精确匹配登录按钮，避免误中 X。
const loginBtn = () => screen.getByRole("button", { name: /^登录$/ });

afterEach(cleanup);

describe("LoginModal", () => {
  it("初始：协议未勾 + 无验证码 → 登录按钮禁用", () => {
    render(<LoginModal onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(loginBtn()).toBeDisabled();
  });

  it("合法输入（手机号 + 1234 + 勾协议）→ 登录启用 → 点击触发 onSuccess(phone)", () => {
    const onSuccess = vi.fn();
    render(<LoginModal onClose={vi.fn()} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByPlaceholderText("请输入手机号"), {
      target: { value: "13800001234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    fireEvent.change(screen.getByPlaceholderText("验证码"), {
      target: { value: "1234" },
    });
    fireEvent.click(screen.getByRole("checkbox"));

    expect(loginBtn()).toBeEnabled();
    fireEvent.click(loginBtn());
    expect(onSuccess).toHaveBeenCalledWith("13800001234");
  });

  it("验证码错误 → 红字提示", () => {
    render(<LoginModal onClose={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("请输入手机号"), {
      target: { value: "13800001234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    fireEvent.change(screen.getByPlaceholderText("验证码"), {
      target: { value: "0000" },
    });
    expect(screen.getByText("验证码错误")).toBeInTheDocument();
  });

  it("手机号格式错 → 获取验证码按钮禁用", () => {
    render(<LoginModal onClose={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("请输入手机号"), {
      target: { value: "123" },
    });
    expect(
      screen.getByRole("button", { name: "获取验证码" })
    ).toBeDisabled();
  });

  it("协议未勾 → 即使手机号+验证码都对，登录仍禁用", () => {
    render(<LoginModal onClose={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("请输入手机号"), {
      target: { value: "13800001234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    fireEvent.change(screen.getByPlaceholderText("验证码"), {
      target: { value: "1234" },
    });
    // 未勾 checkbox
    expect(loginBtn()).toBeDisabled();
  });
});
