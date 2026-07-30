import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const templatesDeps = { templates: {} };

  return {
    templatesDeps,
    withAuthenticatedUser: vi.fn(
      async (
        _request: Request,
        handler: (user: {
          userId: string;
          status: "enabled";
        }) => Promise<Response> | Response,
      ) => handler({ userId: "9", status: "enabled" }),
    ),
    createTemplatesDeps: vi.fn(() => templatesDeps),
    handlePageTemplates: vi.fn(),
  };
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: mocks.withAuthenticatedUser,
}));
vi.mock("@/lib/templates/deps", () => ({
  createTemplatesDeps: mocks.createTemplatesDeps,
}));
vi.mock("@/lib/templates/handle-templates", () => ({
  handlePageTemplates: mocks.handlePageTemplates,
}));

import { GET } from "./route";

describe("GET /api/agent/templates/page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlePageTemplates.mockResolvedValue({
      code: 200,
      msg: "success",
      data: { items: [], page: 2, size: 5, total: 0 },
    });
  });

  it("lists templates only after receiving the authenticated user", async () => {
    const request = new Request(
      "http://localhost/api/agent/templates/page?tagCode=marketing&page=2&size=5",
      { headers: { "X-User-Id": "999" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.withAuthenticatedUser).toHaveBeenCalledWith(
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
});
