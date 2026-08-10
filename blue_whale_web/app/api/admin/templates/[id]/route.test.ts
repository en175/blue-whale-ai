vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: (
    _request: unknown,
    handler: (user: unknown) => Promise<Response> | Response,
  ) => handler({ userId: "9", status: "enabled", isAdmin: true }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCard: vi.fn(),
  updateCard: vi.fn(),
  softDeleteCard: vi.fn(),
  listTags: vi.fn(),
  logTemplateUpdate: vi.fn(),
  logTemplateDelete: vi.fn(),
}));

vi.mock("@/lib/template-admin/deps", () => ({
  createTemplateAdminDeps: () => ({
    admin: {
      getCard: mocks.getCard,
      updateCard: mocks.updateCard,
      softDeleteCard: mocks.softDeleteCard,
    },
    templates: { listTags: mocks.listTags },
  }),
}));

vi.mock("@/lib/template-admin/operation-log", () => ({
  logTemplateUpdate: mocks.logTemplateUpdate,
  logTemplateDelete: mocks.logTemplateDelete,
}));

import { DELETE, PUT } from "./route";

const TAGS = [{ tag_code: "marketing", label: "营销视频" }];

const BEFORE = {
  id: "5",
  tag_code: "marketing",
  title: "旧标题",
  content: null,
  video_url: null,
  layout: "wide",
  sort_order: 0,
  images: [{ id: "1", image_url: "https://x/1.png", sort_order: 0 }],
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function put(id: string, body: unknown) {
  return new Request(`http://localhost/api/admin/templates/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/admin/templates/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTags.mockResolvedValue(TAGS);
    mocks.getCard.mockResolvedValue(BEFORE);
    mocks.updateCard.mockResolvedValue(true);
  });

  it("更新成功 → 审计列出变更字段", async () => {
    const res = await PUT(
      put("5", {
        title: "新标题",
        tag_code: "marketing",
        layout: "social",
        sort_order: 2,
        content: "新提示词",
        images: [{ id: "1", image_url: "https://x/1.png" }],
      }),
      params("5"),
    );
    expect(res.status).toBe(200);
    expect(mocks.updateCard).toHaveBeenCalledWith(
      BigInt(5),
      expect.objectContaining({ title: "新标题" }),
    );
    expect(mocks.logTemplateUpdate).toHaveBeenCalledWith(
      "新标题",
      expect.arrayContaining(["标题", "layout", "排序", "提示词"]),
    );
  });

  it("卡片不存在 → 404", async () => {
    mocks.getCard.mockResolvedValue(null);
    const res = await PUT(
      put("99", {
        title: "T",
        tag_code: "marketing",
        layout: "wide",
        sort_order: 0,
      }),
      params("99"),
    );
    expect(res.status).toBe(404);
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });

  it("id 非法 → 400", async () => {
    const res = await PUT(
      put("abc", {
        title: "T",
        tag_code: "marketing",
        layout: "wide",
        sort_order: 0,
      }),
      params("abc"),
    );
    expect(res.status).toBe(400);
  });

  it("校验失败 → 400 且不落库", async () => {
    const res = await PUT(
      put("5", {
        title: "",
        tag_code: "marketing",
        layout: "wide",
        sort_order: 0,
      }),
      params("5"),
    );
    expect(res.status).toBe(400);
    expect(mocks.updateCard).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/templates/:id（软删除）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCard.mockResolvedValue(BEFORE);
    mocks.softDeleteCard.mockResolvedValue(true);
  });

  it("软删成功 → 审计记录标题", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/admin/templates/5", {
        method: "DELETE",
      }),
      params("5"),
    );
    expect(res.status).toBe(200);
    expect(mocks.softDeleteCard).toHaveBeenCalledWith(BigInt(5));
    expect(mocks.logTemplateDelete).toHaveBeenCalledWith("旧标题");
  });

  it("不存在 → 404 且不写审计", async () => {
    mocks.getCard.mockResolvedValue(null);
    const res = await DELETE(
      new Request("http://localhost/api/admin/templates/99", {
        method: "DELETE",
      }),
      params("99"),
    );
    expect(res.status).toBe(404);
    expect(mocks.logTemplateDelete).not.toHaveBeenCalled();
  });
});
