import { describe, expect, it, vi } from "vitest";

const { createNewApiClient } = vi.hoisted(() => ({
  createNewApiClient: vi.fn(),
}));

// backend new-api image provider（ark-image-provider.ts 的 createNewApiImageProvider）：
// generate catch 错误分类测试。createNewApiClient 被 mock（抛 NewApiError），
// NewApiError 保留真实构造；不测 createArkImageProvider（Ark 直连经 core 客户端单测覆盖）。
vi.mock("@blue-whale/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blue-whale/core")>();
  return { ...actual, createNewApiClient };
});

import { NewApiError } from "@blue-whale/core";
import { createGenerationImageProvider } from "./ark-image-provider.js";

function buildClientMock(error: NewApiError) {
  createNewApiClient.mockReturnValue({
    generateImagesWithReceipt: vi.fn().mockRejectedValue(error),
  });
}

function generateInput() {
  return {
    model: "doubao-seedream-5-0-pro-260628",
    prompt: "一只猫",
    n: 1,
  };
}

describe("new-api image provider 错误分类（IKDAJN）", () => {
  it("catch + copyright restrictions → content_rejected", async () => {
    buildClientMock(
      new NewApiError(
        "The request failed because the output image may be related to copyright restrictions",
        500,
      ),
    );
    const provider = createGenerationImageProvider({
      env: {
        NEW_API_BASE_URL: "http://new-api.test",
        NEW_API_IMAGE_TIMEOUT_MS: "1000",
      },
      token: "sk-user",
    });
    await expect(
      provider.generate(generateInput()),
    ).rejects.toMatchObject({ code: "content_rejected" });
  });

  it("catch + 敏感信息 → content_rejected", async () => {
    buildClientMock(
      new NewApiError("信息可能包含敏感内容，请您更换内容后重试", 200),
    );
    const provider = createGenerationImageProvider({
      env: {
        NEW_API_BASE_URL: "http://new-api.test",
        NEW_API_IMAGE_TIMEOUT_MS: "1000",
      },
      token: "sk-user",
    });
    await expect(
      provider.generate(generateInput()),
    ).rejects.toMatchObject({ code: "content_rejected" });
  });

  it("catch + 欠费 → quota_exhausted（回归，不被 content 正则抢语义）", async () => {
    buildClientMock(
      new NewApiError("预扣费额度失败, 用户剩余额度: ¥0.9", 200),
    );
    const provider = createGenerationImageProvider({
      env: {
        NEW_API_BASE_URL: "http://new-api.test",
        NEW_API_IMAGE_TIMEOUT_MS: "1000",
      },
      token: "sk-user",
    });
    await expect(
      provider.generate(generateInput()),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
  });
});
