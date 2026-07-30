import { describe, it, expect } from "vitest";
import {
  serialize,
  parse,
  createEmptyDoc,
  richDocToPlainText,
  isEmptyRichDoc,
  type CanvasDoc,
  type NodeRecipe,
} from "./model";

/**
 * 兼容老数据结构：serialize 产 NodeItem[]（老 /canvas filterPersistableNodes 对数组调
 * .filter；存 {nodes,edges} 对象则崩）。parse 双兼容老 NodeItem[] + 新 {nodes,edges}。
 */
describe("canvas-doc-model", () => {
  it("creates empty doc", () => {
    expect(createEmptyDoc("c1")).toEqual({
      id: "c1",
      nodes: [],
      edges: [],
      version: 1,
    });
  });

  it("serialize 产 NodeItem[]（老格式数组，兼容老 /canvas 不崩）", () => {
    const doc: CanvasDoc = {
      id: "c1",
      version: 1,
      edges: [],
      nodes: [
        {
          id: "n1",
          type: "image",
          position: { x: 1, y: 2 },
          width: 100,
          height: 100,
          data: { kind: "image", assetId: "95", content: "猫" },
        },
      ],
    };
    const arr = JSON.parse(serialize(doc));
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(1);
    expect(arr[0]).toMatchObject({
      id: "n1",
      type: "image",
      position: { x: 1, y: 2 },
      width: 100,
      height: 100,
      content: "猫",
      assetId: 95,
    });
  });

  it("serialize 剥临时态（status/progress/selected 不入库）+ assetId String→Number", () => {
    const doc: CanvasDoc = {
      id: "c1",
      version: 1,
      edges: [],
      nodes: [
        {
          id: "n1",
          type: "image",
          position: { x: 0, y: 0 },
          data: {
            kind: "image",
            assetId: "95",
            status: "running",
            progress: 50,
          },
        },
      ],
    };
    const json = serialize(doc);
    expect(json).not.toContain("status");
    expect(json).not.toContain("progress");
    expect(json).not.toContain("selected");
    expect(json).toContain('"assetId":95');
  });

  it("serialize 保留超大 asset ID 的十进制字符串精度", () => {
    const assetId = "9007199254740993";
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "n1",
      type: "image",
      position: { x: 0, y: 0 },
      data: { kind: "image", assetId },
    });

    expect(JSON.parse(serialize(doc))[0].assetId).toBe(assetId);
    expect(parse(serialize(doc)).nodes[0].data.assetId).toBe(assetId);
  });

  it("parse 兼容老 NodeItem[]（数组，老 /canvas 写的）", () => {
    const oldJson = JSON.stringify([
      {
        id: "n1",
        type: "image",
        position: { x: 1, y: 2 },
        width: 100,
        height: 100,
        content: "猫",
        assetId: 95,
      },
    ]);
    const doc = parse(oldJson);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0]).toMatchObject({
      id: "n1",
      type: "image",
      position: { x: 1, y: 2 },
      data: { kind: "image", assetId: "95", content: "猫" },
    });
  });

  it("parse 兼容新 {nodes,edges}（对象，v2 已写的）", () => {
    const newJson = JSON.stringify({
      id: "c1",
      version: 1,
      edges: [],
      nodes: [
        {
          id: "n1",
          type: "image",
          position: { x: 0, y: 0 },
          data: { kind: "image", assetId: "95" },
        },
      ],
    });
    const doc = parse(newJson);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0].data.assetId).toBe("95");
  });

  it("round-trip：serialize→parse 关键字段保留（assetId String 全链路）", () => {
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "n1",
      type: "image",
      position: { x: 5, y: 6 },
      width: 200,
      height: 200,
      data: { kind: "image", assetId: "95", content: "猫" },
    });
    const back = parse(serialize(doc));
    expect(back.nodes[0]).toMatchObject({
      id: "n1",
      type: "image",
      position: { x: 5, y: 6 },
      data: { kind: "image", assetId: "95", content: "猫" },
    });
  });

  it("serialize 把 edges 聚合到 target 节点 references（兼容老 NodeItem[]）", () => {
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "t",
      type: "text",
      position: { x: 0, y: 0 },
      data: { kind: "text", prompt: "猫" },
    });
    doc.nodes.push({
      id: "i",
      type: "image",
      position: { x: 100, y: 0 },
      data: { kind: "image" },
    });
    doc.edges.push({
      id: "e1",
      source: "t",
      target: "i",
      sourceHandle: "text",
      targetHandle: "prompt",
    });
    const arr = JSON.parse(serialize(doc));
    expect(arr.find((n: { id: string }) => n.id === "i").references).toEqual([
      { source: "t", sourceHandle: "text", targetHandle: "prompt" },
    ]);
    expect(arr.find((n: { id: string }) => n.id === "t").references).toEqual(
      [],
    ); // text 无入边
  });

  it("parse references → edges（round-trip）", () => {
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "t",
      type: "text",
      position: { x: 0, y: 0 },
      data: { kind: "text", prompt: "猫" },
    });
    doc.nodes.push({
      id: "i",
      type: "image",
      position: { x: 100, y: 0 },
      data: { kind: "image" },
    });
    doc.edges.push({
      id: "e1",
      source: "t",
      target: "i",
      sourceHandle: "text",
      targetHandle: "prompt",
    });
    const back = parse(serialize(doc));
    expect(back.edges).toHaveLength(1);
    expect(back.edges[0]).toMatchObject({
      source: "t",
      target: "i",
      sourceHandle: "text",
      targetHandle: "prompt",
    });
  });

  it("parse 老 NodeItem[] 无 references → edges=[]（兼容老）", () => {
    const old = JSON.stringify([
      {
        id: "n1",
        type: "image",
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        content: "猫",
      },
    ]);
    expect(parse(old).edges).toEqual([]);
  });

  it("serialize/parse 保 prompt（文本节点）", () => {
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "t",
      type: "text",
      position: { x: 0, y: 0 },
      data: { kind: "text", prompt: "画一只猫" },
    });
    const back = parse(serialize(doc));
    expect(back.nodes[0].data.prompt).toBe("画一只猫");
  });

  it("serialize audio 节点产 type=audio（不降级 image）", () => {
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "a1",
      type: "audio",
      position: { x: 0, y: 0 },
      width: 240,
      height: 120,
      data: { kind: "audio", assetId: "12", content: "旁白.mp3" },
    });
    const arr = JSON.parse(serialize(doc));
    expect(arr[0].type).toBe("audio");
    expect(arr[0].assetId).toBe(12);
  });

  it("audio 节点 serialize→parse kind 保留（不降级 image，IJZY0Z 音频持久化）", () => {
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "a1",
      type: "audio",
      position: { x: 0, y: 0 },
      width: 240,
      height: 120,
      data: { kind: "audio", assetId: "12", content: "旁白.mp3" },
    });
    const back = parse(serialize(doc));
    expect(back.nodes[0].data.kind).toBe("audio");
    expect(back.nodes[0].data.assetId).toBe("12");
    expect(back.nodes[0].data.content).toBe("旁白.mp3");
  });

  it("parse 老 NodeItem type=audio → kind=audio（兼容已存的音频节点）", () => {
    const old = JSON.stringify([
      {
        id: "a1",
        type: "audio",
        position: { x: 0, y: 0 },
        width: 240,
        height: 120,
        content: "旁白.mp3",
        assetId: 12,
      },
    ]);
    expect(parse(old).nodes[0].data.kind).toBe("audio");
  });

  it("generated recipe serialize→parse 深保留（origin/model/params/inputs/jobId）", () => {
    const recipe: NodeRecipe = {
      origin: "generated",
      generation: {
        mediaKind: "image",
        model: "doubao-seedream",
        params: { aspectRatio: "16:9", resolution: "1080p", quantity: 1 },
        inputs: { prompt: { kind: "text", nodeId: "t1", text: "猫" } },
        jobId: "job-7",
        generatedAt: "2026-07-22T10:00:00Z",
      },
    };
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "n1",
      type: "image",
      position: { x: 0, y: 0 },
      data: { kind: "image", assetId: "95", recipe },
    });
    const back = parse(serialize(doc));
    expect(back.nodes[0].data.recipe).toEqual(recipe);
  });

  it("video recipe 首帧溯源 round-trip（nodeId 画布内 vs assetId 画布外）", () => {
    const recipe: NodeRecipe = {
      origin: "generated",
      generation: {
        mediaKind: "video",
        model: "kling-v2",
        params: {
          aspectRatio: "16:9",
          resolution: "1080p",
          duration: 5,
          refMode: "firstlast",
        },
        inputs: {
          firstFrame: {
            kind: "image",
            assetId: "88",
            url: "https://tos/ff.png",
          },
        },
        jobId: "job-8",
      },
    };
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "v1",
      type: "video",
      position: { x: 0, y: 0 },
      data: { kind: "video", assetId: "96", recipe },
    });
    expect(parse(serialize(doc)).nodes[0].data.recipe).toEqual(recipe);
  });

  it("uploaded recipe round-trip（无 generation）", () => {
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "u1",
      type: "audio",
      position: { x: 0, y: 0 },
      data: { kind: "audio", assetId: "12", recipe: { origin: "uploaded" } },
    });
    expect(parse(serialize(doc)).nodes[0].data.recipe).toEqual({
      origin: "uploaded",
    });
  });

  it("老数据无 recipe → recipe undefined 不崩（向前兼容）", () => {
    const old = JSON.stringify([
      {
        id: "n1",
        type: "image",
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        content: "猫",
        assetId: 95,
      },
    ]);
    const node = parse(old).nodes[0];
    expect(node.data.recipe).toBeUndefined();
  });

  it("serialize 输出含 recipe 字段（持久化进画布 JSON）", () => {
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "n1",
      type: "image",
      position: { x: 0, y: 0 },
      data: { kind: "image", assetId: "95", recipe: { origin: "uploaded" } },
    });
    const arr = JSON.parse(serialize(doc));
    expect(arr[0].recipe).toEqual({ origin: "uploaded" });
  });

  it("serialize/parse 保 taskId（视频 job 关联持久化，刷新 recover by taskId）", () => {
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "v1",
      type: "video",
      position: { x: 0, y: 0 },
      data: { kind: "video", taskId: "130", status: "running", progress: 30 },
    });
    const back = parse(serialize(doc));
    expect(back.nodes[0].data.taskId).toBe("130");
    // status/progress 临时态，serialize 剥（taskId 是持久关联，保留）
    expect(back.nodes[0].data.status).toBeUndefined();
    expect(back.nodes[0].data.progress).toBeUndefined();
  });

  it("IK55VH richDoc serialize→parse round-trip（富文本卡 JSON doc 持久化）", () => {
    const richDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "新品笔记" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "参考 " },
            { type: "mention", attrs: { id: "n1", label: "产品主图.png" } },
          ],
        },
      ],
    };
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "t1",
      type: "text",
      position: { x: 0, y: 0 },
      width: 200,
      height: 48,
      data: { kind: "text", richDoc, prompt: "新品笔记\n参考 @[产品主图.png]" },
    });
    const back = parse(serialize(doc));
    expect(back.nodes[0].data.richDoc).toEqual(richDoc);
    expect(back.nodes[0].data.prompt).toBe("新品笔记\n参考 @[产品主图.png]");
  });

  it("老数据无 richDoc → richDoc undefined 不崩（向前兼容）", () => {
    const old = JSON.stringify([
      {
        id: "t1",
        type: "text",
        position: { x: 0, y: 0 },
        width: 200,
        height: 48,
        content: "旧文本卡",
      },
    ]);
    const node = parse(old).nodes[0];
    expect(node.data.richDoc).toBeUndefined();
    expect(node.data.content).toBe("旧文本卡");
  });

  it("IK55VS reference 节点 cardType/description serialize→parse round-trip（kind 不降级）", () => {
    const doc = createEmptyDoc("c1");
    doc.nodes.push({
      id: "r1",
      type: "reference",
      position: { x: 0, y: 0 },
      width: 280,
      height: 240,
      data: {
        kind: "reference",
        cardType: "character",
        description: "外观描述",
      },
    });
    const arr = JSON.parse(serialize(doc));
    expect(arr[0].type).toBe("reference");
    expect(arr[0].cardType).toBe("character");
    expect(arr[0].description).toBe("外观描述");
    const back = parse(serialize(doc));
    expect(back.nodes[0].type).toBe("reference");
    expect(back.nodes[0].data.kind).toBe("reference");
    expect(back.nodes[0].data.cardType).toBe("character");
    expect(back.nodes[0].data.description).toBe("外观描述");
  });

  it("老数据无 cardType/description → undefined 不崩（向前兼容）", () => {
    const old = JSON.stringify([
      {
        id: "n1",
        type: "image",
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        assetId: 95,
      },
    ]);
    const node = parse(old).nodes[0];
    expect(node.data.cardType).toBeUndefined();
    expect(node.data.description).toBeUndefined();
  });
});

