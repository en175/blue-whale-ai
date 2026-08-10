vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: (
    _request: unknown,
    handler: (user: unknown) => Promise<Response> | Response,
  ) => handler({ userId: "9", status: "enabled", isAdmin: true }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCard: vi.fn(),
  moveCard: vi.fn(),
  logTemplateMove: vi.fn(),
}));

vi.mock("@/lib/template-admin/deps", () => ({
  createTemplateAdminDeps: () => ({
    admin: { getCard: mocks.getCard, moveCard: mocks.moveCard },
  }),
}));

vi.mock("@/lib/template-admin/operation-log", () => ({
  logTemplateMove: mocks.logTemplateMove,
}));

import { POST } from "./route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function move(id: string, direction: unknown) {
  return new Request(`http://localhost/api/admin/templates/${id}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ direction }),
  });
}

describe("POST /api/admin/templates/:id/move", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCard.mockResolvedValue({ id: "5", title: "T" });
    mocks.moveCard.mockResolvedValue({ ok: true });
  });

  it("上移成功 → 审计", async () => {
    const res = await POST(move("5", "up"), params("5"));
    expect(res.status).toBe(200);
    expect(mocks.moveCard).toHaveBeenCalledWith(BigInt(5), "up");
    expect(mocks.logTemplateMove).toHaveBeenCalledWith("T", "up");
  });

  it("已在边缘 → 409", async () => {
    mocks.moveCard.mockResolvedValue({ ok: false, reason: "boundary" });
    const res = await POST(move("5", "up"), params("5"));
    expect(res.status).toBe(409);
    expect(mocks.logTemplateMove).not.toHaveBeenCalled();
  });

  it("非法方向 → 400；卡片不存在 → 404", async () => {
    expect((await POST(move("5", "left"), params("5"))).status).toBe(400);
    mocks.getCard.mockResolvedValue(null);
    expect((await POST(move("5", "up"), params("5"))).status).toBe(404);
  });
});
