vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: (
    _request: unknown,
    handler: (user: unknown) => Promise<Response> | Response,
  ) => handler({ userId: "9", status: "enabled", isAdmin: true }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listTags: vi.fn(),
  renameTag: vi.fn(),
  logTagRename: vi.fn(),
}));

vi.mock("@/lib/template-admin/deps", () => ({
  createTemplateAdminDeps: () => ({
    admin: { renameTag: mocks.renameTag },
    templates: { listTags: mocks.listTags },
  }),
}));

vi.mock("@/lib/template-admin/operation-log", () => ({
  logTagRename: mocks.logTagRename,
}));

import { GET, PUT } from "./route";

function put(body: unknown) {
  return new Request("http://localhost/api/admin/template-tags", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET/PUT /api/admin/template-tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTags.mockResolvedValue([
      { tag_code: "marketing", label: "营销视频" },
      { tag_code: "short", label: "微短片" },
    ]);
    mocks.renameTag.mockResolvedValue(true);
  });

  it("GET 列出标签", async () => {
    const res = await GET(
      new Request("http://localhost/api/admin/template-tags"),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(2);
  });

  it("PUT 改名成功 → 审计记录旧→新", async () => {
    const res = await PUT(put({ tag_code: "marketing", label: "品牌营销" }));
    expect(res.status).toBe(200);
    expect(mocks.renameTag).toHaveBeenCalledWith("marketing", "品牌营销");
    expect(mocks.logTagRename).toHaveBeenCalledWith(
      "marketing",
      "营销视频",
      "品牌营销",
    );
  });

  it("tag 不存在 → 404；空名称 → 400", async () => {
    expect((await PUT(put({ tag_code: "ghost", label: "X" }))).status).toBe(
      404,
    );
    expect((await PUT(put({ tag_code: "marketing", label: " " }))).status).toBe(
      400,
    );
  });
});
