import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const templatesDeps = { templates: {} };

  return {
    templatesDeps,
    withOptionalUser: vi.fn(
      async (
        _request: Request,
        handler: (user: { userId: string } | null) => Promise<Response> | Response,
      ) => handler(null),
    ),
    createTemplatesDeps: vi.fn(() => templatesDeps),
    handlePageTemplates: vi.fn(),
  };
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withOptionalUser: mocks.withOptionalUser,
}));
vi.mock("@/lib/templates/deps", () => ({
  createTemplatesDeps: mocks.createTemplatesDeps,
}));
vi.mock("@/lib/templates/handle-templates", () => ({
  handlePageTemplates: mocks.handlePageTemplates,
}));

import { GET } from "./route";

describe("GET /api/agent/templates/page（公开接口，IK6GM6/IK6GTT）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlePageTemplates.mockResolvedValue({
      code: 200,
      msg: "success",
      data: { items: [], page: 2, size: 5, total: 0 },
    });
  });

  it("匿名请求（无鉴权头）直接返回模板卡片", async () => {
    const request = new Request(
      "http://localhost/api/agent/templates/page?tagCode=marketing&page=2&size=5",
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.withOptionalUser).toHaveBeenCalledWith(
      request,
      expect.any(Function),
    );
    expect(mocks.handlePageTemplates).toHaveBeenCalledWith(
      "marketing",
      2,
      5,
      mocks.templatesDeps,
    );
  });

  it("携带有效 token 时同样返回模板卡片（身份可选）", async () => {
    mocks.withOptionalUser.mockImplementationOnce(
      async (
        _request: Request,
        handler: (user: { userId: string } | null) => Promise<Response> | Response,
      ) => handler({ userId: "9" }),
    );
    const request = new Request(
      "http://localhost/api/agent/templates/page?tagCode=short&page=1&size=5",
      { headers: { Authorization: "Bearer sk-test" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.handlePageTemplates).toHaveBeenCalledWith(
      "short",
      1,
      5,
      mocks.templatesDeps,
    );
  });
});
