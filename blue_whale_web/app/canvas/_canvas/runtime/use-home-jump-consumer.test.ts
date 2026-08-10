// @vitest-environment jsdom
/**
 * useHomeJumpConsumer —— IK74TX 1.1/1.2/1.3 首页跳转落地消费测试。
 * 覆盖：video 自动生成 + Dock 预填、agent 打开面板不生成、一次性消费守卫。
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeJumpConsumer, type HomeJumpConsumerDeps } from "./use-home-jump-consumer";
import { useCanvasStore } from "../store";

// ensureAsset 拉 URL：mock 直接写入 store（不触网）。
beforeEach(() => {
  useCanvasStore.setState({ assets: {} });
  // resolveAssetUrls 调 ensureAsset：mock 为幂等写入，避免真实网络请求。
  vi.spyOn(useCanvasStore.getState(), "ensureAsset").mockImplementation(
    async (assetId: string) => {
      useCanvasStore.setState((s) => ({
        assets: {
          ...s.assets,
          [assetId]: {
            id: assetId,
            kind: "image",
            src: `https://tos.example/${assetId}.png`,
          },
        },
      }));
    },
  );
});

function makeDeps(overrides: Partial<HomeJumpConsumerDeps> = {}): HomeJumpConsumerDeps {
  return {
    ready: true,
    jump: {
      tab: "video",
      prompt: "海边黄昏",
      model: "seedance-2",
      ratio: "16:9",
      size: "720p",
      duration: "8",
      refMode: "omni",
      assets: ["1001"],
    },
    openDock: vi.fn(),
    prefillDock: vi.fn(),
    openAgent: vi.fn(),
    generate: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
    ...overrides,
  };
}

// 预置 store 的辅助被 beforeEach 覆盖，删除顶部重复 setState。
describe("useHomeJumpConsumer", () => {
  it("tab=video：打开 Dock + prefill + 自动生成（带参考素材）", async () => {
    const deps = makeDeps();
    renderHook(() => useHomeJumpConsumer(deps));

    await vi.waitFor(() => {
      expect(deps.openDock).toHaveBeenCalledWith("video");
    });
    expect(deps.prefillDock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "海边黄昏",
        modelId: "seedance-2",
        aspectRatio: "16:9",
        resolution: "720p",
        duration: 8,
        refMode: "omni",
        references: [{ url: "https://tos.example/1001.png", kind: "image", assetId: "1001" }],
      }),
    );
    expect(deps.generate).toHaveBeenCalledWith(
      "海边黄昏",
      expect.objectContaining({
        mode: "video",
        settings: expect.objectContaining({
          duration: 8,
          refMode: { id: "omni", label: "全能参考" },
          referenceMedia: [{ kind: "image", url: "https://tos.example/1001.png", assetId: "1001" }],
        }),
        referenceAssetIds: ["1001"],
      }),
    );
    expect(deps.openAgent).not.toHaveBeenCalled();
  });

  it("tab=agent：只打开 Agent 面板，不触发生成", async () => {
    const deps = makeDeps({
      jump: { tab: "agent", prompt: "拍个广告", skill: "skill-9", agentModel: "text-model" },
    });
    renderHook(() => useHomeJumpConsumer(deps));

    await vi.waitFor(() => {
      expect(deps.openAgent).toHaveBeenCalled();
    });
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.openDock).not.toHaveBeenCalled();
    expect(deps.prefillDock).not.toHaveBeenCalled();
  });

  it("tab=video 且 refMode=text-to-video（画布无此模式）→ 回落 omni 纯 prompt 生成", async () => {
    const deps = makeDeps({
      jump: { tab: "video", prompt: "纯文字", refMode: "text-to-video", assets: [] },
    });
    renderHook(() => useHomeJumpConsumer(deps));

    await vi.waitFor(() => {
      expect(deps.generate).toHaveBeenCalled();
    });
    expect(deps.generate).toHaveBeenCalledWith(
      "纯文字",
      expect.objectContaining({
        settings: expect.objectContaining({
          refMode: { id: "omni", label: "全能参考" },
          referenceMedia: [],
        }),
      }),
    );
  });

  it("一次性消费：同 jump 重复 render 只触发一次", async () => {
    const deps = makeDeps();
    const { rerender } = renderHook(() => useHomeJumpConsumer(deps));
    await vi.waitFor(() => {
      expect(deps.generate).toHaveBeenCalledTimes(1);
    });
    // ready 再次翻真（模拟 effect 依赖变化）不重复消费
    rerender();
    rerender();
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.generate).toHaveBeenCalledTimes(1);
  });

  it("未 ready 不消费；ready 后消费", async () => {
    const deps = makeDeps({ ready: false });
    const { rerender } = renderHook(() => useHomeJumpConsumer(deps));
    expect(deps.generate).not.toHaveBeenCalled();

    rerender();
    // ready 仍 false → 不消费
    expect(deps.generate).not.toHaveBeenCalled();

    deps.ready = true;
    rerender();
    await vi.waitFor(() => {
      expect(deps.generate).toHaveBeenCalled();
    });
  });

  it("无 jump（普通画布访问）→ 不消费", async () => {
    const deps = makeDeps({ jump: null });
    renderHook(() => useHomeJumpConsumer(deps));
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.openDock).not.toHaveBeenCalled();
    expect(deps.openAgent).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
  });
});
