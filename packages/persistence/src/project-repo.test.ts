import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createProjectRepo } from "./project-repo.js";

describe("ProjectRepo GenerationInbox isolation", () => {
  it("lists only ordinary canvas projects, ordered by creation time desc", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([]);
    const assetFindMany = vi.fn();
    const prisma = {
      project: { findMany: projectFindMany },
      assets: { findMany: assetFindMany },
    } as unknown as PrismaClient;

    await createProjectRepo(prisma).listByOwner("100");

    expect(projectFindMany).toHaveBeenCalledWith({
      where: {
        owner_id: 100n,
        purpose: "canvas",
        is_delete: 0,
      },
      orderBy: { gmt_create: "desc" },
    });
    // 无项目时不发资产查询
    expect(assetFindMany).not.toHaveBeenCalled();
  });

  it("attaches the 3 most recent image previews per project", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([
      { id: 1n, name: "A", thumb: null, gmt_create: new Date("2026-08-25T00:00:00Z") },
      { id: 2n, name: "B", thumb: null, gmt_create: new Date("2026-08-24T00:00:00Z") },
    ]);
    // 模拟 assets 按 gmt_create 倒序返回
    const assetFindMany = vi.fn().mockResolvedValue([
      { project_id: 1n, url: "img1.png" },
      { project_id: 1n, url: "img2.png" },
      { project_id: 1n, url: "img3.png" },
      { project_id: 1n, url: "img4.png" }, // 第 4 张，应被截断
      { project_id: 2n, url: "other.png" },
    ]);
    const prisma = {
      project: { findMany: projectFindMany },
      assets: { findMany: assetFindMany },
    } as unknown as PrismaClient;

    const views = await createProjectRepo(prisma).listByOwner("100");

    expect(assetFindMany).toHaveBeenCalledWith({
      where: {
        project_id: { in: [1n, 2n] },
        type: "image",
        is_delete: false,
      },
      orderBy: { gmt_create: "desc" },
      select: { project_id: true, url: true },
    });
    expect(views[0].previews).toEqual(["img1.png", "img2.png", "img3.png"]);
    expect(views[1].previews).toEqual(["other.png"]);
  });

  it("returns empty previews when the project has no images", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([
      { id: 1n, name: "A", thumb: null, gmt_create: new Date("2026-08-25T00:00:00Z") },
    ]);
    const assetFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      project: { findMany: projectFindMany },
      assets: { findMany: assetFindMany },
    } as unknown as PrismaClient;

    const views = await createProjectRepo(prisma).listByOwner("100");

    expect(views[0].previews).toEqual([]);
  });

  it("pages canvas projects with skip/take and returns the assets-shaped envelope", async () => {
    const projectCount = vi.fn().mockResolvedValue(5);
    const projectFindMany = vi.fn().mockResolvedValue([
      { id: 3n, name: "C", thumb: null, gmt_create: new Date("2026-08-23T00:00:00Z") },
    ]);
    const assetFindMany = vi.fn().mockResolvedValue([
      { project_id: 3n, url: "c1.png" },
    ]);
    const prisma = {
      project: { count: projectCount, findMany: projectFindMany },
      assets: { findMany: assetFindMany },
    } as unknown as PrismaClient;

    const page = await createProjectRepo(prisma).listByOwnerPaged("100", 2, 2);

    expect(projectCount).toHaveBeenCalledWith({
      where: {
        owner_id: 100n,
        purpose: "canvas",
        is_delete: 0,
      },
    });
    expect(projectFindMany).toHaveBeenCalledWith({
      where: {
        owner_id: 100n,
        purpose: "canvas",
        is_delete: 0,
      },
      orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
      skip: 2,
      take: 2,
    });
    expect(page).toEqual({
      records: [
        {
          id: "3",
          name: "C",
          thumb: null,
          previews: ["c1.png"],
          created_at: "2026-08-23T00:00:00.000Z",
        },
      ],
      total: 5,
      size: 2,
      current: 2,
    });
  });

  it("returns empty records when the page is past the last item", async () => {
    const prisma = {
      project: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
      },
      assets: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    const page = await createProjectRepo(prisma).listByOwnerPaged("100", 3, 10);

    expect(page).toEqual({ records: [], total: 1, size: 10, current: 3 });
    expect(prisma.assets.findMany).not.toHaveBeenCalled();
  });

  it("checks owner and canvas purpose in the update predicate before renaming", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findFirst = vi.fn();
    const prisma = {
      project: { findMany, updateMany, findFirst },
    } as unknown as PrismaClient;

    await expect(
      createProjectRepo(prisma).rename("42", "100", "新名称"),
    ).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 42n,
        owner_id: 100n,
        purpose: "canvas",
        is_delete: 0,
      },
      data: { name: "新名称" },
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("appends a sequence number when renaming collides with another project", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 2n, name: "新名称" }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue({
      id: 42n,
      name: "新名称 (2)",
      thumb: null,
      gmt_create: new Date("2026-08-25T00:00:00Z"),
    });
    const prisma = {
      project: { findMany, updateMany, findFirst },
    } as unknown as PrismaClient;

    await createProjectRepo(prisma).rename("42", "100", "新名称");

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 42n, owner_id: 100n, purpose: "canvas", is_delete: 0 },
      data: { name: "新名称 (2)" },
    });
  });

  it("does not dedupe against its own current name when renaming", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 42n, name: "旧名称" }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue({
      id: 42n,
      name: "旧名称",
      thumb: null,
      gmt_create: new Date("2026-08-25T00:00:00Z"),
    });
    const prisma = {
      project: { findMany, updateMany, findFirst },
    } as unknown as PrismaClient;

    await createProjectRepo(prisma).rename("42", "100", "旧名称");

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "旧名称" } }),
    );
  });

  it("uses a default name (current date-time) when the create name is empty", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockResolvedValue({
      id: 1n,
      name: "",
      thumb: null,
      gmt_create: new Date("2026-08-25T00:00:00Z"),
    });
    const prisma = {
      project: { findMany, create },
    } as unknown as PrismaClient;

    await createProjectRepo(prisma).create("100", "   ");

    const data = create.mock.calls[0][0].data;
    expect(data.name).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("appends a sequence number when creating collides with an existing name", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 9n, name: "设计稿" }]);
    const create = vi.fn().mockResolvedValue({
      id: 1n,
      name: "设计稿 (2)",
      thumb: null,
      gmt_create: new Date("2026-08-25T00:00:00Z"),
    });
    const prisma = {
      project: { findMany, create },
    } as unknown as PrismaClient;

    await createProjectRepo(prisma).create("100", "设计稿");

    expect(create.mock.calls[0][0].data.name).toBe("设计稿 (2)");
  });

  it("cascade-deletes the project's assets when deleting a project", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 42n });
    const assetsUpdateMany = vi.fn().mockResolvedValue({ count: 3 });
    const projectUpdate = vi.fn().mockResolvedValue({});
    const tx = vi.fn(async (ops: Promise<unknown>[]) => {
      await Promise.all(ops);
    });
    const prisma = {
      project: { findFirst, update: projectUpdate },
      assets: { updateMany: assetsUpdateMany },
      $transaction: tx,
    } as unknown as PrismaClient;

    const result = await createProjectRepo(prisma).delete("42", "100");

    expect(result).toBe(true);
    expect(assetsUpdateMany).toHaveBeenCalledWith({
      where: { project_id: 42n, is_delete: false },
      data: { is_delete: true, deleted_at: expect.any(Date) },
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: 42n },
      data: { is_delete: 1 },
    });
  });

  it("does not delete when the project is not owned by the caller", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const assetsUpdateMany = vi.fn();
    const projectUpdate = vi.fn();
    const prisma = {
      project: { findFirst, update: projectUpdate },
      assets: { updateMany: assetsUpdateMany },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const result = await createProjectRepo(prisma).delete("42", "100");

    expect(result).toBe(false);
    expect(assetsUpdateMany).not.toHaveBeenCalled();
    expect(projectUpdate).not.toHaveBeenCalled();
  });

  it("batch-deletes owned projects with assets and reports failures", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 1n }, { id: 2n }]);
    const assetsUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const projectUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = vi.fn(async (ops: Promise<unknown>[]) => {
      await Promise.all(ops);
    });
    const prisma = {
      project: { findMany, updateMany: projectUpdateMany },
      assets: { updateMany: assetsUpdateMany },
      $transaction: tx,
    } as unknown as PrismaClient;

    const result = await createProjectRepo(prisma).batchDelete("100", [
      "1",
      "2",
      "99",
    ]);

    expect(result).toEqual({ succeeded: ["1", "2"], failed: ["99"] });
    expect(assetsUpdateMany).toHaveBeenCalledWith({
      where: { project_id: { in: [1n, 2n] }, is_delete: false },
      data: { is_delete: true, deleted_at: expect.any(Date) },
    });
    expect(projectUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [1n, 2n] } },
      data: { is_delete: 1 },
    });
  });

  it("batch-deletes nothing and reports all ids as failed when none are owned", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const assetsUpdateMany = vi.fn();
    const projectUpdateMany = vi.fn();
    const prisma = {
      project: { findMany, updateMany: projectUpdateMany },
      assets: { updateMany: assetsUpdateMany },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const result = await createProjectRepo(prisma).batchDelete("100", ["1", "2"]);

    expect(result).toEqual({ succeeded: [], failed: ["1", "2"] });
    expect(assetsUpdateMany).not.toHaveBeenCalled();
    expect(projectUpdateMany).not.toHaveBeenCalled();
  });
});
