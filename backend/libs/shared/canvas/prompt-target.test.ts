import { describe, expect, it } from "vitest";

import type { PromptBinding } from "@lib/contracts";
import { syncDraftModeOnPlanMedia } from "./prompt-target.js";

// IKFC26：方案绑定媒体 → 文生视频目标切全能参考（服务端与前端门控同向，仅 prompt → all 单向）。

const binding = (assetId: string): PromptBinding => ({ assetId, index: 1 });

function nodesWith(draftMode: string | undefined) {
  return [
    { id: "text-1", type: "textNode", data: { title: "方案", text: "正文" } },
    { id: "img-1", type: "mediaNode", data: { mediaType: "image", assetId: "101" } },
    { id: "video-target", type: "mediaNode", data: { mediaType: "video", draft: true, ...(draftMode !== undefined ? { draftMode } : {}) } },
  ];
}

describe("syncDraftModeOnPlanMedia（IKFC26）", () => {
  it("文生视频目标 + 方案绑定媒体 → 目标切全能参考，其余节点与字段原样保留", () => {
    const next = syncDraftModeOnPlanMedia(nodesWith("prompt"), "video-target", [binding("101")]);
    const target = next.find(n => n.id === "video-target")!;
    expect(target.data?.draftMode).toBe("all");
    expect(target.data?.mediaType).toBe("video");
    expect(target.data?.draft).toBe(true);
    expect(next.find(n => n.id === "text-1")).toEqual({ id: "text-1", type: "textNode", data: { title: "方案", text: "正文" } });
    expect(next.find(n => n.id === "img-1")?.data?.draftMode).toBeUndefined();
  });

  it("方案仅文本（bindings 为空）→ 原样返回同一引用，不触发切换", () => {
    const nodes = nodesWith("prompt");
    expect(syncDraftModeOnPlanMedia(nodes, "video-target", [])).toBe(nodes);
  });

  it.each(["all", "keyframe", "text2video"])("非文生视频模式（%s）→ 不受污染", (mode) => {
    const nodes = nodesWith(mode);
    expect(syncDraftModeOnPlanMedia(nodes, "video-target", [binding("101")])).toBe(nodes);
  });

  it("无 draftMode 旧草稿 → 原样保留（由前端门控在面板打开时纠正）", () => {
    const nodes = nodesWith(undefined);
    expect(syncDraftModeOnPlanMedia(nodes, "video-target", [binding("101")])).toBe(nodes);
  });

  it("目标节点不存在 → 原样返回", () => {
    const nodes = nodesWith("prompt");
    expect(syncDraftModeOnPlanMedia(nodes, "video-404", [binding("101")])).toBe(nodes);
  });
});
