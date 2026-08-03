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
    handleRemoveSkill: vi.fn(),
    handleUpdateSkillAuto: vi.fn(),
  };
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: mocks.withAuthenticatedUser,
}));
vi.mock("@/lib/skills/deps", () => ({
  createSkillsDeps: mocks.createSkillsDeps,
}));
vi.mock("@/lib/skills/handle-skill-writes", () => ({
  handleRemoveSkill: mocks.handleRemoveSkill,
  handleUpdateSkillAuto: mocks.handleUpdateSkillAuto,
}));

import { PATCH } from "./route";

describe("PATCH /api/agent/skills/mine/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleUpdateSkillAuto.mockResolvedValue({
      code: 200,
      msg: "success",
      data: null,
    });
  });

  it("updates the authenticated user's skill", async () => {
    const body = { auto: true };
    const response = await PATCH(
      new Request("http://localhost/api/agent/skills/mine/poster_gen", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": "999",
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: "poster_gen" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.handleUpdateSkillAuto).toHaveBeenCalledWith(
      "9",
      "poster_gen",
      true,
      mocks.skillsDeps,
    );
  });
});
