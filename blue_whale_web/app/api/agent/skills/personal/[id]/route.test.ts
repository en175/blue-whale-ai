import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const skillsDeps = { skills: {} };

  return {
    skillsDeps,
    withAuthenticatedUser: vi.fn(
      async (
        _request: Request,
        handler: (user: {
          userId: string;
          status: "enabled";
        }) => Promise<Response> | Response,
      ) => handler({ userId: "9", status: "enabled" }),
    ),
    createSkillsDeps: vi.fn(() => skillsDeps),
    handleGetPersonalSkill: vi.fn(),
    handleDeletePersonalSkill: vi.fn(),
  };
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: mocks.withAuthenticatedUser,
}));
vi.mock("@/lib/skills/deps", () => ({
  createSkillsDeps: mocks.createSkillsDeps,
}));
vi.mock("@/lib/skills/handle-skill-writes", () => ({
  handleGetPersonalSkill: mocks.handleGetPersonalSkill,
  handleDeletePersonalSkill: mocks.handleDeletePersonalSkill,
}));

import { DELETE, GET } from "./route";

describe("GET /api/agent/skills/personal/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleGetPersonalSkill.mockResolvedValue({
      code: 200,
      msg: null,
      data: { content: "---\nname: a\ndescription: b\n---\n\nbody\n" },
    });
  });

  it("delegates to handleGetPersonalSkill with the authenticated user", async () => {
    const response = await GET(
      new Request("http://localhost/api/agent/skills/personal/my_personal"),
      { params: Promise.resolve({ id: "my_personal" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.handleGetPersonalSkill).toHaveBeenCalledWith(
      "9",
      "my_personal",
      mocks.skillsDeps,
    );
    await expect(response.json()).resolves.toEqual({
      code: 200,
      msg: null,
      data: { content: "---\nname: a\ndescription: b\n---\n\nbody\n" },
    });
  });
});

describe("DELETE /api/agent/skills/personal/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleDeletePersonalSkill.mockResolvedValue({
      code: 200,
      msg: null,
      data: null,
    });
  });

  it("delegates to handleDeletePersonalSkill with the authenticated user", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/agent/skills/personal/my_personal", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "my_personal" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.handleDeletePersonalSkill).toHaveBeenCalledWith(
      "9",
      "my_personal",
      mocks.skillsDeps,
    );
  });
});
