import { describe, expect, it, vi } from "vitest";

import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  it("does not revoke or forward the default API key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 200, msg: null, data: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
