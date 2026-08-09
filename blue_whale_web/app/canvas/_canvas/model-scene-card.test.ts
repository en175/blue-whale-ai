import { describe, it, expect } from "vitest";
import { serialize, parse, type CanvasDoc } from "./model";

describe("scene_card 节点（spec §6.2）", () => {
  it("parse 迁移旧格式节点：scene_card_<id> + 平铺 scene_card_id → scene-card:<id> + data.sceneCardId", () => {
    const doc = parse(
      JSON.stringify([
        {
          id: "scene_card_5",
          type: "scene_card",
          scene_card_id: "5",
          position: { x: 10, y: 20 },
          width: 400,
          height: 1080,
          status: "pending",
        },
      ]),
    );
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0]).toMatchObject({
      id: "scene-card:5",
      type: "scene_card",
      position: { x: 10, y: 20 },
      width: 400,
      height: 1080,
      data: { kind: "scene_card", sceneCardId: "5" },
    });
    // 旧格式字段不残留进 data
    expect(doc.nodes[0].data["scene_card_id"]).toBeUndefined();
    expect(doc.nodes[0].data.status).toBeUndefined();
  });

  it("parse 保留新格式节点：scene-card:<id> + data.sceneCardId 幂等不变", () => {
    const doc = parse(
      JSON.stringify([
        {
          id: "scene-card:7",
          type: "scene_card",
          data: { sceneCardId: "7" },
          position: { x: 0, y: 0 },
          width: 400,
          height: 320,
        },
      ]),
    );
    expect(doc.nodes[0]).toMatchObject({
      id: "scene-card:7",
      type: "scene_card",
      data: { kind: "scene_card", sceneCardId: "7" },
    });
  });

  it("serialize 按 spec §6.2 写嵌套 data.sceneCardId，parse 往返不丢引用", () => {
    const doc: CanvasDoc = {
      id: "c1",
      version: 1,
      edges: [],
      nodes: [
        {
          id: "scene-card:5",
          type: "scene_card",
          position: { x: 1, y: 2 },
          width: 400,
          height: 320,
          data: { kind: "scene_card", sceneCardId: "5" },
        },
      ],
    };
    const arr = JSON.parse(serialize(doc));
    expect(arr[0]).toMatchObject({
      id: "scene-card:5",
      type: "scene_card",
      width: 400,
      height: 320,
      data: { sceneCardId: "5" },
    });
    const roundTrip = parse(serialize(doc));
    expect(roundTrip.nodes[0]).toMatchObject({
      id: "scene-card:5",
      type: "scene_card",
      data: { kind: "scene_card", sceneCardId: "5" },
    });
  });
});