/** IK55VH richDocToPlainText：连线进下游 prompt 的纯文本派生契约。 */
describe("richDocToPlainText", () => {
  it("mention → @[name]（与 dock/mention.ts extractEditor 契约一致）", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "参考 " },
            { type: "mention", attrs: { id: "n1", label: "产品主图.png" } },
            { type: "text", text: " 构图" },
          ],
        },
      ],
    };
    expect(richDocToPlainText(doc)).toBe("参考 @[产品主图.png] 构图");
  });

  it("mention 无 label 时回退 @[id]", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: "n9" } }],
        },
      ],
    };
    expect(richDocToPlainText(doc)).toBe("@[n9]");
  });

  it("heading/paragraph 按行，marks（bold/颜色）剥离只留文本", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "标题" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "甲" },
            { type: "text", marks: [{ type: "bold" }], text: "乙" },
            {
              type: "text",
              marks: [{ type: "textStyle", attrs: { color: "#3b82f6" } }],
              text: "丙",
            },
          ],
        },
      ],
    };
    expect(richDocToPlainText(doc)).toBe("标题\n甲乙丙");
  });

  it("无序/有序列表展平为逐行文本，引用块展平", () => {
    const item = (t: string) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
    });
    const doc = {
      type: "doc",
      content: [
        { type: "bulletList", content: [item("首图白底"), item("加对比表")] },
        { type: "orderedList", content: [item("第一步"), item("第二步")] },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "引用一句" }],
            },
          ],
        },
      ],
    };
    expect(richDocToPlainText(doc)).toBe(
      "首图白底\n加对比表\n第一步\n第二步\n引用一句",
    );
  });

  it("分割线 → `---` 行；hardBreak → 换行", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "上" }] },
        { type: "horizontalRule" },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "下" },
            { type: "hardBreak" },
            { type: "text", text: "一" },
          ],
        },
      ],
    };
    expect(richDocToPlainText(doc)).toBe("上\n---\n下\n一");
  });

  it("空 doc → 空串；isEmptyRichDoc 判定空卡", () => {
    const empty = { type: "doc", content: [{ type: "paragraph" }] };
    expect(richDocToPlainText(empty)).toBe("");
    expect(isEmptyRichDoc(empty)).toBe(true);
    expect(
      isEmptyRichDoc({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "x" }] },
        ],
      }),
    ).toBe(false);
  });
});
