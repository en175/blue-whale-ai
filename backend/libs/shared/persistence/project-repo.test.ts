import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createProjectRepo } from "./project-repo.js";

function mediaNode(assetId: string | number) {
  return {
    id: `media-${assetId}`,
    type: "mediaNode",
    data: { mediaType: "image", assetId },
  };
}

function canvasFindMany(
  rows: { project_id: bigint; nodes_json: unknown }[],
) {
  return vi.fn().mockResolvedValue(rows);
}

describe("ProjectRepo GenerationInbox isolation", () => {
  it("lists only ordinary canvas projects, pinned first then by creation time desc", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([]);
    const assetFindMany = vi.fn();
    const prisma = {
      project: { findMany: projectFindMany },
      user_assets: { findMany: assetFindMany },
    } as unknown as PrismaClient;

    await createProjectRepo(prisma).listByOwner("100");

    expect(projectFindMany).toHaveBeenCalledWith({
      where: {
        owner_id: 100n,
        purpose: "canvas",
        is_delete: 0,
      },
      orderBy: [{ pinned_at: "desc" }, { gmt_create: "desc" }],
    });
    expect(assetFindMany).not.toHaveBeenCalled();
  });

  it("attaches the 3 most recent image previews per project", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([
      { id: 1n, name: "A", thumb: null, gmt_create: new Date("2026-08-25T00:00:00Z") },
      { id: 2n, name: "B", thumb: null, gmt_create: new Date("2026-08-24T00:00:00Z") },
    ]);
    const linkFindMany = vi.fn().mockResolvedValue([]);
    const assetFindMany = vi.fn().mockResolvedValue([
      { id: 11n, project_id: 1n, url: "img1.png" },
      { id: 12n, project_id: 1n, url: "img2.png" },
      { id: 13n, project_id: 1n, url: "img3.png" },
      { id: 14n, project_id: 1n, url: "img4.png" },
      { id: 21n, project_id: 2n, url: "other.png" },
    ]);
    const prisma = {
      project: { findMany: projectFindMany },
      project_asset: { findMany: linkFindMany },
      user_assets: { findMany: assetFindMany },
      project_canvas: {
        findMany: canvasFindMany([
          {
            project_id: 1n,
            nodes_json: [mediaNode(11), mediaNode(12), mediaNode(13), mediaNode(14)],
          },
          { project_id: 2n, nodes_json: [mediaNode(21)] },
        ]),
      },
    } as unknown as PrismaClient;

    const views = await createProjectRepo(prisma).listByOwner("100");

    expect(linkFindMany).toHaveBeenCalledWith({
      where: { user_id: 100n, project_id: { in: [1n, 2n] }, is_delete: 0 },
      select: { project_id: true, asset_id: true },
    });
    expect(assetFindMany).toHaveBeenCalledWith({
      where: {
        user_id: 100n,
        type: "image",
        status: "normal",
        is_delete: false,
        OR: [{ project_id: { in: [1n, 2n] } }],
      },
      orderBy: { gmt_create: "desc" },
      select: { id: true, project_id: true, url: true },
    });
    expect(views[0].previews).toEqual(["img1.png", "img2.png", "img3.png"]);
    expect(views[1].previews).toEqual(["other.png"]);
  });

  it("attaches project_asset-linked images to the listing project, not assets.project_id", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([
      { id: 1n, name: "A", thumb: null, gmt_create: new Date("2026-08-25T00:00:00Z") },
      { id: 2n, name: "B", thumb: null, gmt_create: new Date("2026-08-24T00:00:00Z") },
    ]);
    const linkFindMany = vi.fn().mockResolvedValue([
      { project_id: 2n, asset_id: 99n },
    ]);
    const assetFindMany = vi.fn().mockResolvedValue([
      { id: 99n, project_id: 0n, url: "shared.png" },
      { id: 11n, project_id: 1n, url: "owned.png" },
    ]);
    const prisma = {
      project: { findMany: projectFindMany },
      project_asset: { findMany: linkFindMany },
      user_assets: { findMany: assetFindMany },
      project_canvas: {
        findMany: canvasFindMany([
          { project_id: 1n, nodes_json: [mediaNode(11)] },
          { project_id: 2n, nodes_json: [mediaNode(99)] },
        ]),
      },
    } as unknown as PrismaClient;

    const views = await createProjectRepo(prisma).listByOwner("100");

    expect(assetFindMany).toHaveBeenCalledWith({
      where: {
        user_id: 100n,
        type: "image",
        status: "normal",
        is_delete: false,
        OR: [{ project_id: { in: [1n, 2n] } }, { id: { in: [99n] } }],
      },
      orderBy: { gmt_create: "desc" },
      select: { id: true, project_id: true, url: true },
    });
    expect(views[0].previews).toEqual(["owned.png"]);
    expect(views[1].previews).toEqual(["shared.png"]);
  });

  it("keeps a reused image on both the owning project and the linked project", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([
      { id: 1n, name: "A", thumb: null, gmt_create: new Date("2026-08-25T00:00:00Z") },
      { id: 2n, name: "B", thumb: null, gmt_create: new Date("2026-08-24T00:00:00Z") },
    ]);
    const prisma = {
      project: { findMany: projectFindMany },
      project_asset: { findMany: vi.fn().mockResolvedValue([{ project_id: 2n, asset_id: 11n }]) },
      user_assets: {
        findMany: vi.fn().mockResolvedValue([
          { id: 11n, project_id: 1n, url: "reused.png" },
        ]),
      },
      project_canvas: {
        findMany: canvasFindMany([
          { project_id: 1n, nodes_json: [mediaNode(11)] },
          { project_id: 2n, nodes_json: [mediaNode(11)] },
        ]),
      },
    } as unknown as PrismaClient;

    const views = await createProjectRepo(prisma).listByOwner("100");

    expect(views[0].previews).toEqual(["reused.png"]);
    expect(views[1].previews).toEqual(["reused.png"]);
  });

  it("returns empty previews when the project has no images", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([
      { id: 1n, name: "A", thumb: null, gmt_create: new Date("2026-08-25T00:00:00Z") },
    ]);
    const prisma = {
      project: { findMany: projectFindMany },
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      user_assets: { findMany: vi.fn().mockResolvedValue([]) },
      project_canvas: { findMany: canvasFindMany([{ project_id: 1n, nodes_json: [] }]) },
    } as unknown as PrismaClient;

    const views = await createProjectRepo(prisma).listByOwner("100");

    expect(views[0].previews).toEqual([]);
  });

  it("omits owned images that are not on the canvas", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([
      { id: 1n, name: "A", thumb: null, gmt_create: new Date("2026-08-25T00:00:00Z") },
    ]);
    const prisma = {
      project: { findMany: projectFindMany },
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      user_assets: {
        findMany: vi.fn().mockResolvedValue([
          { id: 11n, project_id: 1n, url: "kept.png" },
          { id: 12n, project_id: 1n, url: "deleted-from-canvas.png" },
        ]),
      },
      project_canvas: {
        findMany: canvasFindMany([{ project_id: 1n, nodes_json: [mediaNode(11)] }]),
      },
    } as unknown as PrismaClient;

    const views = await createProjectRepo(prisma).listByOwner("100");

    expect(views[0].previews).toEqual(["kept.png"]);
  });

  it("returns empty previews when the canvas has no image nodes", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([
      { id: 1n, name: "A", thumb: null, gmt_create: new Date("2026-08-25T00:00:00Z") },
    ]);
    const prisma = {
      project: { findMany: projectFindMany },
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      user_assets: {
        findMany: vi.fn().mockResolvedValue([
          { id: 11n, project_id: 1n, url: "orphan.png" },
        ]),
      },
      project_canvas: {
        findMany: canvasFindMany([{ project_id: 1n, nodes_json: [] }]),
      },
    } as unknown as PrismaClient;

    const views = await createProjectRepo(prisma).listByOwner("100");

    expect(views[0].previews).toEqual([]);
  });

  it("counts product-card images that are still on the canvas", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([
      { id: 1n, name: "A", thumb: null, gmt_create: new Date("2026-08-25T00:00:00Z") },
    ]);
    const prisma = {
      project: { findMany: projectFindMany },
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      user_assets: {
        findMany: vi.fn().mockResolvedValue([
          { id: 11n, project_id: 1n, url: "product.png" },
        ]),
      },
      project_canvas: {
        findMany: canvasFindMany([
          {
            project_id: 1n,
            nodes_json: [
              {
                id: "product-1",
                type: "productNode",
                data: {
                  images: [
                    { id: "i1", src: "product.png", enabled: true, type: "image", assetId: "11" },
                  ],
                },
              },
            ],
          },
        ]),
      },
    } as unknown as PrismaClient;

    const views = await createProjectRepo(prisma).listByOwner("100");

    expect(views[0].previews).toEqual(["product.png"]);
  });

  it("does not show a reused image on a project whose canvas no longer has it", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([
      { id: 1n, name: "A", thumb: null, gmt_create: new Date("2026-08-25T00:00:00Z") },
      { id: 2n, name: "B", thumb: null, gmt_create: new Date("2026-08-24T00:00:00Z") },
    ]);
    const prisma = {
      project: { findMany: projectFindMany },
      project_asset: { findMany: vi.fn().mockResolvedValue([{ project_id: 2n, asset_id: 11n }]) },
      user_assets: {
        findMany: vi.fn().mockResolvedValue([
          { id: 11n, project_id: 1n, url: "reused.png" },
        ]),
      },
      project_canvas: {
        findMany: canvasFindMany([
          { project_id: 1n, nodes_json: [mediaNode(11)] },
          { project_id: 2n, nodes_json: [] },
        ]),
      },
    } as unknown as PrismaClient;

    const views = await createProjectRepo(prisma).listByOwner("100");

    expect(views[0].previews).toEqual(["reused.png"]);
    expect(views[1].previews).toEqual([]);
  });

  it("pages canvas projects with skip/take and returns the assets-shaped envelope", async () => {
    const projectCount = vi.fn().mockResolvedValue(5);
    const projectFindMany = vi.fn().mockResolvedValue([
      {
        id: 3n,
        name: "C",
        thumb: null,
        gmt_create: new Date("2026-08-23T00:00:00Z"),
        last_opened_at: new Date("2026-08-23T10:00:00Z"),
        pinned_at: null,
      },
    ]);
    const assetFindMany = vi.fn().mockResolvedValue([
      { id: 31n, project_id: 3n, url: "c1.png" },
    ]);
    const prisma = {
      project: { count: projectCount, findMany: projectFindMany },
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      user_assets: { findMany: assetFindMany },
      project_canvas: { findMany: canvasFindMany([{ project_id: 3n, nodes_json: [mediaNode(31)] }]) },
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
      orderBy: [{ pinned_at: "desc" }, { gmt_create: "desc" }, { id: "desc" }],
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
          created_at: "2026-08-23T08:00:00+08:00",
          last_opened_at: "2026-08-23T18:00:00+08:00",
          pinned_at: null,
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
      user_assets: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    const page = await createProjectRepo(prisma).listByOwnerPaged("100", 3, 10);

    expect(page).toEqual({ records: [], total: 1, size: 10, current: 3 });
    expect(prisma.user_assets.findMany).not.toHaveBeenCalled();
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
      user_assets: { updateMany: assetsUpdateMany },
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
      user_assets: { updateMany: assetsUpdateMany },
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
      user_assets: { updateMany: assetsUpdateMany },
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
      user_assets: { updateMany: assetsUpdateMany },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;

    const result = await createProjectRepo(prisma).batchDelete("100", ["1", "2"]);

    expect(result).toEqual({ succeeded: [], failed: ["1", "2"] });
    expect(assetsUpdateMany).not.toHaveBeenCalled();
    expect(projectUpdateMany).not.toHaveBeenCalled();
  });
});

