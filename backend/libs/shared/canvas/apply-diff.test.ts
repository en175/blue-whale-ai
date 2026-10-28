import { describe, expect, it } from "vitest";

import {
  edgeRowFromInput,
  edgeWriteOrNull,
  nodeRowFromInput,
  nodeWriteOrNull,
  stableJson,
  type CanvasEdgeRow,
  type CanvasNodeRow,
} from "./apply-diff.js";

const row = (overrides: Partial<CanvasNodeRow> = {}): CanvasNodeRow => ({
  node_id: "n1",
  type: "textNode",
  name: "标题",
  source: "user",
  pos_x: 10,
  pos_y: 20,
  data_json: { text: "甲", title: "标题" },
  ...overrides,
});

describe("画布 apply 差异", () => {
  it("内容等价时跳过，不产生写行", () => {
    expect(nodeWriteOrNull(row(), { id: "n1", type: "textNode", position: { x: 10, y: 20 }, data: { title: "标题", text: "甲" } })).toBeNull();
  });

  it("位置变化只记录位置字段", () => {
    const write = nodeWriteOrNull(row(), { id: "n1", type: "textNode", position: { x: 11, y: 20 }, data: { text: "甲", title: "标题" } });
    expect(write).not.toBeNull();
    expect(Object.keys(write!.changes)).toEqual(["pos_x"]);
    expect(write!.changes.pos_x).toEqual({ from: 10, to: 11 });
  });

  it("正文变化记录 data 的旧值与新值", () => {
    const write = nodeWriteOrNull(row(), { id: "n1", type: "textNode", position: { x: 10, y: 20 }, data: { text: "乙", title: "标题" } });
    expect(write!.changes.data).toEqual({
      from: { text: "甲", title: "标题" },
      to: { text: "乙", title: "标题" },
    });
  });

  it("非整数坐标按四舍五入落库", () => {
    const input = { id: "n2", type: "textNode", position: { x: 1.6, y: -2.4 }, data: {} };
    expect(nodeRowFromInput(input).pos_x).toBe(2);
    expect(nodeRowFromInput(input).pos_y).toBe(-2);
  });

  it("边的引用角色变化被识别", () => {
    const base: CanvasEdgeRow = {
      edge_id: "e1",
      source_node_id: "a",
      target_node_id: "b",
      ref_role: null,
      data_json: {},
    };
    expect(edgeWriteOrNull(base, { id: "e1", source: "a", target: "b" })).toBeNull();
    const write = edgeWriteOrNull(base, { id: "e1", source: "a", target: "b", ref_role: "first" });
    expect(write!.changes.ref_role).toEqual({ from: null, to: "first" });
  });

  it("边载荷剔除标识列后仅保留扩展字段", () => {
    expect(edgeRowFromInput({ id: "e1", source: "a", target: "b", refRole: "last", extra: 1 })).toEqual({
      edge_id: "e1",
      source_node_id: "a",
      target_node_id: "b",
      ref_role: "last",
      data_json: { extra: 1 },
    });
  });

  it("稳定序列化忽略对象键顺序", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
