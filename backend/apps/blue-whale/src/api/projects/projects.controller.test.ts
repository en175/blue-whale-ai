import { describe, expect, it, vi } from "vitest";

import { ProjectsController } from "./projects.controller.js";

function build(
  create = vi.fn().mockResolvedValue({ id: "1", name: "A" }),
  acquire = vi.fn().mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) }),
) {
  const controller = new ProjectsController(
    { create } as never,
    {} as never,
    {} as never,
    { acquire } as never,
  );
  return { controller, create, acquire };
}

const USER = { userId: "9" } as never;

describe("POST /api/projects source（IKRGON）", () => {
  it("透传 dialog 来源", async () => {
    const { controller, create } = build();

    const result = await controller.create(USER, { name: "A", source: "dialog" });

    expect(create).toHaveBeenCalledWith("9", "A", "dialog");
    expect(result.code).toBe(200);
  });

  it("未传来源时不指定，交给仓储默认 canvas", async () => {
    const { controller, create } = build();

    await controller.create(USER, { name: "A" });

    expect(create).toHaveBeenCalledWith("9", "A", undefined);
  });

  it("来源非法返回 400 且不落库", async () => {
    const { controller, create } = build();

    const result = await controller.create(USER, { name: "A", source: "other" });

    expect(result.code).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects 用户维度创建锁（IKST3D）", () => {
  it("未拿到锁时不落库并返回可重试提示", async () => {
    const { controller, create, acquire } = build(
      vi.fn(),
      vi.fn().mockResolvedValue(null),
    );

    const result = await controller.create(USER, { name: "A" });

    expect(result.code).toBe(400);
    expect(result.msg).toContain("处理中");
    expect(acquire).toHaveBeenCalledWith("9");
    expect(create).not.toHaveBeenCalled();
  });

  it("创建成功后释放锁", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const { controller } = build(
      vi.fn().mockResolvedValue({ id: "1", name: "A" }),
      vi.fn().mockResolvedValue({ release }),
    );

    await controller.create(USER, { name: "A" });

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("创建失败也释放锁", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const { controller } = build(
      vi.fn().mockRejectedValue(new Error("db down")),
      vi.fn().mockResolvedValue({ release }),
    );

    await expect(controller.create(USER, { name: "A" })).rejects.toThrow("db down");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
