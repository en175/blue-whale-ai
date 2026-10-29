import { describe, expect, it, vi } from "vitest";

import { ProjectsController } from "./projects.controller.js";

function build(create = vi.fn().mockResolvedValue({ id: "1", name: "A" })) {
  const controller = new ProjectsController(
    { create } as never,
    {} as never,
    {} as never,
  );
  return { controller, create };
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
