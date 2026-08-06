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
  listAll: vi.fn(),
  updateSortOrder: vi.fn(),
  logModelReorder: vi.fn(),
}));

vi.mock("@/lib/model-capability/deps", () => ({
  createModelCapabilityAdminDeps: () => ({
    db: { listAll: mocks.listAll, updateSortOrder: mocks.updateSortOrder },
  }),
}));

vi.mock("@/lib/model-capability/operation-log", () => ({
  logModelReorder: mocks.logModelReorder,
}));

import { PUT } from "./route";

function put(body: unknown) {
  return new Request("http://localhost/api/admin/models/reorder", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ROWS = [
  { id: "1", model_id: "doubao-seedream-4-0-250828" },
  { id: "2", model_id: "doubao-seedance-2-0-260128" },
];

describe("PUT /api/admin/models/reorder 批量排序", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAll.mockResolvedValue(ROWS);
    mocks.updateSortOrder.mockResolvedValue({ ok: true });
    mocks.logModelReorder.mockResolvedValue(undefined);
  });

  it("排序成功 → 200，审计带 model_id 映射与操作人", async () => {
    const res = await PUT(
      put({
        items: [
          { id: "1", sortOrder: 2 },
          { id: "2", sortOrder: 1 },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
    expect(mocks.updateSortOrder).toHaveBeenCalledWith([
      { id: "1", sortOrder: 2 },
      { id: "2", sortOrder: 1 },
    ]);
    expect(mocks.logModelReorder).toHaveBeenCalledWith(
      [
        { id: "1", model_id: "doubao-seedream-4-0-250828", sortOrder: 2 },
        { id: "2", model_id: "doubao-seedance-2-0-260128", sortOrder: 1 },
      ],
      "admin-test",
    );
  });

  it("缺少 / 形状非法 items → 400，不排序不审计", async () => {
    expect((await PUT(put({ items: [] }))).status).toBe(400);
    expect((await PUT(put({}))).status).toBe(400);
    expect(
      (await PUT(put({ items: [{ id: "abc", sortOrder: 1 }] }))).status,
    ).toBe(400);
    expect(
      (await PUT(put({ items: [{ id: "1", sortOrder: -1 }] }))).status,
    ).toBe(400);
    expect(
      (await PUT(put({ items: [{ id: "1", sortOrder: 2147483648 }] }))).status,
    ).toBe(400);
    expect(mocks.updateSortOrder).not.toHaveBeenCalled();
    expect(mocks.logModelReorder).not.toHaveBeenCalled();
  });

  it("任一 id 不存在/已软删 → 404，不审计", async () => {
    mocks.updateSortOrder.mockResolvedValue({
      ok: false,
      error: "not-found",
      missingId: "9",
    });
    const res = await PUT(put({ items: [{ id: "9", sortOrder: 1 }] }));
    expect(res.status).toBe(404);
    expect(mocks.logModelReorder).not.toHaveBeenCalled();
  });

  it("审计失败不阻断排序（仍 200）", async () => {
    mocks.logModelReorder.mockRejectedValue(new Error("db down"));
    const res = await PUT(put({ items: [{ id: "1", sortOrder: 1 }] }));
    expect(res.status).toBe(200);
  });
});
