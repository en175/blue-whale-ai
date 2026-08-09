/**
 * L1 — NodeKind 注册表。每个 kind 声明端口 + 如何构造生成任务。
 * 端口（ports）在 registry（不在 node data）；node 只持 assetId/prompt/recipe/status。
 * Component 在 L2 wiring 阶段接（保持本模块纯逻辑、可测、无 RF 依赖）。
 */
import type { FC } from "react";
import type { Asset, CanvasNode, MediaKind, NodeKindId } from "./model";

export interface Port {
  id: string; // handle id: "prompt" | "firstFrame" | "reference" | "video" | "script" | ...
  direction: "in" | "out";
  accept: MediaKind[];
}

export interface TaskInput {
  kind: MediaKind;
  prompt?: string;
  firstFrame?: Asset;
  referenceImages?: Asset[];
  video?: Asset;
  script?: string;
  model?: string;
}

export interface NodeKindSpec {
  media: MediaKind | null; // null = group（frame，非 producer）
  inputs: Port[];
  outputs: Port[];
  /** 由 node + 已解析的引用输入构造生成任务。 */
  buildTask: (node: CanvasNode, inputs: Record<string, Asset>) => TaskInput;
  /** L2 wiring 阶段填充；本轮 kinds 不设，保持本模块 UI-free。 */
  Component?: FC<{ nodeId: string }>;
}

/** 从 text Asset 取文本（src 即文本；data:text 解码）。 */
export function textOf(a: Asset): string {
  if (a.kind === "text") return a.src ?? "";
  if (a.src?.startsWith("data:text/"))
    return decodeURIComponent(a.src.split(",").slice(1).join(","));
  return a.src ?? "";
}

const promptOr = (
  node: CanvasNode,
  inputs: Record<string, Asset>,
): string | undefined =>
  inputs.prompt ? textOf(inputs.prompt) : node.data.prompt;

export const nodeKinds: Record<NodeKindId, NodeKindSpec> = {
  text: {
    media: "text",
    inputs: [],
    outputs: [{ id: "text", direction: "out", accept: ["text"] }],
    buildTask: (n) => ({
      kind: "text",
      prompt: n.data.prompt,
      model: n.data.model,
    }),
  },
  image: {
    media: "image",
    inputs: [
      { id: "prompt", direction: "in", accept: ["text"] },
      { id: "reference", direction: "in", accept: ["image"] },
    ],
    outputs: [{ id: "image", direction: "out", accept: ["image"] }],
    buildTask: (n, ins) => ({
      kind: "image",
      prompt: promptOr(n, ins),
      referenceImages: ins.reference ? [ins.reference] : [],
      model: n.data.model,
    }),
  },
  video: {
    media: "video",
    inputs: [
      { id: "prompt", direction: "in", accept: ["text"] },
      { id: "firstFrame", direction: "in", accept: ["image"] },
    ],
    outputs: [{ id: "video", direction: "out", accept: ["video"] }],
    buildTask: (n, ins) => ({
      kind: "video",
      prompt: promptOr(n, ins),
      firstFrame: ins.firstFrame,
      model: n.data.model,
    }),
  },
  audio: {
    media: "audio",
    inputs: [
      { id: "prompt", direction: "in", accept: ["text"] },
      { id: "video", direction: "in", accept: ["video"] },
    ],
    outputs: [{ id: "audio", direction: "out", accept: ["audio"] }],
    buildTask: (n, ins) => ({
      kind: "audio",
      script: promptOr(n, ins),
      video: ins.video,
      model: n.data.model,
    }),
  },
  group: {
    media: null,
    inputs: [],
    outputs: [],
    buildTask: () => {
      throw new Error("group has no buildTask — run it via runGroup");
    },
  },
  /** IK55VS 参考卡：组织型节点（非 producer），无端口、不参与生成（卡片作生成输入属后续票）。 */
  reference: {
    media: null,
    inputs: [],
    outputs: [],
    buildTask: () => {
      throw new Error(
        "reference card has no buildTask — it is an organizational node",
      );
    },
  },
  /** 场景卡节点（spec §6.2）：组织型节点（非 producer），只持 sceneCardId 引用，不参与生成。 */
  scene_card: {
    media: null,
    inputs: [],
    outputs: [],
    buildTask: () => {
      throw new Error(
        "scene card has no buildTask — it is an organizational node",
      );
    },
  },
};
