"use client";
/**
 * useHomeJumpConsumer —— IK74TX 1.1/1.2/1.3 首页跳转消费（画布落地侧）。
 *
 * 首页输入框点生成 → /canvas?project=<新id>&tab=<video|image|agent>&prompt=…&model=…&…
 * 本 hook 在画布 hydration ready 后**一次性**读取这些参数并落地对应行为：
 *
 *  - tab=video / tab=image：自动打开 BottomDock、prefill 全部参数与素材、并立即调用
 *    generate() 启动生成任务（「任务已在进行中」，验收场景）。
 *  - tab=agent：打开右侧 AgentChatPanel（prompt 由 agentChat.prompt 注入），技能与
 *    双模型作为 Agent 初始上下文（skill 经 sessionStorage 传递，见 direct-skill-binding）。
 *
 * 一次性消费：URL 参数在项目新建（page.tsx）时已保留在 query 中，同一次导航只消费一次，
 * 用 ref 防重复触发（刷新/切项目会带不同 query，各自消费自己的）。
 *
 * 设计取舍：
 *  - 复用 BottomDock 既有 prefillSignal 机制（BottomDock.tsx:258 应用），而非新建注入通道；
 *  - 自动生成直接调 generate(prompt, args)（useCanvasGeneration 自包含，不依赖 Dock 内部 state）。
 */
import { useEffect, useRef } from "react";
import type { GenerateArgs } from "../types";
import { useCanvasStore } from "../store";
import { VIDEO_MODELS, VIDEO_ASPECT_RATIOS, VIDEO_RESOLUTIONS, REF_MODES } from "../constants";

export type HomeJumpConsumerDeps = {
  /** 画布 hydration 是否 ready（ready 后渲染 CanvasRuntimeView，Dock/Agent 面板可挂载）。 */
  ready: boolean;
  /** 首页跳转参数（由页面读取 URL query 传入；无跳转时为 null）。 */
  jump: {
    tab: "video" | "image" | "agent";
    prompt?: string;
    model?: string;
    ratio?: string;
    size?: string;
    duration?: string;
    refMode?: string;
    assets?: string[];
    skill?: string;
    agentModel?: string;
  } | null;
  /** 打开 BottomDock 并设置模式。 */
  openDock: (mode: "image" | "video" | "audio") => void;
  /** 发送 Dock 预填信号（nonce 递增触发 BottomDock 应用参数）。 */
  prefillDock: (prefill: {
    prompt?: string;
    modelId?: string;
    aspectRatio?: string;
    resolution?: string;
    duration?: number;
    refMode?: string;
    references?: { url: string; kind: "image" | "video"; assetId?: string }[];
  }) => void;
  /** 打开右侧 Agent 面板。 */
  openAgent: () => void;
  /** 自动生成入口（与 Dock 提交同一条链路）。 */
  generate: (prompt: string, args: GenerateArgs) => Promise<unknown>;
  /** 未消费跳转时通知（参数非法/加载失败）。 */
  onError?: (message: string) => void;
};

/** 素材 assetId → url 解析（画布 store 拉取；全局资产 project_id=0 worker 认）。
 *  注意：zustand getState() 返回调用时刻的 state 快照，setState 后旧引用的 assets
 *  不变——故 ensureAsset 后必须重新 getState() 读最新 assets。 */
async function resolveAssetUrls(assetIds: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const id of assetIds) {
    try {
      const store = useCanvasStore.getState();
      await store.ensureAsset(id);
      const fresh = useCanvasStore.getState();
      urls.push(fresh.assets[id]?.src ?? "");
    } catch {
      urls.push("");
    }
  }
  return urls;
}

function pick<T extends { id: string }>(list: T[], id: string | undefined): T {
  return list.find((item) => item.id === id) ?? list[0];
}

export function useHomeJumpConsumer(deps: HomeJumpConsumerDeps) {
  const consumedRef = useRef(false);

  useEffect(() => {
    if (!deps.ready || !deps.jump) return;
    if (consumedRef.current) return;
    consumedRef.current = true;

    const jump = deps.jump;
    const { tab, prompt = "", assets = [] } = jump;
    void (async () => {
      try {
        const urls = await resolveAssetUrls(assets);
        if (tab === "video") {
          deps.openDock("video");
          deps.prefillDock({
            prompt,
            modelId: jump.model,
            aspectRatio: jump.ratio,
            resolution: jump.size,
            duration: jump.duration ? Number(jump.duration) : undefined,
            refMode: jump.refMode,
            references: urls
              .map((url, i) => (url ? { url, kind: "image" as const, assetId: assets[i] } : null))
              .filter((r): r is { url: string; kind: "image"; assetId: string } => r !== null),
          });
          const model = pick(VIDEO_MODELS, jump.model);
          const aspectRatio = pick(VIDEO_ASPECT_RATIOS, jump.ratio);
          const resolution = pick(VIDEO_RESOLUTIONS, jump.size);
          // text-to-video：首页 refMode=text-to-video（画布无此模式）→ 回落首项 omni；
          // 素材为空时 omni 与 t2v 等价（纯 prompt 生成）。
          const refMode = REF_MODES.some((r) => r.id === jump.refMode)
            ? REF_MODES.find((r) => r.id === jump.refMode)!
            : REF_MODES[0];
          const duration = jump.duration ? Number(jump.duration) : model === VIDEO_MODELS[0] ? 8 : undefined;
          await deps.generate(prompt, {
            mode: "video",
            settings: {
              model,
              aspectRatio,
              resolution,
              duration: Number.isFinite(duration) ? duration! : 8,
              quantity: "1x",
              refMode,
              referenceMedia: urls
                .map((url, i) => (url ? { kind: "image" as const, url, assetId: assets[i] } : null))
                .filter((r): r is { kind: "image"; url: string; assetId: string } => r !== null),
            },
            ...(urls.length
              ? { referenceAssetIds: assets }
              : {}),
          } as GenerateArgs);
        } else if (tab === "image") {
          deps.openDock("image");
          deps.prefillDock({
            prompt,
            modelId: jump.model,
            aspectRatio: jump.ratio,
            references: urls
              .map((url, i) => (url ? { url, kind: "image" as const, assetId: assets[i] } : null))
              .filter((r): r is { url: string; kind: "image"; assetId: string } => r !== null),
          });
          await deps.generate(prompt, {
            mode: "image",
            settings: {
              aspectRatio: { id: jump.ratio ?? "16:9", label: jump.ratio ?? "16:9" },
              quantity: "1x",
              modelId: jump.model ?? "",
              size: jump.size ?? "",
              webSearch: false,
              sequential: false,
              referenceImageSupported: true,
            },
            referenceImages: urls.filter(Boolean),
            inputAssetIds: urls.length ? assets : undefined,
          } as GenerateArgs);
        } else {
          // tab=agent（1.3）：不触发生成，打开 Agent 面板，prompt 已由 agentChat.prompt 注入；
          // skill 经 sessionStorage（direct-skill-binding）由 AgentChatPanel 消费，双模型上下文后续接入。
          deps.openAgent();
        }
      } catch (err) {
        console.warn("[home-jump] consume failed", err);
        deps.onError?.("自动生成启动失败，请在画布中手动操作");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.ready]);
}
