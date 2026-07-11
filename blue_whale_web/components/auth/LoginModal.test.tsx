// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
    expect(screen.getByRole("button", { name: "获取验证码" })).toBeDisabled();
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

// 倒计时回归网（IJZLE5）：PR#31 把 setInterval 改 setTimeout 递归，
// 此处钉住行为——发码 60→0 递减、归零后可重发且重启、倒计时期间 sendDisabled。
// 若有人退回 setInterval 或去掉递减，以下 case 应红。
describe("LoginModal / 倒计时", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // 发码后按钮文案变「{n}s 后重发」，name 正则同时覆盖发码前后两种文案。
  const sendBtn = () =>
    screen.getByRole("button", { name: /获取验证码|后重发/ });

  // 合法手机号 + 点发码 → countdown 置 60
  const sendCode = () => {
    fireEvent.change(screen.getByPlaceholderText("请输入手机号"), {
      target: { value: "13800001234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
  };

  // 递归 setTimeout：每秒一只 timer，callback 的 setCountdown 触发 re-render + effect
  // 重跑调度下一只。一次性 advanceTimersByTime 不会在推进间 flush React，递归链断在
  // 第一次。按秒循环 + 每次 act flush，让 effect 真正重跑调度下一只 timer。
  const drainCountdown = () => {
    for (let i = 0; i < 60; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
  };

  it("发码后 countdown=60：文案「60s 后重发」+ 按钮禁用（sendDisabled）", () => {
    render(<LoginModal onClose={vi.fn()} onSuccess={vi.fn()} />);
    sendCode();

    expect(screen.getByText("60s 后重发")).toBeInTheDocument();
    expect(sendBtn()).toBeDisabled();
  });

  it("倒计时 60s 归零：按钮 enabled、文案回「获取验证码」", () => {
    render(<LoginModal onClose={vi.fn()} onSuccess={vi.fn()} />);
    sendCode();
    drainCountdown();

    expect(screen.getByRole("button", { name: "获取验证码" })).toBeEnabled();
  });

  it("归零后重发：countdown 从 60 重启", () => {
    render(<LoginModal onClose={vi.fn()} onSuccess={vi.fn()} />);
    sendCode();
    drainCountdown();

    // 归零后按钮回 enabled，再次发码应重新置 60
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));

    expect(screen.getByText("60s 后重发")).toBeInTheDocument();
    expect(sendBtn()).toBeDisabled();
  });
});
