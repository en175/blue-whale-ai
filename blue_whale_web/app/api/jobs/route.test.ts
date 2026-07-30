import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const jobsDeps = { jobs: {} };

  return {
    jobsDeps,
    withAuthenticatedUser: vi.fn(
      async (
        _request: Request,
        handler: (user: {
          userId: string;
          status: "enabled";
        }) => Promise<Response> | Response,
      ) => handler({ userId: "9", status: "enabled" }),
    ),
    createJobsDeps: vi.fn(() => jobsDeps),
    handleListJobs: vi.fn(),
  };
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: mocks.withAuthenticatedUser,
}));
vi.mock("@/lib/jobs/deps", () => ({
  createJobsDeps: mocks.createJobsDeps,
}));
vi.mock("@/lib/jobs/handle-list-jobs", () => ({
  handleListJobs: mocks.handleListJobs,
}));

import { GET } from "./route";

describe("GET /api/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleListJobs.mockResolvedValue({
      code: 200,
      msg: "success",
      data: { items: [], page: 2, size: 10, total: 0 },
    });
  });

  it("lists jobs for the authenticated user instead of a forged request user", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/jobs?type=video&status=queued&projectId=55&page=2&size=10",
        {
          headers: {
            Authorization: "Bearer sk-browser-token",
            "X-User-Id": "999",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.handleListJobs).toHaveBeenCalledWith(
      "9",
      {
        type: "video",
        status: "queued",
        projectId: "55",
        page: 2,
        size: 10,
      },
      mocks.jobsDeps,
    );
  });
});
