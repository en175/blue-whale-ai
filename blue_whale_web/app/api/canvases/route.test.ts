import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const canvasDeps = { canvases: {}, projects: {} };

  return {
    canvasDeps,
    withAuthenticatedUser: vi.fn(
      async (
        _request: Request,
        handler: (user: {
          userId: string;
          status: "enabled";
        }) => Promise<Response> | Response,
      ) => handler({ userId: "9", status: "enabled" }),
    ),
    createCanvasDeps: vi.fn(() => canvasDeps),
    handleGetCanvas: vi.fn(),
  };
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: mocks.withAuthenticatedUser,
}));
vi.mock("@/lib/canvas/deps", () => ({
  createCanvasDeps: mocks.createCanvasDeps,
}));
vi.mock("@/lib/canvas/handle-canvas", () => ({
  handleGetCanvas: mocks.handleGetCanvas,
}));

import { GET } from "./route";

describe("GET /api/canvases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleGetCanvas.mockResolvedValue({
      code: 200,
      msg: "success",
      data: { project_id: "55", viewport: {}, nodes: [] },
    });
  });

  it("loads the query project Canvas for the authenticated user", async () => {
    const response = await GET(
      new Request("http://localhost/api/canvases?projectId=55"),
    );

    expect(mocks.handleGetCanvas).toHaveBeenCalledWith(
      "9",
      "55",
      mocks.canvasDeps,
    );
    await expect(response.json()).resolves.toMatchObject({
      code: 200,
      data: { project_id: "55", nodes: [] },
    });
  });
});
