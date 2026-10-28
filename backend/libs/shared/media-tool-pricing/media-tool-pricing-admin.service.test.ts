import { describe, expect, it } from "vitest";

import {
  MediaToolPricingAdminService,
  parseMediaToolPricingUpdate,
} from "./media-tool-pricing-admin.service.js";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 1n,
  tool_type: "video_enhance",
  label: "HD 高清",
  pricing: {
    baseUnit: "usage.seconds",
    basePrice: { kind: "const", value: 1000 },
  },
  version: 0,
  enabled: true,
  charge_enabled: true,
  gmt_create: new Date("2026-10-19T00:00:00Z"),
  gmt_modified: new Date("2026-10-19T00:00:00Z"),
  is_delete: false,
  ...overrides,
});

function fakeService(initial = [row()]) {
  const rows = new Map<string, ReturnType<typeof row>>(
    initial.map((item) => [item.tool_type as string, item]),
  );
  const client = {
    findMany: async () =>
      [...rows.values()]
        .filter((item) => !item.is_delete)
        .sort((a, b) => String(a.tool_type).localeCompare(String(b.tool_type))),
    findFirst: async ({ where }: { where: { tool_type: string } }) => {
      const found = rows.get(where.tool_type);
      return found && !found.is_delete ? found : null;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: bigint };
      data: Record<string, unknown>;
    }) => {
      const found = [...rows.values()].find((item) => item.id === where.id);
      if (!found) throw new Error("not found");
      const version = data.version as { increment?: number } | undefined;
      if (version?.increment) found.version += version.increment;
      for (const [key, value] of Object.entries(data)) {
        if (key === "version") continue;
        (found as Record<string, unknown>)[key] = value;
      }
      return found;
    },
  };
  return new MediaToolPricingAdminService({
    client: { catalog_media_tools: client },
  } as never);
}

describe("parseMediaToolPricingUpdate", () => {
  it("接受价目与收费状态", () => {
    const parsed = parseMediaToolPricingUpdate({
      pricing: {
        baseUnit: "usage.seconds",
        basePrice: { kind: "const", value: 1000 },
        quantityOffset: 1,
        quantityStep: 5,
      },
      charge_enabled: false,
    }, "audio_trim");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.charge_enabled).toBe(false);
      expect(parsed.value.pricing).toBeDefined();
    }
  });

  it("拒绝非法价目、非布尔收费状态和空更新", () => {
    expect(parseMediaToolPricingUpdate({ pricing: { baseUnit: "usage.seconds" } }, "audio_trim").ok).toBe(false);
    expect(parseMediaToolPricingUpdate({ pricing: null }, "audio_trim").ok).toBe(false);
    expect(parseMediaToolPricingUpdate({ charge_enabled: "false" }, "audio_trim").ok).toBe(false);
    expect(parseMediaToolPricingUpdate({}, "audio_trim").ok).toBe(false);
  });

  it("按工具契约校验 baseUnit 与分档维度", () => {
    expect(
      parseMediaToolPricingUpdate(
        { pricing: { baseUnit: "constant:1", basePrice: { kind: "const", value: 1000 } } },
        "audio_trim",
      ).ok,
    ).toBe(false);
    expect(
      parseMediaToolPricingUpdate(
        { pricing: { baseUnit: "constant:1", basePrice: { kind: "const", value: 7000 } } },
        "image_cutout",
      ).ok,
    ).toBe(true);
    expect(
      parseMediaToolPricingUpdate(
        {
          pricing: {
            baseUnit: "usage.seconds",
            basePrice: { kind: "table", by: ["resolution"], table: { "resolution=1080p": 3000 } },
          },
        },
        "video_enhance",
      ).ok,
    ).toBe(true);
    expect(
      parseMediaToolPricingUpdate(
        {
          pricing: {
            baseUnit: "usage.seconds",
            basePrice: { kind: "table", by: ["fps"], table: { "fps=30": 45000 } },
          },
        },
        "video_enhance",
      ).ok,
    ).toBe(false);
    expect(
      parseMediaToolPricingUpdate(
        {
          pricing: {
            baseUnit: "constant:1",
            basePrice: { kind: "table", by: ["multiple"], table: { "multiple=2": 15000 } },
          },
        },
        "image_enhance",
      ).ok,
    ).toBe(true);
  });
});

describe("MediaToolPricingAdminService", () => {
  it("列表返回映射行", async () => {
    const rows = await fakeService().listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tool_type: "video_enhance", charge_enabled: true });
  });

  it("更新价目/收费状态并递增 version", async () => {
    const service = fakeService();
    const updated = await service.update("video_enhance", { charge_enabled: false });
    expect(updated).toMatchObject({ charge_enabled: false, version: 1 });
  });

  it("切换收费状态", async () => {
    const service = fakeService();
    expect((await service.toggleCharge("video_enhance"))?.charge_enabled).toBe(false);
    expect((await service.toggleCharge("video_enhance"))?.charge_enabled).toBe(true);
  });
});
