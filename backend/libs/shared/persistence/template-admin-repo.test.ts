import { describe, expect, it } from "vitest";

import { swapSequence } from "./template-admin-repo";

describe("swapSequence（模板/图片调序核心）", () => {
  const items = ["a", "b", "c", "d"];

  it("上移：与上一位交换", () => {
    expect(swapSequence(items, 2, "up")).toEqual(["a", "c", "b", "d"]);
  });

  it("下移：与下一位交换", () => {
    expect(swapSequence(items, 1, "down")).toEqual(["a", "c", "b", "d"]);
  });

  it("不修改原数组", () => {
    swapSequence(items, 0, "down");
    expect(items).toEqual(["a", "b", "c", "d"]);
  });

  it("边界：首位上移 / 末位下移 / 未找到（-1）→ null", () => {
    expect(swapSequence(items, 0, "up")).toBeNull();
    expect(swapSequence(items, 3, "down")).toBeNull();
    expect(swapSequence(items, -1, "up")).toBeNull();
  });

  it("空列表 / 单元素 → null", () => {
    expect(swapSequence([], 0, "up")).toBeNull();
    expect(swapSequence(["a"], 0, "down")).toBeNull();
  });
});
