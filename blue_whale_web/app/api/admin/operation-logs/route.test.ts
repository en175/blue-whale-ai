import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/operation-log/deps", () => ({
  createOperationLogDeps: () => ({
    db: { create: mocks.create, list: mocks.list },
  }),
}));

import { POST } from "./route";

function post(body: unknown) {
  return new Request("http://localhost/api/admin/operation-logs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = {
  category: "tier",
  action: "创建",
  target: "7",
  detail: "新建档位",
  operator: "admin",
};

describe("POST /api/admin/operation-logs 入参校验", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: "1" });
  });

  it("合法入参 → 201 并落库", async () => {
    const res = await POST(post(VALID));
    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ category: "tier", action: "创建" }),
    );
  });

  it("category / action 缺失 → 400", async () => {
    expect((await POST(post({ action: "创建" }))).status).toBe(400);
    expect((await POST(post({ category: "tier" }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("超过列长度（category 32 / target 255）→ 400，不落库", async () => {
    expect(
      (await POST(post({ ...VALID, category: "x".repeat(33) }))).status,
    ).toBe(400);
    expect(
      (await POST(post({ ...VALID, target: "x".repeat(256) }))).status,
    ).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("targetUserId / operatorId 非数字 → 400（防 BigInt() 抛错成 500）", async () => {
    expect((await POST(post({ ...VALID, targetUserId: "abc" }))).status).toBe(
      400,
    );
    expect((await POST(post({ ...VALID, operatorId: 1.5 }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("targetUserId 为 null / 缺省 → 放行", async () => {
    expect((await POST(post({ ...VALID, targetUserId: null }))).status).toBe(
      201,
    );
  });
});
