vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: (
    _request: unknown,
    handler: (user: unknown) => Promise<Response> | Response,
  ) => handler({ userId: "9", status: "enabled", isAdmin: true }),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCards: vi.fn(),
  createCard: vi.fn(),
  listTags: vi.fn(),
  logTemplateCreate: vi.fn(),
}));

vi.mock("@/lib/template-admin/deps", () => ({
  createTemplateAdminDeps: () => ({
    admin: { listCards: mocks.listCards, createCard: mocks.createCard },
    templates: { listTags: mocks.listTags },
  }),
}));

vi.mock("@/lib/template-admin/operation-log", () => ({
  logTemplateCreate: mocks.logTemplateCreate,
}));

import { GET, POST } from "./route";

const TAGS = [
  { tag_code: "marketing", label: "营销视频" },
  { tag_code: "image", label: "图片设计" },
];

function post(body: unknown) {
  return new Request("http://localhost/api/admin/templates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCards.mockResolvedValue([{ id: "1", title: "T" }]);
  });

  it("透传 tagCode 过滤", async () => {
    const res = await GET(
      new Request("http://localhost/api/admin/templates?tagCode=image"),
    );
    expect(mocks.listCards).toHaveBeenCalledWith("image");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
  });

  it("无 tagCode → 不过滤", async () => {
    await GET(new Request("http://localhost/api/admin/templates"));
    expect(mocks.listCards).toHaveBeenCalledWith(undefined);
  });
});

describe("POST /api/admin/templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTags.mockResolvedValue(TAGS);
    mocks.createCard.mockResolvedValue("77");
  });

  it("合法入参 → 创建成功并写审计", async () => {
    const res = await POST(
      post({
        title: "新模板",
        tag_code: "marketing",
        layout: "wide",
        sort_order: 5,
        video_url: "",
        content: "提示词",
        images: [{ image_url: "https://x/1.png" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { id: "77" } });
    expect(mocks.createCard).toHaveBeenCalledWith({
      title: "新模板",
      tag_code: "marketing",
      layout: "wide",
      sort_order: 5,
      video_url: null,
      content: "提示词",
      images: [{ image_url: "https://x/1.png" }],
    });
    expect(mocks.logTemplateCreate).toHaveBeenCalledWith("新模板", "marketing");
  });

  it("非法 layout → 400 且不落库", async () => {
    const res = await POST(
      post({
        title: "T",
        tag_code: "marketing",
        layout: "xxx",
        sort_order: 0,
      }),
    );
    expect(res.status).toBe(400);
    expect(mocks.createCard).not.toHaveBeenCalled();
  });

  it("tag 不在 DB 有效集合 → 400", async () => {
    const res = await POST(
      post({ title: "T", tag_code: "ghost", layout: "wide", sort_order: 0 }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("标签无效");
  });

  it("非 JSON 请求体 → 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/admin/templates", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
