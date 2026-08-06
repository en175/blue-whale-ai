import { Prisma } from "@prisma/client";
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

describe("ModelCapabilityAdminRepo.getById", () => {
  it("id 非法 → null，不查库", async () => {
    const findFirst = vi.fn();
    const prisma = {
      generation_model_capability: { findFirst },
    } as unknown as PrismaClient;

    const row = await createModelCapabilityAdminRepo(prisma).getById("abc");
    expect(row).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("命中返回单行，过滤已软删", async () => {
    const prisma = {
      generation_model_capability: {
        findFirst: vi.fn().mockResolvedValue(makeRow({ id: 2n })),
      },
    } as unknown as PrismaClient;

    const row = await createModelCapabilityAdminRepo(prisma).getById("2");
    expect(row).toMatchObject({ id: "2", model_id: "doubao-seedream-4-0-250828" });
    expect(prisma.generation_model_capability.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2n, is_delete: false } }),
    );
  });
});

describe("ModelCapabilityAdminRepo.create", () => {
  it("sort_order 取 max+1，default_size 派生自 supported_sizes 首项", async () => {
    const prisma = {
      generation_model_capability: {
        aggregate: vi.fn().mockResolvedValue({ _max: { sort_order: 2 } }),
        create: vi.fn().mockResolvedValue(
          makeRow({ id: 3n, model_id: "new-model", sort_order: 3 }),
        ),
      },
    } as unknown as PrismaClient;

    const result = await createModelCapabilityAdminRepo(prisma).create({
      provider_id: "volcengine",
      model_id: "new-model",
      capability_type: "image",
      model_label: "新模型",
      supported_sizes: [{ id: "1k" }],
    });

    expect(result).toEqual({ ok: true, row: expect.objectContaining({ id: "3" }) });
    expect(prisma.generation_model_capability.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sort_order: 3,
          default_size: "1k",
          supported_sizes: [{ id: "1k" }],
          features: {},
          supported_durations: Prisma.DbNull,
          enabled: true,
        }),
      }),
    );
  });

  it("同 (provider_id, model_id) 已存在 → conflict（P2002）", async () => {
    const prisma = {
      generation_model_capability: {
        aggregate: vi.fn().mockResolvedValue({ _max: { sort_order: null } }),
        create: vi.fn().mockRejectedValue({ code: "P2002" }),
      },
    } as unknown as PrismaClient;

    const result = await createModelCapabilityAdminRepo(prisma).create({
      provider_id: "volcengine",
      model_id: "doubao-seedream-4-0-250828",
      capability_type: "image",
      model_label: "重复",
    });

    expect(result).toEqual({ ok: false, error: "conflict" });
  });
});

describe("ModelCapabilityAdminRepo.update", () => {
  it("更新可编辑字段，身份字段不受入参影响", async () => {
    const prisma = {
      generation_model_capability: {
        findFirst: vi.fn().mockResolvedValue(makeRow({ id: 1n })),
        update: vi.fn().mockResolvedValue(
          makeRow({ id: 1n, model_label: "新名字", enabled: false }),
        ),
      },
    } as unknown as PrismaClient;

    const row = await createModelCapabilityAdminRepo(prisma).update("1", {
      model_label: "新名字",
      enabled: false,
    });

    expect(row).toMatchObject({ id: "1", model_label: "新名字", enabled: false });
    expect(prisma.generation_model_capability.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ model_label: "新名字", enabled: false }),
      }),
    );
  });

  it("id 非法 / 不存在 / 已软删 → null", async () => {
    const prisma = {
      generation_model_capability: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    } as unknown as PrismaClient;

    const repo = createModelCapabilityAdminRepo(prisma);
    expect(await repo.update("abc", { model_label: "x" })).toBeNull();
    expect(await repo.update("1", { model_label: "x" })).toBeNull();
    expect(prisma.generation_model_capability.update).not.toHaveBeenCalled();
  });
});
