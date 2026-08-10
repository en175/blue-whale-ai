// @vitest-environment jsdom
/**
 * useNodeActions 「mention」动作测试（jsdom）。
 * seam = 节点工具栏/参考卡 @ 按钮 → onAction(id,"mention") → handleNodeAction
 * → setIsAgentOpen(true) + setAgentPendingMention（pendingMention 管道，
 * 等价右键「添加到聊天」）。参考卡走 nodeToPendingMention 的 reference 分支
 * （assetId 取 referenceAssetId，卡名/类型名作 name）。
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNodeActions, type NodeActionsCtx } from "./use-node-actions";
import type { CanvasNode } from "../model";

function makeCtx(overrides: Partial<NodeActionsCtx> = {}): NodeActionsCtx {
  return {
    assets: { "300": { id: "300", kind: "image", src: "https://cdn/ref.png" } },
    referenceGenTargetRef: { current: null },
    generateFromNode: vi.fn(),
    setBottomDockMode: vi.fn(),
    setImageDockMedia: vi.fn(),
    setVideoDockMedia: vi.fn(),
    setAudioDockMedia: vi.fn(),
    setFirstFrameUrl: vi.fn(),
    setLastFrameUrl: vi.fn(),
    setFirstFrameAssetId: vi.fn(),
    setLastFrameAssetId: vi.fn(),
    setAgentPendingMention: vi.fn(),
    setDockMentionSignal: vi.fn(),
    setPrefillSignal: vi.fn(),
    setIsAgentOpen: vi.fn(),
    setIsBottomDockOpen: vi.fn(),
    setDockFocusSignal: vi.fn(),
    setInfoNodeId: vi.fn(),
    setGenerateError: vi.fn(),
    ...overrides,
  };
}

function makeReferenceNode(data: Record<string, unknown>): CanvasNode {
  return {
    id: "r1",
    data: { kind: "reference", ...data },
  } as unknown as CanvasNode;
}

describe("useNodeActions mention（参考卡 @ 按钮引用管道）", () => {
  it("reference 卡：开 Agent 面板 + pendingMention 走 reference 映射（assetId=referenceAssetId）", () => {
    const setAgentPendingMention = vi.fn();
    const setIsAgentOpen = vi.fn();
    const { result } = renderHook(() =>
      useNodeActions(makeCtx({ setAgentPendingMention, setIsAgentOpen })),
    );
    result.current.handleNodeAction(
      makeReferenceNode({
        cardType: "style",
        name: "赛博朋克风",
        referenceAssetId: "300",
      }),
      "mention",
    );
    expect(setIsAgentOpen).toHaveBeenCalledWith(true);
    expect(setAgentPendingMention).toHaveBeenCalledTimes(1);
    const batch = setAgentPendingMention.mock.calls[0][0];
    expect(batch.mentions).toEqual([
      {
        name: "赛博朋克风",
        nonce: batch.batchId,
        assetId: 300,
        src: "https://cdn/ref.png",
        type: "image",
      },
    ]);
  });

  it("reference 卡无图：回退纯文本 mention（无 assetId/src）", () => {
    const setAgentPendingMention = vi.fn();
    const { result } = renderHook(() =>
      useNodeActions(makeCtx({ setAgentPendingMention })),
    );
    result.current.handleNodeAction(
      makeReferenceNode({ cardType: "character", name: "Zeus" }),
      "mention",
    );
    const batch = setAgentPendingMention.mock.calls[0][0];
    expect(batch.mentions).toEqual([
      {
        name: "Zeus",
        nonce: batch.batchId,
        assetId: undefined,
        src: undefined,
        type: "image",
      },
    ]);
  });
});
