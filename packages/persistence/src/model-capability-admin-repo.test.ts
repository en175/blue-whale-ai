import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createModelCapabilityAdminRepo } from "./model-capability-admin-repo.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    provider_id: "volcengine",
    model_id: "doubao-seedream-4-0-250828",
    capability_type: "image",
    model_label: "豆包 Seedream 4.0",
    icon: null,
    supported_sizes: [{ id: "1k", label: "1K" }],
    supported_aspect_ratios: ["1:1", "16:9"],
    supported_durations: null,
    supported_formats: ["png", "jpeg"],
    default_size: "1K",
    default_format: "png",
    default_aspect_ratio: "1:1",
    default_duration: null,
    features: { stream: true },
    enabled: true,
    sort_order: 1,
    gmt_create: new Date("2026-08-01T00:00:00Z"),
    gmt_modified: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

describe("ModelCapabilityAdminRepo.listAll", () => {
  it("返回全部未软删行，id 转字符串、时间转 ISO、JSON 列原样往返", async () => {
    const prisma = {
      generation_model_capability: {
        findMany: vi.fn().mockResolvedValue([
          makeRow(),
          makeRow({
            id: 2n,
            model_id: "doubao-seedance-2-0-260128",
            capability_type: "video",
            model_label: "豆包 Seedance 2.0",
            enabled: false,
            sort_order: 2,
          }),
        ]),
      },
    } as unknown as PrismaClient;

    const rows = await createModelCapabilityAdminRepo(prisma).listAll();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "1",
      provider_id: "volcengine",
      model_id: "doubao-seedream-4-0-250828",
      capability_type: "image",
      enabled: true,
      sort_order: 1,
      created_at: "2026-08-01T00:00:00.000Z",
    });
    expect(rows[1].enabled).toBe(false);
    expect(rows[0].supported_sizes).toEqual([{ id: "1k", label: "1K" }]);
    expect(rows[0].features).toEqual({ stream: true });
  });

  it("过滤 is_delete=true 的行，按 capability_type + sort_order 排序", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      generation_model_capability: { findMany },
    } as unknown as PrismaClient;

    await createModelCapabilityAdminRepo(prisma).listAll();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { is_delete: false },
        orderBy: [{ capability_type: "asc" }, { sort_order: "asc" }],
      }),
    );
  });
});
