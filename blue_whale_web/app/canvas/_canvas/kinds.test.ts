import { describe, it, expect } from "vitest";
import { nodeKinds } from "./kinds";
import type { Asset, CanvasNode, NodeKindId } from "./model";

const node = (
  kind: NodeKindId,
  data: Record<string, unknown> = {},
): CanvasNode => ({
  id: "n1",
  type: kind,
  position: { x: 0, y: 0 },
  data: { kind, ...data },
});
const textAsset: Asset = { id: "at", kind: "text", src: "hello" };

describe("node-kind-registry", () => {
  it("nodeKinds has text/image/video/audio/group/reference/scene_card with media/inputs/outputs/buildTask", () => {
    expect(Object.keys(nodeKinds)).toEqual([
      "text",
      "image",
      "video",
      "audio",
      "group",
      "reference",
      "scene_card",
    ]);
    for (const s of Object.values(nodeKinds)) {
      expect(s.media !== undefined).toBe(true);
      expect(Array.isArray(s.inputs)).toBe(true);
      expect(Array.isArray(s.outputs)).toBe(true);
      expect(typeof s.buildTask).toBe("function");
    }
  });

  it("group.buildTask throws referencing runGroup", () => {
    expect(() => nodeKinds.group.buildTask(node("group"), {})).toThrow(
      /runGroup/,
    );
  });

  it("reference（IK55VS 参考卡）无端口、不可生成：media=null 且 buildTask 抛错", () => {
    const spec = nodeKinds.reference;
    expect(spec.media).toBeNull();
    expect(spec.inputs).toEqual([]);
    expect(spec.outputs).toEqual([]);
    expect(() => spec.buildTask(node("reference"), {})).toThrow();
  });

  it("scene_card（spec §6.2 场景卡）组织型节点：media=null、无端口且 buildTask 抛错", () => {
    const spec = nodeKinds.scene_card;
    expect(spec.media).toBeNull();
    expect(spec.inputs).toEqual([]);
    expect(spec.outputs).toEqual([]);
    expect(() =>
      spec.buildTask(node("scene_card", { sceneCardId: "5" }), {}),
    ).toThrow();
  });

  it("buildTask uses referenced input over node.data.prompt", () => {
    const task = nodeKinds.image.buildTask(
      node("image", { prompt: "自带的" }),
      { prompt: textAsset },
    );
    expect(task.prompt).toBe("hello");
  });

  it("buildTask falls back to node.data.prompt when no reference", () => {
    const task = nodeKinds.image.buildTask(
      node("image", { prompt: "自带的" }),
      {},
    );
    expect(task.prompt).toBe("自带的");
  });
});
