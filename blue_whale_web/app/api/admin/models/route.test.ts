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
  create: vi.fn(),
  logModelCreate: vi.fn(),
}));

vi.mock("@/lib/model-capability/deps", () => ({
  createModelCapabilityAdminDeps: () => ({
    db: { listAll: mocks.listAll, create: mocks.create },
  }),
}));

vi.mock("@/lib/model-capability/operation-log", () => ({
  logModelCreate: mocks.logModelCreate,
}));

import { GET, POST } from "./route";

const VALID_CREATE_BODY = {
  provider_id: "volcengine",
  model_id: "doubao-seedream-4-0-250828",
  capability_type: "image",
  model_label: "豆包 Seedream 4.0",
  supported_sizes: [{ id: "1k", label: "1K" }],
  supported_aspect_ratios: ["1:1", "16:9"],
  supported_formats: ["png", "jpeg"],
  default_size: "1K",
  default_aspect_ratio: "1:1",
  features: { stream: true },
  enabled: true,
};

function post(body: unknown) {
  return new Request("http://localhost/api/admin/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

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

describe("POST /api/admin/models 新建", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logModelCreate.mockResolvedValue(undefined);
  });

  it("合法 payload → 201，审计带操作人 username", async () => {
    mocks.create.mockResolvedValue({
      ok: true,
      row: {
        id: "3",
        model_id: "doubao-seedream-4-0-250828",
        model_label: "豆包 Seedream 4.0",
      },
    });
    const res = await POST(post(VALID_CREATE_BODY));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { id: "3", model_id: "doubao-seedream-4-0-250828" },
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_id: "volcengine",
        model_id: "doubao-seedream-4-0-250828",
        capability_type: "image",
        model_label: "豆包 Seedream 4.0",
      }),
    );
    expect(mocks.logModelCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "3" }),
      "admin-test",
    );
  });

  it("同 (provider_id, model_id) 已存在 → 409，不落审计", async () => {
    mocks.create.mockResolvedValue({ ok: false, error: "conflict" });
    const res = await POST(post(VALID_CREATE_BODY));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      success: false,
      error: expect.stringContaining("已存在"),
    });
    expect(mocks.logModelCreate).not.toHaveBeenCalled();
  });

  it("审计失败不阻断新建（仍 201）", async () => {
    mocks.create.mockResolvedValue({ ok: true, row: { id: "3" } });
    mocks.logModelCreate.mockRejectedValue(new Error("db down"));
    const res = await POST(post(VALID_CREATE_BODY));
    expect(res.status).toBe(201);
  });

  it("能力 JSON 列形状非法 → 400，不落库", async () => {
    mocks.create.mockResolvedValue({ ok: true, row: { id: "3" } });
    const res = await POST(
      post({ ...VALID_CREATE_BODY, supported_sizes: [1, 2] }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("supported_sizes"),
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/models 入参校验", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("capability_type 非 image/video/text → 400", async () => {
    const res = await POST(
      post({ ...VALID_CREATE_BODY, capability_type: "audio" }),
    );
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("身份字段缺失 → 400", async () => {
    const res = await POST(post({ ...VALID_CREATE_BODY, model_id: "" }));
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("字段超长 → 400（防 VarChar 落库截断）", async () => {
    const res = await POST(
      post({ ...VALID_CREATE_BODY, model_label: "长".repeat(65) }),
    );
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("请求体非 JSON 对象 → 400", async () => {
    const res = await POST(post([1, 2, 3]));
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("repo 抛异常 → 500 且 success=false", async () => {
    mocks.create.mockRejectedValue(new Error("db down"));
    const res = await POST(post(VALID_CREATE_BODY));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false });
  });
});
