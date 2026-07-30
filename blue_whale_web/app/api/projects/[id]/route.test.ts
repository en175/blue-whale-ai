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
    handleGetProject: vi.fn(),
    handleRenameProject: vi.fn(),
    handleDeleteProject: vi.fn(),
  };
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: mocks.withAuthenticatedUser,
}));
vi.mock("@/lib/project/deps", () => ({
  createProjectDeps: mocks.createProjectDeps,
}));
vi.mock("@/lib/project/handle-get-project", () => ({
  handleGetProject: mocks.handleGetProject,
}));
vi.mock("@/lib/project/handle-rename-project", () => ({
  handleRenameProject: mocks.handleRenameProject,
}));
vi.mock("@/lib/project/handle-delete-project", () => ({
  handleDeleteProject: mocks.handleDeleteProject,
}));

import { DELETE, GET, PUT } from "./route";

const context = { params: Promise.resolve({ id: "55" }) };

describe("/api/projects/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleGetProject.mockResolvedValue({
      code: 200,
      msg: "success",
      data: { id: "55", name: "Launch" },
    });
    mocks.handleRenameProject.mockResolvedValue({
      code: 200,
      msg: "success",
      data: { id: "55", name: "Renamed" },
    });
    mocks.handleDeleteProject.mockResolvedValue({
      code: 200,
      msg: "success",
      data: null,
    });
  });

  it("GET reads the requested project for the authenticated user", async () => {
    const response = await GET(
      new Request("http://localhost/api/projects/55"),
      context,
    );

    expect(mocks.handleGetProject).toHaveBeenCalledWith(
      "9",
      "55",
      mocks.projectDeps,
    );
    await expect(response.json()).resolves.toMatchObject({
      code: 200,
      data: { id: "55", name: "Launch" },
    });
  });

  it("PUT renames the requested project for the authenticated user", async () => {
    const body = { name: "Renamed" };
    const response = await PUT(
      new Request("http://localhost/api/projects/55", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      context,
    );

    expect(mocks.handleRenameProject).toHaveBeenCalledWith(
      "9",
      "55",
      body,
      mocks.projectDeps,
    );
    await expect(response.json()).resolves.toMatchObject({
      code: 200,
      data: { id: "55", name: "Renamed" },
    });
  });

  it("DELETE removes the requested project for the authenticated user", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/projects/55", { method: "DELETE" }),
      context,
    );

    expect(mocks.handleDeleteProject).toHaveBeenCalledWith(
      "9",
      "55",
      mocks.projectDeps,
    );
    await expect(response.json()).resolves.toEqual({
      code: 200,
      msg: "success",
      data: null,
    });
  });
});
