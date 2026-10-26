import { describe, expect, it, vi } from "vitest";

import { AdminBillingCatalogController } from "./billing-catalog.controller.js";
import {
  BillingAdminConfigError,
  BillingAdminError,
  CatalogRejectedError,
} from "@lib/shared/billing/billing-admin-client.js";

const billing = vi.hoisted(() => ({
  fetchActiveCatalog: vi.fn(),
  publishCatalog: vi.fn(),
}));

vi.mock("@lib/shared/billing/billing-admin-client.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, ...billing };
});

const OPERATOR = { userId: "42" } as never;

function createController() {
  return new AdminBillingCatalogController();
}

describe("AdminBillingCatalogController.active", () => {
  it("回当前目录（含文档原文与版本信息）", async () => {
    billing.fetchActiveCatalog.mockResolvedValue({
      catalogVersion: 3,
      documentHash: "abc",
      ruleCount: 2,
      creditsPerYuan: 15,
      document: '{"schemaVersion":1}',
    });

    await expect(createController().active()).resolves.toEqual({
      success: true,
      data: {
        catalogVersion: 3,
        documentHash: "abc",
        ruleCount: 2,
        creditsPerYuan: 15,
        document: '{"schemaVersion":1}',
      },
    });
  });

  it("没有任何生效版本时原样回 -1 / 空文档，而不是报错", async () => {
    billing.fetchActiveCatalog.mockResolvedValue({
      catalogVersion: -1,
      documentHash: "",
      ruleCount: 0,
      creditsPerYuan: -1,
      document: "",
    });

    const result = await createController().active();
    expect(result.data).toMatchObject({ catalogVersion: -1, document: "" });
  });

  it("billing 管理端地址没配 → 503，且不伪装成 500", async () => {
    billing.fetchActiveCatalog.mockRejectedValue(
      new BillingAdminConfigError("计费管理端地址未配置（缺环境变量 BILLING_ADMIN_URL）"),
    );

    await expect(createController().active()).rejects.toMatchObject({
      status: 503,
      message: "计费管理端地址未配置（缺环境变量 BILLING_ADMIN_URL）",
    });
  });
});

describe("AdminBillingCatalogController.publish", () => {
  it("整份发布：文档文本原样外发，publishedBy 记当前管理员", async () => {
    billing.publishCatalog.mockResolvedValue({
      catalogVersion: 4,
      documentHash: "def",
      ruleCount: 2,
      creditsPerYuan: 15,
    });

    const document = '{"schemaVersion":1,"creditsPerYuan":15}';
    await expect(
      createController().publish(OPERATOR, { document, note: " 改价 " }),
    ).resolves.toEqual({
      success: true,
      data: { catalogVersion: 4, documentHash: "def", ruleCount: 2, creditsPerYuan: 15 },
    });

    expect(billing.publishCatalog).toHaveBeenCalledWith({
      document,
      publishedBy: "42",
      note: "改价",
    });
  });

  it("没填备注就不传 note 字段（不写空串）", async () => {
    billing.publishCatalog.mockResolvedValue({
      catalogVersion: 4,
      documentHash: "def",
      ruleCount: 0,
      creditsPerYuan: 15,
    });

    await createController().publish(OPERATOR, { document: "{}" });

    expect(billing.publishCatalog).toHaveBeenCalledWith({
      document: "{}",
      publishedBy: "42",
    });
  });

  it("document 不是文本 / 为空 → 400，且不打扰 billing", async () => {
    billing.publishCatalog.mockClear();

    for (const body of [{}, { document: "" }, { document: "   " }, { document: { a: 1 } }]) {
      await expect(createController().publish(OPERATOR, body)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(billing.publishCatalog).not.toHaveBeenCalled();
  });

  it("文档被拒（编译不过）→ 400 且带上 billing 的原话", async () => {
    billing.publishCatalog.mockRejectedValue(
      new CatalogRejectedError("目录被拒：baseUnit 指向不存在的维度 usage.不存在"),
    );

    await expect(
      createController().publish(OPERATOR, { document: "{}" }),
    ).rejects.toMatchObject({
      status: 400,
      message: "目录被拒：baseUnit 指向不存在的维度 usage.不存在",
    });
  });

  it("billing 不可用 → 503（与服务故障同向，可重试）", async () => {
    billing.publishCatalog.mockRejectedValue(new BillingAdminError("HTTP 502"));

    await expect(
      createController().publish(OPERATOR, { document: "{}" }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("未知异常 → 500", async () => {
    billing.publishCatalog.mockRejectedValue(new Error("boom"));

    await expect(
      createController().publish(OPERATOR, { document: "{}" }),
    ).rejects.toMatchObject({ status: 500, message: "boom" });
  });
});
