import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const formatDeps = { ai: {}, rules: "固定规则" };

  return {
    formatDeps,
    withAuthenticatedUser: vi.fn(
      async (
        _request: Request,
        handler: (user: {
          userId: string;
          status: "enabled";
        }) => Promise<Response> | Response,
      ) => handler({ userId: "9", status: "enabled" }),
    ),
    createSkillFormatDeps: vi.fn(
      (): { ai: object; rules: string } | null => formatDeps,
    ),
    handleFormatSkillDraft: vi.fn(),
  };
});

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAuthenticatedUser: mocks.withAuthenticatedUser,
}));
vi.mock("@/lib/skills/deps", () => ({
  createSkillFormatDeps: mocks.createSkillFormatDeps,
}));
vi.mock("@/lib/skills/handle-skill-writes", () => ({
  handleFormatSkillDraft: mocks.handleFormatSkillDraft,
}));

import { POST } from "./route";

function postJson(body: unknown) {
  return new Request("http://localhost/api/agent/skills/personal/format", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agent/skills/personal/format", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSkillFormatDeps.mockReturnValue(mocks.formatDeps);
    mocks.handleFormatSkillDraft.mockResolvedValue({
      code: 200,
      msg: null,
      data: { content: "格式化后" },
    });
  });

  it("委托 handleFormatSkillDraft 并透传 envelope", async () => {
    const response = await POST(postJson({ content: "草稿" }));

    expect(response.status).toBe(200);
    expect(mocks.handleFormatSkillDraft).toHaveBeenCalledWith(
      "草稿",
      mocks.formatDeps,
    );
    await expect(response.json()).resolves.toEqual({
      code: 200,
      msg: null,
      data: { content: "格式化后" },
    });
  });

  it.each([{}, { content: "" }, { content: 42 }])(
    "content 缺失/非法（%j）→ 400，不调 handler",
    async (body) => {
      const response = await POST(postJson(body));
      await expect(response.json()).resolves.toEqual({
        code: 400,
        msg: "content 参数缺失",
      });
      expect(mocks.handleFormatSkillDraft).not.toHaveBeenCalled();
    },
  );

  it("deps 未配置（env 缺失）→ 100104，不调 handler", async () => {
    mocks.createSkillFormatDeps.mockReturnValue(null);
    const response = await POST(postJson({ content: "草稿" }));
    await expect(response.json()).resolves.toEqual({
      code: 100104,
      msg: "AI 格式化未配置",
    });
    expect(mocks.handleFormatSkillDraft).not.toHaveBeenCalled();
  });
});
