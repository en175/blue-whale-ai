vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: (
    _request: unknown,
    handler: (user: unknown) => Promise<Response> | Response,
  ) => handler({ userId: "9", status: "enabled", isAdmin: true }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareUpload: vi.fn(),
  noStorage: false,
}));

vi.mock("@/lib/template-admin/deps", () => ({
  createTemplateUploadDeps: () => ({
    storage: mocks.noStorage ? null : { prepareUpload: mocks.prepareUpload },
  }),
}));

import { POST } from "./route";

const VALID = { type: "image", mime: "image/jpeg", size: 1024 };

function post(body: unknown) {
  return new Request("http://localhost/api/admin/templates/uploads/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/templates/uploads/presign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.noStorage = false;
    mocks.prepareUpload.mockResolvedValue({
      storageKey: "admin/templates/image/abc123.jpg",
      publicUrl: "https://bucket.tos.test/admin/templates/image/abc123.jpg",
      uploadUrl: "https://bucket.tos.test/signed-put",
      headers: { "Content-Type": "image/jpeg" },
      expiresIn: 600,
    });
  });

  it("合法图片 → 200 + PUT 契约，keyPrefix 透传", async () => {
    const res = await POST(post(VALID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.storage_key).toMatch(/^admin\/templates\/image\//);
    expect(mocks.prepareUpload).toHaveBeenCalledWith(
      expect.objectContaining({ keyPrefix: "admin/templates" }),
    );
  });

  it("非法类型 → 400", async () => {
    const res = await POST(
      post({ type: "audio", mime: "audio/mpeg", size: 1024 }),
    );
    expect(res.status).toBe(400);
    expect(mocks.prepareUpload).not.toHaveBeenCalled();
  });

  it("存储未配置 → 503", async () => {
    mocks.noStorage = true;
    const res = await POST(post(VALID));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("对象存储未配置");
  });

  it("存储层异常 → 500 JSON（try/catch 生效，不泄漏 HTML）", async () => {
    mocks.prepareUpload.mockRejectedValue(new Error("tos unreachable"));
    const res = await POST(post(VALID));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: "tos unreachable",
    });
  });

  it("非 JSON 请求体 → 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/templates/uploads/presign", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
