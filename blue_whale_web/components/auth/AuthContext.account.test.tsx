// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "./AuthContext";

const { registerWithPassword, logoutApi, fetchMe } = vi.hoisted(() => ({
  registerWithPassword: vi.fn().mockResolvedValue({
    access_token: "sk-register",
    refresh_token: "",
    expires_in: 0,
    user_id: 8,
    username: "alice",
    phone: "",
    is_new_user: true,
    has_password: true,
  }),
  logoutApi: vi.fn().mockResolvedValue(undefined),
  // IK6JXJ：signUp/signIn 会并行读 /api/me 拿 is_admin，必须返回 Promise。
  fetchMe: vi.fn().mockResolvedValue({
    user_id: 8,
    username: "alice",
    phone: "",
    has_password: true,
    is_admin: false,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("@/lib/auth", () => ({
  loginWithPassword: vi.fn(),
  registerWithPassword,
  logoutApi,
  fetchMe,
}));

function Probe() {
  const { user, signUp, signOut } = useAuth();
  return (
    <>
      <span>{user?.username ?? "anonymous"}</span>
      <button
        onClick={() =>
          void signUp({
            username: "alice",
            password: "secret",
            email: "alice@example.com",
          })
        }
      >
        register
      </button>
      <button onClick={signOut}>logout</button>
    </>
  );
}

describe("AuthProvider new-api account lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("registers into localStorage, restores after remount, and logs out locally", async () => {
    const first = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "register" }));

    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
    expect(localStorage.getItem("bw-access-token")).toBe("sk-register");

    first.unmount();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByText("anonymous")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "logout" }));
    expect(screen.getByText("anonymous")).toBeInTheDocument();
    expect(localStorage.getItem("bw-access-token")).toBeNull();
    expect(logoutApi).not.toHaveBeenCalled();
  });
});
