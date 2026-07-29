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
    handleSaveCanvas: vi.fn(),
  };
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: mocks.withAuthenticatedUser,
}));
vi.mock("@/lib/canvas/deps", () => ({
  createCanvasDeps: mocks.createCanvasDeps,
}));
vi.mock("@/lib/canvas/handle-canvas", () => ({
  handleSaveCanvas: mocks.handleSaveCanvas,
}));

import { PUT } from "./route";

describe("PUT /api/canvases/[projectId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleSaveCanvas.mockResolvedValue({
      code: 200,
      msg: "success",
      data: { project_id: "55", viewport: { x: 1 }, nodes: [] },
    });
  });

  it("saves the requested Canvas for the authenticated user", async () => {
    const body = { viewport: { x: 1 }, nodes: [] };
    const response = await PUT(
      new Request("http://localhost/api/canvases/55", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ projectId: "55" }) },
    );

    expect(mocks.handleSaveCanvas).toHaveBeenCalledWith(
      "9",
      "55",
      body,
      mocks.canvasDeps,
    );
    await expect(response.json()).resolves.toMatchObject({
      code: 200,
      data: { project_id: "55", viewport: { x: 1 }, nodes: [] },
    });
  });
});
