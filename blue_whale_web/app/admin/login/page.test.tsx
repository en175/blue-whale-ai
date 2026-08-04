// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminLoginPage from "./page";

const mocks = vi.hoisted(() => ({
  loginWithPassword: vi.fn(),
  replace: vi.fn(),
  saveAdminSession: vi.fn(),
  verifyAdminAccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/lib/auth", () => ({
  loginWithPassword: mocks.loginWithPassword,
}));
vi.mock("../_lib/auth", () => ({
  saveAdminSession: mocks.saveAdminSession,
}));
vi.mock("../_lib/admin-api", () => ({
  verifyAdminAccess: mocks.verifyAdminAccess,
}));

describe("admin login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAdminAccess.mockResolvedValue(undefined);
  });

  it("uses the real account login result before entering admin", async () => {
    mocks.loginWithPassword.mockResolvedValue({
      access_token: "sk-real",
      user_id: 1,
      username: "root",
    });
    render(<AdminLoginPage />);

    fireEvent.change(screen.getByPlaceholderText("admin"), {
      target: { value: "root" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() =>
      expect(mocks.loginWithPassword).toHaveBeenCalledWith("root", "secret"),
    );
    expect(mocks.verifyAdminAccess).toHaveBeenCalledWith("sk-real");
    expect(mocks.saveAdminSession).toHaveBeenCalledWith("sk-real", {
      adminId: 1,
      username: "root",
      role: 100,
    });
    expect(mocks.replace).toHaveBeenCalledWith("/admin");
  });

  it("does not enter admin when account login fails", async () => {
    mocks.loginWithPassword.mockRejectedValue(new Error("凭据错误"));
    render(<AdminLoginPage />);

    fireEvent.change(screen.getByPlaceholderText("admin"), {
      target: { value: "root" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("凭据错误")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("does not create an admin session for a non-admin account", async () => {
    mocks.loginWithPassword.mockResolvedValue({
      access_token: "sk-user",
      user_id: 2,
      username: "ordinary",
    });
    mocks.verifyAdminAccess.mockRejectedValue(new Error("需要管理员权限"));
    render(<AdminLoginPage />);

    fireEvent.change(screen.getByPlaceholderText("admin"), {
      target: { value: "ordinary" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("需要管理员权限")).toBeInTheDocument();
    expect(mocks.saveAdminSession).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
