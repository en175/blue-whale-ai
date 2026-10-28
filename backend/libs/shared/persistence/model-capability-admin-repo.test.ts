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
      catalog_models: {
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
      created_at: "2026-08-01T08:00:00+08:00",
    });
    expect(rows[1].enabled).toBe(false);
    expect(rows[0].supported_sizes).toEqual([{ id: "1k", label: "1K" }]);
    expect(rows[0].features).toEqual({ stream: true });
  });

  it("过滤 is_delete=true 的行，按 capability_type + sort_order 排序", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      catalog_models: { findMany },
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
      catalog_models: { findFirst },
    } as unknown as PrismaClient;

    const row = await createModelCapabilityAdminRepo(prisma).getById("abc");
    expect(row).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("命中返回单行，过滤已软删", async () => {
    const prisma = {
      catalog_models: {
        findFirst: vi.fn().mockResolvedValue(makeRow({ id: 2n })),
      },
    } as unknown as PrismaClient;

    const row = await createModelCapabilityAdminRepo(prisma).getById("2");
    expect(row).toMatchObject({ id: "2", model_id: "doubao-seedream-4-0-250828" });
    expect(prisma.catalog_models.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 2n, is_delete: false } }),
    );
  });
});

describe("ModelCapabilityAdminRepo.create", () => {
  it("sort_order 取 max+1，default_size 派生自 supported_sizes 首项", async () => {
    const prisma = {
      catalog_models: {
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
    expect(prisma.catalog_models.create).toHaveBeenCalledWith(
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
      catalog_models: {
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
      catalog_models: {
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
    expect(prisma.catalog_models.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ model_label: "新名字", enabled: false }),
      }),
    );
  });

  it("id 非法 / 不存在 / 已软删 → null", async () => {
    const prisma = {
      catalog_models: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    } as unknown as PrismaClient;

    const repo = createModelCapabilityAdminRepo(prisma);
    expect(await repo.update("abc", { model_label: "x" })).toBeNull();
    expect(await repo.update("1", { model_label: "x" })).toBeNull();
    expect(prisma.catalog_models.update).not.toHaveBeenCalled();
  });
});

describe("ModelCapabilityAdminRepo.toggleEnabled", () => {
  it("原子翻转 enabled（SQL NOT enabled），返回更新后行", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const findFirst = vi.fn().mockResolvedValue(
      makeRow({ id: 1n, enabled: false }),
    );
    const prisma = {
      catalog_models: { findFirst },
      $executeRaw: executeRaw,
    } as unknown as PrismaClient;

    const row = await createModelCapabilityAdminRepo(prisma).toggleEnabled("1");
    expect(row).toMatchObject({ id: "1", enabled: false });
    expect(executeRaw).toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1n, is_delete: false } }),
    );
  });

  it("id 非法 → null 不查库；未命中（不存在/已软删）→ null", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const findFirst = vi.fn();
    const prisma = {
      catalog_models: { findFirst },
      $executeRaw: executeRaw,
    } as unknown as PrismaClient;

    const repo = createModelCapabilityAdminRepo(prisma);
    expect(await repo.toggleEnabled("abc")).toBeNull();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(await repo.toggleEnabled("1")).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("ModelCapabilityAdminRepo.remove", () => {
  it("软删除：is_delete=true，只命中未软删行", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      catalog_models: { updateMany },
    } as unknown as PrismaClient;

    const ok = await createModelCapabilityAdminRepo(prisma).remove("1");
    expect(ok).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1n, is_delete: false },
        data: expect.objectContaining({ is_delete: true }),
      }),
    );
  });

  it("id 非法 / 未命中 → false", async () => {
    const prisma = {
      catalog_models: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaClient;

    const repo = createModelCapabilityAdminRepo(prisma);
    expect(await repo.remove("abc")).toBe(false);
    expect(await repo.remove("999")).toBe(false);
  });
});

describe("ModelCapabilityAdminRepo.updateSortOrder", () => {
  it("批量事务更新排序；全部未软删命中 → ok", async () => {
    const update = vi.fn().mockResolvedValue({});
    const findMany = vi.fn().mockResolvedValue([{ id: 1n }, { id: 2n }]);
    const prisma = {
      catalog_models: { update, findMany },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const repo = createModelCapabilityAdminRepo(prisma);
    const result = await repo.updateSortOrder([
      { id: "1", sortOrder: 2 },
      { id: "2", sortOrder: 1 },
    ]);
    expect(result).toEqual({ ok: true });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [1n, 2n] }, is_delete: false },
        select: { id: true },
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("id 非法 → 抛错，不查库不事务", async () => {
    const prisma = {
      catalog_models: { findMany: vi.fn() },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const repo = createModelCapabilityAdminRepo(prisma);
    await expect(
      repo.updateSortOrder([{ id: "abc", sortOrder: 1 }]),
    ).rejects.toThrow("非法模型 id");
    expect(prisma.catalog_models.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("任一 id 不存在/已软删 → not-found，不产生部分更新", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 1n }]);
    const prisma = {
      catalog_models: { findMany },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const repo = createModelCapabilityAdminRepo(prisma);
    const result = await repo.updateSortOrder([
      { id: "1", sortOrder: 2 },
      { id: "9", sortOrder: 1 },
    ]);
    expect(result).toEqual({ ok: false, error: "not-found", missingId: "9" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("ModelCapabilityAdminRepo.setDefault（IKE0VX）", () => {
  it("同一事务内先清同类默认、再置本行，且不碰别的 capability_type", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 2n, capability_type: "text" })
      .mockResolvedValueOnce(
        makeRow({ id: 2n, capability_type: "text", is_default: true }),
      );
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      catalog_models: { findFirst, updateMany, update },
      $transaction: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const row = await createModelCapabilityAdminRepo(prisma).setDefault("2");

    expect(row).toMatchObject({ id: "2", is_default: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        capability_type: "text",
        is_delete: false,
        is_default: true,
        id: { not: 2n },
      },
      data: expect.objectContaining({ is_default: false }),
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 2n },
        data: expect.objectContaining({ is_default: true }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("id 非法 → null 不查库；不存在/已软删 → null 不写库", async () => {
    const notQueried = {
      catalog_models: { findFirst: vi.fn() },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    expect(await createModelCapabilityAdminRepo(notQueried).setDefault("abc")).toBeNull();
    expect(notQueried.catalog_models.findFirst).not.toHaveBeenCalled();

    const missing = {
      catalog_models: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    expect(await createModelCapabilityAdminRepo(missing).setDefault("9")).toBeNull();
    expect(missing.$transaction).not.toHaveBeenCalled();
  });

  it("停用的行也参与清除：停用一条默认模型再启用回来，不该出现两条默认", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 3n, capability_type: "text" })
      .mockResolvedValueOnce(makeRow({ id: 3n, capability_type: "text", is_default: true }));
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      catalog_models: { findFirst, updateMany, update: vi.fn() },
      $transaction: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    await createModelCapabilityAdminRepo(prisma).setDefault("3");

    const where = updateMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("enabled");
  });
});
