vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: (
    _request: unknown,
    handler: (user: unknown) => Promise<Response> | Response,
  ) => handler({ userId: "9", status: "enabled", isAdmin: true }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAll: vi.fn(),
}));

vi.mock("@/lib/model-capability/deps", () => ({
  createModelCapabilityAdminDeps: () => ({
    db: { listAll: mocks.listAll },
  }),
}));

import { GET } from "./route";

describe("GET /api/admin/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("返回未软删模型列表", async () => {
    mocks.listAll.mockResolvedValue([
      {
        id: "1",
        model_id: "doubao-seedream-4-0-250828",
        capability_type: "image",
        enabled: true,
      },
    ]);
    const res = await GET(new Request("http://localhost/api/admin/models"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: [{ id: "1", model_id: "doubao-seedream-4-0-250828" }],
    });
  });

  it("repo 异常 → 500 且 success=false", async () => {
    mocks.listAll.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request("http://localhost/api/admin/models"));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false });
  });
});
