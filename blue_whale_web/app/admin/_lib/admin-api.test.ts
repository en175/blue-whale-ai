import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiFetch }));

import { adminRequest, verifyAdminAccess } from "./admin-api";

describe("adminRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the authenticated API client", async () => {
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { ok: true } })),
    );

    await expect(adminRequest("/api/admin/test")).resolves.toEqual({
      data: { ok: true },
    });
    expect(apiFetch).toHaveBeenCalledWith("/api/admin/test", undefined);
  });

  it("verifies a freshly issued token before an admin session is saved", async () => {
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { isAdmin: true } })),
    );

    await verifyAdminAccess("sk-real");

    expect(apiFetch).toHaveBeenCalledWith("/api/admin/session", {
      headers: { Authorization: "Bearer sk-real" },
    });
  });
});
