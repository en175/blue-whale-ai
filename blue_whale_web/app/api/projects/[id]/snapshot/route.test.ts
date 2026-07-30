import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const snapshotDeps = { projects: {}, canvases: {}, generationJobs: {} };

  return {
    snapshotDeps,
    withAuthenticatedUser: vi.fn(
      async (
        _request: Request,
        handler: (user: {
          userId: string;
          status: "enabled";
        }) => Promise<Response> | Response,
      ) => handler({ userId: "9", status: "enabled" }),
    ),
    createSnapshotDeps: vi.fn(() => snapshotDeps),
    handleGetSnapshot: vi.fn(),
  };
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: mocks.withAuthenticatedUser,
}));
vi.mock("@/lib/snapshot/deps", () => ({
  createSnapshotDeps: mocks.createSnapshotDeps,
}));
vi.mock("@/lib/snapshot/handle-get-snapshot", () => ({
  handleGetSnapshot: mocks.handleGetSnapshot,
}));

import { GET } from "./route";

describe("GET /api/projects/[id]/snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleGetSnapshot.mockResolvedValue({
      code: 200,
      msg: "success",
      data: { project: { id: "55" }, canvas: null, generation_jobs: [] },
    });
  });

  it("loads the requested snapshot for the authenticated user", async () => {
    const response = await GET(
      new Request("http://localhost/api/projects/55/snapshot"),
      { params: Promise.resolve({ id: "55" }) },
    );

    expect(mocks.handleGetSnapshot).toHaveBeenCalledWith(
      "9",
      "55",
      mocks.snapshotDeps,
    );
    await expect(response.json()).resolves.toMatchObject({
      code: 200,
      data: { project: { id: "55" }, generation_jobs: [] },
    });
  });
});
