import { describe, expect, it, vi } from "vitest";

import { AssetsController } from "./assets.controller.js";

// IKCZAT：GET /api/assets/:assetId/references 引用计数端点单测。
// 归属校验（findOwnedById 命中才计）→ 100301；归属通过 → 转发 countReferencingProjects 返回计数。

function createController(overrides: {
  findOwnedById?: ReturnType<typeof vi.fn>;
  countReferencingProjects?: ReturnType<typeof vi.fn>;
} = {}) {
  const assets = {
    findOwnedById:
      overrides.findOwnedById ?? vi.fn().mockResolvedValue({ id: "42" }),
    countReferencingProjects:
      overrides.countReferencingProjects ?? vi.fn().mockResolvedValue(3),
  };
  const controller = new AssetsController(assets as never);
  return { controller, assets };
}

const USER = { userId: "9", username: "alice" } as never;

describe("AssetsController.getReferences（IKCZAT）", () => {
  it("素材存在且归属 → 返回 { assetId, projectCount }", async () => {
    const { controller, assets } = createController();
    const result = await controller.getReferences(USER, "42");
    expect(result).toMatchObject({
      code: 200,
      data: { assetId: "42", projectCount: 3 },
    });
    expect(assets.findOwnedById).toHaveBeenCalledWith("42", "9");
    expect(assets.countReferencingProjects).toHaveBeenCalledWith("42", "9");
  });

  it("素材不存在/不归属 → 100301，不调计数", async () => {
    const { controller, assets } = createController({
      findOwnedById: vi.fn().mockResolvedValue(null),
    });
    const result = await controller.getReferences(USER, "999");
    expect(result).toMatchObject({ code: 100301 });
    expect(assets.countReferencingProjects).not.toHaveBeenCalled();
  });
});
