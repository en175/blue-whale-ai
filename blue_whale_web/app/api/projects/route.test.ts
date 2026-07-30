import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const projectDeps = { projects: {} };

  return {
    projectDeps,
    withAuthenticatedUser: vi.fn(
      async (
        _request: Request,
        handler: (user: {
          userId: string;
          status: "enabled";
        }) => Promise<Response> | Response,
      ) => handler({ userId: "9", status: "enabled" }),
    ),
    createProjectDeps: vi.fn(() => projectDeps),
    handleListProjects: vi.fn(),
    handleCreateProject: vi.fn(),
  };
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: mocks.withAuthenticatedUser,
}));
vi.mock("@/lib/project/deps", () => ({
  createProjectDeps: mocks.createProjectDeps,
}));
vi.mock("@/lib/project/handle-list-projects", () => ({
  handleListProjects: mocks.handleListProjects,
}));
vi.mock("@/lib/project/handle-create-project", () => ({
  handleCreateProject: mocks.handleCreateProject,
}));

import { GET, POST } from "./route";

describe("/api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleListProjects.mockResolvedValue({
      code: 200,
      msg: "success",
      data: [{ id: "55" }],
    });
    mocks.handleCreateProject.mockResolvedValue({
      code: 200,
      msg: "success",
      data: { id: "55", name: "Launch" },
    });
  });

  it("GET lists projects for the authenticated user", async () => {
    const response = await GET(new Request("http://localhost/api/projects"));

    expect(mocks.handleListProjects).toHaveBeenCalledWith(
      "9",
      mocks.projectDeps,
    );
    await expect(response.json()).resolves.toEqual({
      code: 200,
      msg: "success",
      data: [{ id: "55" }],
    });
  });

  it("POST creates a project for the authenticated user", async () => {
    const body = { name: "Launch" };
    const response = await POST(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    expect(mocks.handleCreateProject).toHaveBeenCalledWith(
      "9",
      body,
      mocks.projectDeps,
    );
    await expect(response.json()).resolves.toEqual({
      code: 200,
      msg: "success",
      data: { id: "55", name: "Launch" },
    });
  });

  it("returns the authentication adapter's 403 response", async () => {
    mocks.withAuthenticatedUser.mockResolvedValueOnce(
      Response.json(
        { code: 403, msg: "账户已停用", data: null },
        { status: 403 },
      ),
    );

    const response = await GET(new Request("http://localhost/api/projects"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: 403,
      msg: "账户已停用",
      data: null,
    });
    expect(mocks.handleListProjects).not.toHaveBeenCalled();
  });
});
