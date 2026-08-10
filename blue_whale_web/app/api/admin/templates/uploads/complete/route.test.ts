vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: (
    _request: unknown,
    handler: (user: unknown) => Promise<Response> | Response,
  ) => handler({ userId: "9", status: "enabled", isAdmin: true }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspectObject: vi.fn(),
  makePublic: vi.fn(),
  logTemplateUpload: vi.fn(),
  noStorage: false,
}));

vi.mock("@/lib/template-admin/deps", () => ({
  createTemplateUploadDeps: () => ({
    storage: mocks.noStorage
      ? null
      : { inspectObject: mocks.inspectObject, makePublic: mocks.makePublic },
  }),
}));

vi.mock("@/lib/template-admin/operation-log", () => ({
  logTemplateUpload: mocks.logTemplateUpload,
}));

import { POST } from "./route";

const VALID = {
  type: "image",
  mime: "image/jpeg",
  size: 1024,
  storage_key: "admin/templates/image/abc123.jpg",
};

function post(body: unknown) {
  return new Request("http://localhost/api/admin/templates/uploads/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/templates/uploads/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.noStorage = false;
    mocks.inspectObject.mockResolvedValue({
      size: 1024,
      mime: "image/jpeg",
      publicUrl: "https://bucket.tos.test/admin/templates/image/abc123.jpg",
    });
    mocks.makePublic.mockResolvedValue(undefined);
  });

  it("成功 → 200 + 公网 URL + 置 public-read + 审计", async () => {
    const res = await POST(post(VALID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      data: {
        url: "https://bucket.tos.test/admin/templates/image/abc123.jpg",
      },
    });
    expect(mocks.makePublic).toHaveBeenCalledWith(
      "admin/templates/image/abc123.jpg",
    );
    expect(mocks.logTemplateUpload).toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: VALID.storage_key }),
    );
  });

  it("storage_key 前缀不匹配 → 400 且不置 public-read", async () => {
    const res = await POST(
      post({ ...VALID, storage_key: "uploads/9/image/abc123.jpg" }),
    );
    expect(res.status).toBe(400);
    expect(mocks.makePublic).not.toHaveBeenCalled();
  });

  it("存储未配置 → 503", async () => {
    mocks.noStorage = true;
    const res = await POST(post(VALID));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("对象存储未配置");
  });

  it("HEAD 异常 → 500 JSON（不泄漏 HTML）", async () => {
    mocks.inspectObject.mockRejectedValue(new Error("tos unreachable"));
    const res = await POST(post(VALID));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: "tos unreachable",
    });
  });

  it("非 JSON 请求体 → 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/templates/uploads/complete", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
