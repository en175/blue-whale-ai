import { describe, it, expect } from "vitest";
import { filterPersistableNodes } from "./persist";
import type { NodeItem } from "./types";

function node(id: string, status?: "loading" | "ready" | "error"): NodeItem {
  return { id, type: "image", position: { x: 0, y: 0 }, width: 200, height: 200, status };
}

describe("filterPersistableNodes (D5)", () => {
  it("保留 ready + 无 status（兼容旧数据）", () => {
    const r = filterPersistableNodes([node("a", "ready"), node("b"), node("c", "ready")]);
    expect(r.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("过滤 loading（占位不持久化，刷新靠恢复重建）", () => {
    const r = filterPersistableNodes([node("a", "ready"), node("b", "loading"), node("c", "ready")]);
    expect(r.map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("过滤 error（失败节点无意义不持久化）", () => {
    const r = filterPersistableNodes([node("a", "error"), node("b", "ready"), node("c", "error")]);
    expect(r.map((n) => n.id)).toEqual(["b"]);
  });

  it("全 loading → 空数组（生成中刷新，节点全靠恢复重建）", () => {
    const r = filterPersistableNodes([node("a", "loading"), node("b", "loading")]);
    expect(r).toEqual([]);
  });

  it("空数组 → 空数组", () => {
    expect(filterPersistableNodes([])).toEqual([]);
  });

  it("不修改原数组（不可变）", () => {
    const input = [node("a", "ready"), node("b", "loading")];
    const snapshot = [...input];
    filterPersistableNodes(input);
    expect(input).toEqual(snapshot);
  });
});
