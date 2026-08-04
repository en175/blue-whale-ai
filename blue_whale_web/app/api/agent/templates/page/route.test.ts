import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const templatesDeps = { templates: {} };

  return {
    templatesDeps,
    createTemplatesDeps: vi.fn(() => templatesDeps),
    handlePageTemplates: vi.fn(),
  };
});

vi.mock("@/lib/templates/deps", () => ({
  createTemplatesDeps: mocks.createTemplatesDeps,
}));
vi.mock("@/lib/templates/handle-templates", () => ({
  handlePageTemplates: mocks.handlePageTemplates,
}));

import { GET } from "./route";

describe("GET /api/agent/templates/page（公开接口，IK6GM6）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlePageTemplates.mockResolvedValue({
      code: 200,
      msg: "success",
      data: { items: [], page: 2, size: 5, total: 0 },
    });
  });

  it("匿名请求（无任何鉴权头）直接返回模板卡片", async () => {
    const request = new Request(
      "http://localhost/api/agent/templates/page?tagCode=marketing&page=2&size=5",
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.handlePageTemplates).toHaveBeenCalledWith(
      "marketing",
      2,
      5,
      mocks.templatesDeps,
    );
  });

  it("非法 tagCode 透传 400 业务失败", async () => {
    mocks.handlePageTemplates.mockResolvedValue({
      code: 400,
      msg: "非法标签: unknown",
      data: null,
    });
    const request = new Request(
      "http://localhost/api/agent/templates/page?tagCode=unknown&page=1&size=5",
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.handlePageTemplates).toHaveBeenCalledWith(
      "unknown",
      1,
      5,
      mocks.templatesDeps,
    );
  });
});
