import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listUserConsumeLogs: vi.fn(),
  resolveTokenIdentity: vi.fn(),
}));

vi.mock("@blue-whale/core", () => ({
  createNewApiClient: () => ({
    listUserConsumeLogs: mocks.listUserConsumeLogs,
    resolveTokenIdentity: mocks.resolveTokenIdentity,
  }),
  NewApiError: class NewApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { GET } from "./route";

function getRequest(query = "") {
  return new Request(`http://localhost/api/account/consumptions${query}`, {
    headers: { authorization: "Bearer sk-test" },
  });
}

/**
 * 鉴权（IK6M2F）：/api/log/self 已迁账户层，凭用户 sk- 令牌直调，不发 New-Api-User。
 */
describe("GET /api/account/consumptions（消费记录）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEW_API_BASE_URL", "http://new-api.test");
    // sk- 令牌真校验（Go identity）：缺省放行「sk-test」
    mocks.resolveTokenIdentity.mockResolvedValue({
      userId: 1,
      username: "user1",
      email: null,
      status: 1,
    });
    mocks.listUserConsumeLogs.mockResolvedValue({
      items: [
        {
          id: 11,
          type: 2,
          content: "图像生成",
          model_name: "doubao-seedream-4-0-250828",
          quota: 1_200_000, // → 12 积分
          created_at: 1_750_000_000,
        },
        {
          id: 10,
          type: 2,
          content: "视频生成",
          model_name: "doubao-seedance-2-0-260128",
          quota: 2_000_000, // → 20 积分
          created_at: 1_749_000_000,
        },
        {
          id: 9,
          type: 2,
          content: "对话",
          model_name: "deepseek-chat",
          quota: 10_000, // 换算不足 1 → 保底 1
          created_at: 1_748_000_000,
        },
      ],
      total: 3,
    });
  });

  it("Go 流水 → 展示契约（消耗积分 + 模型名摘要）", async () => {
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.code).toBe(200);
    expect(json.data.total).toBe(3);
    expect(json.data.items).toEqual([
      {
        id: 11,
        credits: 12,
        summary: "生成图片",
        created_at: 1_750_000_000,
      },
      {
        id: 10,
        credits: 20,
        summary: "生成视频",
        created_at: 1_749_000_000,
      },
      { id: 9, credits: 1, summary: "内容生成", created_at: 1_748_000_000 },
    ]);
  });

  it("透传用户 sk- 令牌 + 分页参数透传（账户层 AccountTokenOrUserAuth）", async () => {
    await GET(getRequest("?p=3&page_size=10"));
    expect(mocks.listUserConsumeLogs).toHaveBeenCalledWith("sk-test", {
      page: 3,
      pageSize: 10,
    });
  });

  it("无令牌 → 401；NEW_API_BASE_URL 未配置 → 503", async () => {
    const unauthorized = await GET(
      new Request("http://localhost/api/account/consumptions"),
    );
    expect(unauthorized.status).toBe(401);

    vi.stubEnv("NEW_API_BASE_URL", "");
    const unavailable = await GET(getRequest());
    expect(unavailable.status).toBe(503);
  });

  it("Go 查询失败 → 502 信封", async () => {
    mocks.listUserConsumeLogs.mockRejectedValue(new Error("boom"));
    const response = await GET(getRequest());
    expect(response.status).toBe(502);
    const json = await response.json();
    expect(json.code).toBe(502);
  });
});
