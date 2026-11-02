import { describe, expect, it, vi } from "vitest";

import { AgentTemplatesController } from "./templates.controller.js";

function build(listAllTags: ReturnType<typeof vi.fn>) {
  const pageCards = vi.fn().mockResolvedValue({
    records: [],
    total: 0,
    current: 1,
    size: 10,
    pages: 0,
  });
  const controller = new AgentTemplatesController({
    listAllTags,
    pageCards,
  } as never);
  return { controller, pageCards };
}

describe("公开模板列表查询（IKRE7X）", () => {
  it("不传标签与精选时返回全部", async () => {
    const { controller, pageCards } = build(vi.fn().mockResolvedValue([]));

    await controller.page({});

    expect(pageCards).toHaveBeenCalledWith({ current: 1, size: 10 });
  });

  it("数据库里的场景标签通过校验并带入查询", async () => {
    const { controller, pageCards } = build(
      vi.fn().mockResolvedValue([{ tag_code: "goods", label: "商品展示", visible: 1 }]),
    );

    await controller.page({ tagCode: "goods", isFeatured: "1", page: "2", size: "6" });

    expect(pageCards).toHaveBeenCalledWith({
      tagCode: "goods",
      isFeatured: true,
      current: 2,
      size: 6,
    });
  });

  it("数据库读取失败时回退静态枚举放行已知标签", async () => {
    const { controller, pageCards } = build(vi.fn().mockRejectedValue(new Error("db down")));

    await controller.page({ tagCode: "video" });

    expect(pageCards).toHaveBeenCalledWith({ tagCode: "video", current: 1, size: 10 });
  });

  it("未知标签或库中不存在时拒绝", async () => {
    const unknown = build(vi.fn().mockResolvedValue([]));
    await expect(unknown.controller.page({ tagCode: "nope" })).rejects.toThrow(/非法标签/);

    const stale = build(
      vi.fn().mockResolvedValue([{ tag_code: "goods", label: "商品展示", visible: 1 }]),
    );
    await expect(stale.controller.page({ tagCode: "picture" })).rejects.toThrow(/非法标签/);
  });
});
