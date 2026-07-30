// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LoginModal } from "./LoginModal";

const { signUp } = vi.hoisted(() => ({
  signUp: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./AuthContext", () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    signUp,
  }),
}));

vi.mock("./accountCapabilities", () => ({
  fetchAccountCapabilities: vi.fn().mockResolvedValue({
    password_login: true,
    password_register: true,
    email_verification: false,
  }),
}));

describe("LoginModal account registration", () => {
  it("switches to registration and establishes login through signUp", async () => {
    render(<LoginModal onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "创建账号" }));
    fireEvent.change(screen.getByPlaceholderText("用户名"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByPlaceholderText("密码"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "注册并登录" }));

    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith({
        username: "alice",
        password: "secret",
      }),
    );
  });
});
