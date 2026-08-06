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
  getById: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  logModelUpdate: vi.fn(),
  logModelDelete: vi.fn(),
}));

vi.mock("@/lib/model-capability/deps", () => ({
  createModelCapabilityAdminDeps: () => ({
    db: {
      getById: mocks.getById,
      update: mocks.update,
      remove: mocks.remove,
    },
  }),
}));

vi.mock("@/lib/model-capability/operation-log", () => ({
  logModelUpdate: mocks.logModelUpdate,
  logModelDelete: mocks.logModelDelete,
}));

import { DELETE, PUT } from "./route";

const BEFORE = {
  id: "1",
  provider_id: "volcengine",
  model_id: "doubao-seedream-4-0-250828",
  capability_type: "image",
  model_label: "豆包 Seedream 4.0",
  enabled: true,
  sort_order: 1,
};

const AFTER = { ...BEFORE, model_label: "豆包 Seedream 4.1" };

function put(body: unknown) {
  return new Request("http://localhost/api/admin/models/1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/admin/models/:id 更新", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getById.mockResolvedValue(BEFORE);
    mocks.update.mockResolvedValue(AFTER);
    mocks.logModelUpdate.mockResolvedValue(undefined);
  });

  it("部分更新成功 → 200，审计带 before/after/操作人", async () => {
    const res = await PUT(put({ model_label: "豆包 Seedream 4.1" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { model_label: "豆包 Seedream 4.1" },
    });
    expect(mocks.update).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ model_label: "豆包 Seedream 4.1" }),
    );
    expect(mocks.logModelUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1" }),
      expect.objectContaining({ id: "1" }),
      "admin-test",
    );
  });

  it("模型不存在 → 404，不更新不审计", async () => {
    mocks.getById.mockResolvedValue(null);
    const res = await PUT(put({ model_label: "x" }), {
      params: Promise.resolve({ id: "999" }),
    });
    expect(res.status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.logModelUpdate).not.toHaveBeenCalled();
  });

  it("update 期间被软删 → 404（竞态兜底）", async () => {
    mocks.update.mockResolvedValue(null);
    const res = await PUT(put({ model_label: "x" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(404);
    expect(mocks.logModelUpdate).not.toHaveBeenCalled();
  });

  it("身份字段入参被忽略（payload 不含 provider_id 时仍可更新）", async () => {
    const res = await PUT(put({ model_label: "新名" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      "1",
      expect.not.objectContaining({ provider_id: expect.anything() }),
    );
  });

  it("payload 形状非法 → 400，不更新", async () => {
    const res = await PUT(put({ sort_order: -1 }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("审计失败不阻断更新（仍 200）", async () => {
    mocks.logModelUpdate.mockRejectedValue(new Error("db down"));
    const res = await PUT(put({ model_label: "x" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/admin/models/:id 软删除", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getById.mockResolvedValue(BEFORE);
    mocks.remove.mockResolvedValue(true);
    mocks.logModelDelete.mockResolvedValue(undefined);
  });

  it("软删成功 → 200，审计带删除前快照与操作人", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/admin/models/1"),
      {
        params: Promise.resolve({ id: "1" }),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
    expect(mocks.remove).toHaveBeenCalledWith("1");
    expect(mocks.logModelDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1" }),
      "admin-test",
    );
  });

  it("不存在 / 已软删 → 404，不审计", async () => {
    mocks.remove.mockResolvedValue(false);
    const res = await DELETE(
      new Request("http://localhost/api/admin/models/9"),
      {
        params: Promise.resolve({ id: "9" }),
      },
    );
    expect(res.status).toBe(404);
    expect(mocks.logModelDelete).not.toHaveBeenCalled();
  });

  it("审计失败不阻断删除（仍 200）", async () => {
    mocks.logModelDelete.mockRejectedValue(new Error("db down"));
    const res = await DELETE(
      new Request("http://localhost/api/admin/models/1"),
      {
        params: Promise.resolve({ id: "1" }),
      },
    );
    expect(res.status).toBe(200);
  });
});
