import { describe, expect, it, vi } from "vitest";

import { AdminTemplateTagsController } from "./template-tags.controller.js";

function build(createTag = vi.fn().mockResolvedValue(true)) {
  const controller = new AdminTemplateTagsController(
    {
      listAllTags: vi.fn().mockResolvedValue([]),
      listTags: vi.fn().mockResolvedValue([]),
    } as never,
    {
      createTag,
      renameTag: vi.fn(),
      setTagVisibility: vi.fn(),
    } as never,
    { logTagRename: vi.fn(), logTagVisibility: vi.fn() } as never,
  );
  return { controller, createTag };
}

describe("管理端新建模板标签（IKRE7X）", () => {
  it("合法参数写入并返回 tag_code", async () => {
    const { controller, createTag } = build();

    await expect(
      controller.create({ tag_code: "goods", label: "商品展示", sort_order: 3 }),
    ).resolves.toEqual({ success: true, data: { tag_code: "goods" } });
    expect(createTag).toHaveBeenCalledWith("goods", "商品展示", 3);
  });

  it("编码格式非法直接 400，不落库", async () => {
    const { controller, createTag } = build();

    await expect(
      controller.create({ tag_code: "Goods Tag", label: "商品展示" }),
    ).rejects.toThrow(/tag_code/);
    expect(createTag).not.toHaveBeenCalled();
  });

  it("名称为空或排序为负直接 400", async () => {
    const { controller } = build();

    await expect(
      controller.create({ tag_code: "goods", label: "  " }),
    ).rejects.toThrow(/标签名称/);
    await expect(
      controller.create({ tag_code: "goods", label: "商品展示", sort_order: -1 }),
    ).rejects.toThrow(/sort_order/);
  });

  it("编码重复返回 409", async () => {
    const { controller } = build(vi.fn().mockResolvedValue(false));

    await expect(
      controller.create({ tag_code: "goods", label: "商品展示" }),
    ).rejects.toThrow(/已存在/);
  });
});
