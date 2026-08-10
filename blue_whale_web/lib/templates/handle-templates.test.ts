import { describe, expect, it, vi } from "vitest";

import { handleListTags, handlePageTemplates } from "./handle-templates.js";

// /api/agent/templates tags + page。tags 读 DB（IK764F，DB 异常兜底硬编码）；page 走 repo。

const DB_TAGS = [
  { tag_code: "marketing", label: "营销新名" },
  { tag_code: "short", label: "微短片" },
];

describe("handleListTags", () => {
  it("DB 有数据 → 返回 DB 标签", async () => {
    const result = await handleListTags({
      templates: { listTags: vi.fn().mockResolvedValue(DB_TAGS) },
    });
    expect(result.code).toBe(200);
    expect(result.data).toEqual(DB_TAGS);
  });

  it("DB 报错 → 兜底 5 个硬编码枚举（按 sort_order 升序）", async () => {
    const result = await handleListTags({
      templates: { listTags: vi.fn().mockRejectedValue(new Error("db down")) },
    });
    expect(result.code).toBe(200);
    expect(result.data).toEqual([
      { tag_code: "marketing", label: "营销视频" },
      { tag_code: "short", label: "微短片" },
      { tag_code: "replicate", label: "视频复刻" },
      { tag_code: "social", label: "社媒视频" },
      { tag_code: "image", label: "图片设计" },
    ]);
  });

  it("DB 返回空表 → 同样兜底硬编码", async () => {
    const result = await handleListTags({
      templates: { listTags: vi.fn().mockResolvedValue([]) },
    });
    expect(result.code).toBe(200);
    expect((result.data as unknown[]).length).toBe(5);
  });
});

describe("handlePageTemplates", () => {
  const card = {
    title: "T1",
    video: null,
    images: ["https://x/1.png"],
    layout: "wide",
  };

  it("合法 tagCode → 200 + PageVo", async () => {
    const repo = {
      pageByTagCode: vi.fn().mockResolvedValue({
        records: [card],
        total: 1,
        current: 1,
        size: 10,
        pages: 1,
      }),
    };
    const result = await handlePageTemplates("marketing", 1, 10, {
      templates: repo,
    });
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: { records: [card], total: 1, current: 1, size: 10, pages: 1 },
    });
    expect(repo.pageByTagCode).toHaveBeenCalledWith("marketing", 1, 10);
  });

  it("非法 tagCode → 400，不查库", async () => {
    const repo = { pageByTagCode: vi.fn() };
    const result = await handlePageTemplates("bogus", 1, 10, {
      templates: repo,
    });
    expect(result.code).toBe(400);
    expect(result.msg).toContain("非法标签");
    expect(repo.pageByTagCode).not.toHaveBeenCalled();
  });
});
