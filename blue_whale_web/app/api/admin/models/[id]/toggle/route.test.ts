vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: (
    _request: unknown,
    handler: (user: unknown) => Promise<Response> | Response,
  ) =>
    handler({
      userId: "9",
      status: "enabled",
      isAdmin: true,
      username: "admin-test",
    }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toggleEnabled: vi.fn(),
  logModelToggle: vi.fn(),
}));

vi.mock("@/lib/model-capability/deps", () => ({
  createModelCapabilityAdminDeps: () => ({
    db: { toggleEnabled: mocks.toggleEnabled },
  }),
}));

vi.mock("@/lib/model-capability/operation-log", () => ({
  logModelToggle: mocks.logModelToggle,
}));

import { PATCH } from "./route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/admin/models/:id/toggle 启停切换", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logModelToggle.mockResolvedValue(undefined);
  });

  it("翻转成功 → 200，审计带操作人", async () => {
    mocks.toggleEnabled.mockResolvedValue({
      id: "1",
      model_id: "doubao-seedream-4-0-250828",
      enabled: false,
    });
    const res = await PATCH(
      new Request("http://localhost/api/admin/models/1/toggle"),
      params("1"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { enabled: false },
    });
    expect(mocks.toggleEnabled).toHaveBeenCalledWith("1");
    expect(mocks.logModelToggle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1", enabled: false }),
      "admin-test",
    );
  });

  it("不存在 / 已软删 → 404，不审计", async () => {
    mocks.toggleEnabled.mockResolvedValue(null);
    const res = await PATCH(
      new Request("http://localhost/api/admin/models/9/toggle"),
      params("9"),
    );
    expect(res.status).toBe(404);
    expect(mocks.logModelToggle).not.toHaveBeenCalled();
  });

  it("审计失败不阻断切换（仍 200）", async () => {
    mocks.toggleEnabled.mockResolvedValue({ id: "1", enabled: true });
    mocks.logModelToggle.mockRejectedValue(new Error("db down"));
    const res = await PATCH(
      new Request("http://localhost/api/admin/models/1/toggle"),
      params("1"),
    );
    expect(res.status).toBe(200);
  });
});
