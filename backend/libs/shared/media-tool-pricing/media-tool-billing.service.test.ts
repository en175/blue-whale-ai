import { describe, expect, it, vi } from "vitest";

import { DomainError } from "@lib/contracts";
import {
  MediaToolBillingService,
  createMediaToolJobBilling,
  freeMediaToolQuote,
  quoteMediaTool,
  type MediaToolPricingSnapshot,
} from "./media-tool-billing.service.js";

const PAID_ROW: MediaToolPricingSnapshot & {
  enabled: boolean;
  is_delete: boolean;
} = {
  label: "智能抠图",
  pricing: {
    baseUnit: "constant:1",
    basePrice: { kind: "const", value: 1000 },
    unitDenominator: 1,
    minCredits: 1,
  },
  version: 3,
  charge_enabled: true,
  enabled: true,
  is_delete: false,
};

function makeService(row: unknown) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const prisma = {
    client: { media_tool_pricing: { findUnique } },
  };
  return {
    service: new MediaToolBillingService(prisma as never, {} as never),
    findUnique,
  };
}

describe("createMediaToolJobBilling", () => {
  it("扣款带工具标题与规则快照，退款按用户与原因", async () => {
    const charge = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const input = { source_asset_id: "88", cutout_scene: "general" };
    const billing = createMediaToolJobBilling({
      row: PAID_ROW,
      toolType: "image_cutout",
      userId: "9",
      input,
      charge,
      release,
    });

    await billing.charge(400);
    await billing.release(400, "任务入队失败");

    expect(charge).toHaveBeenCalledWith({
      userId: "9",
      jobId: 400,
      commandId: "media-tool:image_cutout:400",
      modelId: "image_cutout",
      taskType: "image_cutout",
      input,
      title: "智能抠图",
      ruleSnapshot: JSON.stringify(PAID_ROW.pricing),
    });
    expect(release).toHaveBeenCalledWith({
      userId: "9",
      jobId: 400,
      reason: "任务入队失败",
    });
  });
});

describe("quoteMediaTool", () => {
  it("把报价换算成积分并给出可复现的修订号", async () => {
    const quote = vi.fn().mockResolvedValue({
      credits: 1000n,
      catalogVersion: 7,
      tier: "basic",
    });
    const input = { source_asset_id: "88" };
    const result = await quoteMediaTool({
      row: PAID_ROW,
      toolType: "image_cutout",
      userId: "9",
      input,
      quote,
    });

    expect(quote).toHaveBeenCalledWith({
      userId: "9",
      modelId: "image_cutout",
      taskType: "image_cutout",
      input,
      ruleSnapshot: JSON.stringify(PAID_ROW.pricing),
    });
    expect(result.credits).toBe(1000);
    expect(result.quote_revision).toContain("catalog-7:cap-3:tier-basic");
  });

  it("计价服务不可用时返回空报价，不阻断提交", async () => {
    const quote = vi.fn().mockResolvedValue(null);
    const result = await quoteMediaTool({
      row: PAID_ROW,
      toolType: "image_cutout",
      userId: "9",
      input: {},
      quote,
    });
    expect(result).toEqual({ credits: null, quote_revision: null });
  });
});

describe("freeMediaToolQuote", () => {
  it("关闭收费的工具报价为 0 且仍给修订号", () => {
    const result = freeMediaToolQuote(
      { ...PAID_ROW, charge_enabled: false },
      { source_asset_id: "88" },
    );
    expect(result.credits).toBe(0);
    expect(result.quote_revision).toContain("cap-3");
  });
});

describe("MediaToolBillingService", () => {
  it("关闭收费的工具不建计费钩子，报价为免费", async () => {
    const { service } = makeService({ ...PAID_ROW, charge_enabled: false });
    await expect(
      service.jobBilling("image_cutout", "9", {}),
    ).resolves.toBeUndefined();
    await expect(service.quote("image_cutout", "9", {})).resolves.toMatchObject({
      credits: 0,
    });
  });

  it("计价行缺失时拒绝提交，报价降级为空", async () => {
    const { service } = makeService(null);
    await expect(service.jobBilling("image_cutout", "9", {})).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(service.quote("image_cutout", "9", {})).resolves.toEqual({
      credits: null,
      quote_revision: null,
    });
  });
});