describe("ProjectRepo last_opened_at / pinned_at (IKH1YI)", () => {
  it("touches last_opened_at with only that column in data (gmt_modified/version untouched)", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      project: { updateMany },
    } as unknown as PrismaClient;

    const touched = await createProjectRepo(prisma).touchLastOpened("42", "100");

    expect(touched).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 42n,
        owner_id: 100n,
        purpose: "canvas",
        is_delete: 0,
      },
      data: { last_opened_at: expect.any(Date) },
    });
  });

  it("returns false when touching a project not owned by the caller", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      project: { updateMany },
    } as unknown as PrismaClient;

    const touched = await createProjectRepo(prisma).touchLastOpened("42", "100");

    expect(touched).toBe(false);
  });

  it("pins by writing only pinned_at=now and reads back the projection", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue({
      id: 42n,
      name: "A",
      thumb: null,
      gmt_create: new Date("2026-08-25T00:00:00Z"),
      last_opened_at: null,
      pinned_at: new Date("2026-09-19T10:00:00Z"),
    });
    const prisma = {
      project: { updateMany, findFirst },
    } as unknown as PrismaClient;

    const view = await createProjectRepo(prisma).setPinned("42", "100", true);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 42n,
        owner_id: 100n,
        purpose: "canvas",
        is_delete: 0,
      },
      data: { pinned_at: expect.any(Date) },
    });
    expect(view).toEqual({
      id: "42",
      name: "A",
      thumb: null,
      previews: [],
      created_at: "2026-08-25T08:00:00+08:00",
      last_opened_at: null,
      pinned_at: "2026-09-19T18:00:00+08:00",
    });
  });

  it("unpins by writing only pinned_at=null", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn().mockResolvedValue({
      id: 42n,
      name: "A",
      thumb: null,
      gmt_create: new Date("2026-08-25T00:00:00Z"),
      last_opened_at: null,
      pinned_at: null,
    });
    const prisma = {
      project: { updateMany, findFirst },
    } as unknown as PrismaClient;

    const view = await createProjectRepo(prisma).setPinned("42", "100", false);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 42n,
        owner_id: 100n,
        purpose: "canvas",
        is_delete: 0,
      },
      data: { pinned_at: null },
    });
    expect(view?.pinned_at).toBeNull();
  });

  it("returns null without reading back when pinning a project not owned by the caller", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findFirst = vi.fn();
    const prisma = {
      project: { updateMany, findFirst },
    } as unknown as PrismaClient;

    await expect(
      createProjectRepo(prisma).setPinned("42", "100", true),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("projects last_opened_at/pinned_at as ISO or null in listByOwner views", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([
      {
        id: 1n,
        name: "A",
        thumb: null,
        gmt_create: new Date("2026-08-25T00:00:00Z"),
        last_opened_at: new Date("2026-09-01T08:30:00Z"),
        pinned_at: null,
      },
      {
        id: 2n,
        name: "B",
        thumb: null,
        gmt_create: new Date("2026-08-24T00:00:00Z"),
        last_opened_at: null,
        pinned_at: new Date("2026-09-02T09:00:00Z"),
      },
    ]);
    const prisma = {
      project: { findMany: projectFindMany },
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      user_assets: { findMany: vi.fn().mockResolvedValue([]) },
      project_canvas: { findMany: canvasFindMany([]) },
    } as unknown as PrismaClient;

    const views = await createProjectRepo(prisma).listByOwner("100");

    expect(views[0]).toMatchObject({
      last_opened_at: "2026-09-01T16:30:00+08:00",
      pinned_at: null,
    });
    expect(views[1]).toMatchObject({
      last_opened_at: null,
      pinned_at: "2026-09-02T17:00:00+08:00",
    });
  });
});
