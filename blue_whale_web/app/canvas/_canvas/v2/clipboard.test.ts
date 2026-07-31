/**
 * 剪贴板助手测试：拷贝序列化 ↔ 粘贴解析回环 + 容错。
 */
import { describe, expect, it } from "vitest";
import {
  cloneNodeWithOffset,
  parseClipboardNodes,
  serializeNodesForClipboard,
  CLONE_OFFSET,
} from "./clipboard";
import type { CanvasNode, CanvasNodeData } from "../model";

function makeNode(
  kind: string,
  data: Partial<CanvasNodeData> = {},
): CanvasNode {
  return {
    id: crypto.randomUUID(),
    type: kind as CanvasNode["type"],
    position: { x: 100, y: 200 },
    width: 320,
    height: 180,
    data: { kind: kind as CanvasNodeData["kind"], ...data },
  };
}

describe("clipboard 拷贝/粘贴", () => {
  it("序列化 → 解析回环：新 id、偏移落点、保留数据", () => {
    const src = makeNode("image", { content: "示例图", status: "done" });
    const [pasted] = parseClipboardNodes(serializeNodesForClipboard([src]));
    expect(pasted).toBeDefined();
    expect(pasted.id).not.toBe(src.id);
    expect(pasted.position).toEqual({
      x: src.position.x + CLONE_OFFSET,
      y: src.position.y + CLONE_OFFSET,
    });
    expect(pasted.data.content).toBe("示例图");
  });

  it("克隆清除瞬时 status（复制/粘贴不落运行态）", () => {
    const src = makeNode("video", { status: "running" });
    expect(cloneNodeWithOffset(src).data.status).toBeUndefined();
  });

  it("普通文本（非 JSON）解析为空", () => {
    expect(parseClipboardNodes("hello world")).toEqual([]);
  });

  it("JSON 非数组解析为空", () => {
    expect(parseClipboardNodes('{"foo":1}')).toEqual([]);
  });

  it("残缺条目跳过，完整条目保留", () => {
    const src = makeNode("text", { content: "笔记" });
    const text = JSON.stringify([
      JSON.parse(serializeNodesForClipboard([src]))[0],
      { broken: true },
    ]);
    const nodes = parseClipboardNodes(text);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.content).toBe("笔记");
  });
});
