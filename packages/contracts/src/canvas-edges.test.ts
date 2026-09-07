import { describe, expect, it } from "vitest";
import { canvasEdgeSchema } from "./canvas-edges.js";

/* IKDMQS：连线持久形状扩展——可选 data 承载连线关系属性（视频参考角色 refRole），
   原样存取不解释；其余字段仍 strict 校验。 */

describe("canvasEdgeSchema（IKDMQS 可选 data）", () => {
  it("三字段持久形状照常通过", () => {
    expect(canvasEdgeSchema.safeParse({ id: "e1", source: "a", target: "b" }).success).toBe(true);
  });

  it("携带 data（含 refRole 角色属性）通过并保留", () => {
    const parsed = canvasEdgeSchema.safeParse({ id: "e1", source: "a", target: "b", data: { refRole: "first" } });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.data).toEqual({ refRole: "first" });
  });

  it("data 为任意记录形状通过（不解释内容）", () => {
    expect(canvasEdgeSchema.safeParse({ id: "e1", source: "a", target: "b", data: {} }).success).toBe(true);
  });

  it("strict 语义保留：未知顶层字段仍拒绝；缺 id/source/target 仍拒绝", () => {
    expect(canvasEdgeSchema.safeParse({ id: "e1", source: "a", target: "b", style: { stroke: "#444" } }).success).toBe(false);
    expect(canvasEdgeSchema.safeParse({ source: "a", target: "b" }).success).toBe(false);
    expect(canvasEdgeSchema.safeParse({ id: "", source: "a", target: "b" }).success).toBe(false);
  });
});
