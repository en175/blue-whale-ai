import { describe, expect, it, vi } from "vitest";

import { createMaterialGroupRepo } from "./material-group-repo.js";

describe("MaterialGroupRepo", () => {
  const row = {
    id: 1n,
    user_id: 9n,
    material_group_id: "group-virt-1",
    kind: "virtual",
    name: "默认分组：9",
    cover_url: null,
    is_default: true,
    gmt_create: new Date("2026-09-11T02:32:22Z"),
    gmt_modified: new Date("2026-09-11T02:40:00Z"),
  };

  it("upsert 创建虚拟默认组：按 (user_id, material_group_id) 复合唯一落表", async () => {
    const upsert = vi.fn().mockResolvedValue(row);
    const repo = createMaterialGroupRepo({ user_material_groups: { upsert } } as never);

    const view = await repo.upsert({
      userId: "9",
      materialGroupId: "group-virt-1",
      kind: "virtual",
      name: "默认分组：9",
      isDefault: true,
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id_material_group_id: { user_id: 9n, material_group_id: "group-virt-1" },
        },
        create: expect.objectContaining({
          user_id: 9n,
          material_group_id: "group-virt-1",
          kind: "virtual",
          name: "默认分组：9",
          is_default: true,
        }),
      }),
    );
    expect(view).toEqual({
      id: "1",
      userId: "9",
      materialGroupId: "group-virt-1",
      kind: "virtual",
      name: "默认分组：9",
      coverUrl: null,
      isDefault: true,
      createdAt: new Date("2026-09-11T02:32:22Z"),
      updatedAt: new Date("2026-09-11T02:40:00Z"),
    });
  });

  it("findVirtualDefault：按 user_id + kind=virtual + is_default=true + 未删查", async () => {
    const findFirst = vi.fn().mockResolvedValue(row);
    const repo = createMaterialGroupRepo({ user_material_groups: { findFirst } } as never);

    const view = await repo.findVirtualDefault("9");

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id: 9n,
          kind: "virtual",
          is_default: true,
          is_delete: false,
        },
      }),
    );
    expect(view?.materialGroupId).toBe("group-virt-1");
  });

  it("findVirtualDefault 无组：返回 null", async () => {
    const repo = createMaterialGroupRepo({
      user_material_groups: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never);

    expect(await repo.findVirtualDefault("9")).toBeNull();
  });

  it("listByUser：按 user_id + 未删 + 可选 kind 过滤", async () => {
    const findMany = vi.fn().mockResolvedValue([row]);
    const repo = createMaterialGroupRepo({ user_material_groups: { findMany } } as never);

    const views = await repo.listByUser("9", "virtual");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 9n, is_delete: false, kind: "virtual" },
      }),
    );
    expect(views).toHaveLength(1);
    expect(views[0].kind).toBe("virtual");
  });

  it("pageByUser：count + 分页查询（gmt_create desc, id desc），供组查询分流（IKEXX8）", async () => {
    const count = vi.fn().mockResolvedValue(3);
    const findMany = vi.fn().mockResolvedValue([row]);
    const repo = createMaterialGroupRepo({
      user_material_groups: { count, findMany },
    } as never);

    const { total, rows } = await repo.pageByUser("9", "virtual", 2, 10);

    expect(count).toHaveBeenCalledWith({
      where: { user_id: 9n, kind: "virtual", is_delete: false },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { user_id: 9n, kind: "virtual", is_delete: false },
      orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
      skip: 10,
      take: 10,
    });
    expect(total).toBe(3);
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toEqual(new Date("2026-09-11T02:32:22Z"));
  });

  it("softDelete：按 (user_id, material_group_id) 软删，置 is_delete + deleted_at", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createMaterialGroupRepo({ user_material_groups: { updateMany } } as never);

    await repo.softDelete("9", "group-virt-1");

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id: 9n,
          material_group_id: "group-virt-1",
          is_delete: false,
        },
        data: expect.objectContaining({
          is_delete: true,
          deleted_at: expect.any(Date),
        }),
      }),
    );
  });
});
