"use client";
/**
 * useCanvasGeneration —— 画布生成业务 hook（ADR-0027 / openspec canvas-generation-hook）。
 *
 * 封装 generate（image/video/audio 3 路径）+ generateFromNode（toolbar 生成）+ useVideoJobs 内聚
 * + setNodeAsset + buildImageStreamHandlers + startVideoJob。page 退化为薄编排，不接触 job 管理。
 *
 * 分层：useCanvasDoc（L4 数据层，纯 RF state+persist）→ useCanvasGeneration（L3 业务层，本 hook）
 *       → useCanvasStore（缓存层 assets）→ page（L5 编排，UI + 调本 hook）。
 *
 * recover / hydrate（刷新后恢复）属 P2，本 hook 后续扩展；当前 page 仍持有 recoverProcessingJobs。
 *
 * 决策见 docs/adr/0027-canvas-generation-hook-hydrate.md；规格见 openspec/changes/canvas-generation-hook/。
 */
import { useCallback, useState } from "react";
import type { CanvasNode, CanvasNodeData, CanvasEdge, NodeKindId, MediaKind, NodeRecipe, RecipeInput, Asset } from "../model";
import type { GenerateArgs } from "../types";
import { generateImage, createVideoJob, generateAudio, getImageModels, getVideoModels, streamJob, listJobs } from "../api/generation";
import { useVideoJobs } from "./useVideoJobs";
import { buildGenerationRecipe, resolveInputs, toRecipeInputs } from "../engine";
import { nodeKinds } from "../kinds";
import { parseAspectRatio } from "../aspectRatio";
import { jobToV2Placeholder } from "../v2/mappers";

function parseQuantity(q: string): number {
  const n = parseInt(q, 10);
  return Number.isNaN(n) ? 1 : n;
}

function userFriendlyErrorMessage(e: unknown): string {
  if (!(e instanceof Error)) return "生成失败，请稍后重试";
  const msg = e.message;
  if (msg.includes("后端未启动") || msg.includes("无法连接")) return "无法连接到服务，请检查网络或稍后重试";
  if (msg.includes("ARK_API_KEY") || msg.includes("数据库")) return "服务暂时不可用，请稍后重试";
  return "生成失败，请稍后重试";
}

export type UseCanvasGenerationDeps = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  assets: Record<string, Asset>;
  /** 建占位节点（含 placement，page 注入——位置是 UI 编排，不属生成业务）。 */
  addNode: (kind: NodeKindId, extra?: { id?: string; width?: number; height?: number; data?: Partial<CanvasNodeData> }) => string;
  patchNode: (id: string, patch: Partial<CanvasNodeData>) => void;
  addAsset: (asset: { id: string; kind: MediaKind; src?: string; source?: "generated" | "uploaded" }) => void;
  ensureAsset: (assetId: string) => Promise<void>;
  projectId: string;
};

export function useCanvasGeneration(deps: UseCanvasGenerationDeps) {
  const { nodes, edges, assets, addNode, patchNode, addAsset, ensureAsset, projectId } = deps;
  const videoJobs = useVideoJobs();
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // 出图：注册 asset + 节点 assetId 引用 + status=done（assetId 全链路 String）；recipe 随生成冻结写回
  const setNodeAsset = useCallback(
    (nodeId: string, assetId: string, kind: MediaKind, src: string, source: "generated" | "uploaded" = "generated", recipe?: NodeRecipe) => {
      addAsset({ id: assetId, kind, src, source });
      patchNode(nodeId, recipe ? { assetId, status: "done", recipe } : { assetId, status: "done" });
    },
    [addAsset, patchNode],
  );

  // 视频 job 编排：nodeId 闭包注入 useVideoJobs 回调。recipe 已在节点（创建即写），
  // 此处只按 job 生命周期更新 progress / 写 assetId / 报错——多视频可并发。
  const startVideoJob = useCallback(
    (nodeId: string, jobId: number) => {
      videoJobs.start(jobId, {
        onProgress: (progress) => patchNode(nodeId, { progress }),
        onSucceeded: ({ assetId, assetUrl }) => setNodeAsset(nodeId, assetId, "video", assetUrl, "generated"),
        onFailed: (message) => {
          patchNode(nodeId, { status: "error", errorMessage: message });
          setGenerateError(message);
        },
      });
    },
    [videoJobs, patchNode, setNodeAsset],
  );

  const buildImageStreamHandlers = useCallback(
    (placeholderId: string, content: string, w: number, h: number, onSettled?: () => void, recipe?: NodeRecipe) => ({
      onImage: (url: string, assetId: number, imageIndex: number) => {
        if (imageIndex === 0) {
          setNodeAsset(placeholderId, String(assetId), "image", url, "generated", recipe);
        } else {
          const aid = String(assetId);
          addAsset({ id: aid, kind: "image", src: url, source: "generated" });
          addNode("image", { width: w, height: h, data: { content, status: "done", assetId: aid, recipe } });
        }
      },
      onImageFailed: (imageIndex: number, _code?: string, message?: string) => {
        addNode("image", { width: w, height: h, data: { content: `第 ${imageIndex + 1} 张`, status: "error", errorMessage: message || "该张生成失败" } });
      },
      onDone: () => {
        const ph = nodes.find((n) => n.id === placeholderId);
        if (ph && ph.data.status === "running") patchNode(placeholderId, { status: "error", errorMessage: "未生成任何图片" });
        onSettled?.();
      },
      onError: (message: string) => {
        patchNode(placeholderId, { status: "error", errorMessage: message });
        setGenerateError(message);
        onSettled?.();
      },
    }),
    [addNode, setNodeAsset, addAsset, patchNode, nodes],
  );

  // Dock 生成：image（流式/非流式）/ video（createVideoJob + 后台轮询）/ audio（mock）
  const generate = useCallback(
    async (promptText: string, args: GenerateArgs) => {
      const trimmed = promptText.trim();
      if (!trimmed || !projectId) return;
      setGenerating(true);
      setGenerateError(null);
      let placeholderId: string | null = null;
      try {
        if (args.mode === "image") {
          const ar = parseAspectRatio(args.settings.aspectRatio.id);
          const referenceImages = args.referenceImages ?? [];
          const imageRefs: RecipeInput[] = referenceImages.map((u) => ({ kind: "image", url: u }));
          const imageRecipe = buildGenerationRecipe({ mediaKind: "image", model: args.settings.model.id, params: { aspectRatio: args.settings.aspectRatio.id, resolution: args.settings.resolution.id, quantity: parseQuantity(args.settings.quantity) }, inputs: { prompt: { kind: "text", text: trimmed }, references: imageRefs.length ? imageRefs : undefined } });
          placeholderId = addNode("image", { width: ar.width, height: ar.height, data: { content: trimmed, status: "running" } });
          const result = await generateImage({ prompt: trimmed, projectId: Number(projectId), modelId: args.settings.model.id, sizeId: args.settings.resolution.id, aspectRatio: args.settings.aspectRatio.id, quantity: parseQuantity(args.settings.quantity), referenceImages });
          if (result.stream && result.jobId != null) {
            streamJob(result.jobId, buildImageStreamHandlers(placeholderId, trimmed, ar.width, ar.height, () => setGenerating(false), imageRecipe));
          } else {
            if (result.url && result.assetId != null) {
              setNodeAsset(placeholderId, String(result.assetId), "image", result.url, "generated", imageRecipe);
            } else {
              patchNode(placeholderId, { status: "error", errorMessage: "未返回图片" });
            }
            setGenerating(false);
          }
        } else if (args.mode === "video") {
          const result = await createVideoJob({ prompt: trimmed, projectId: Number(projectId), modelId: args.settings.model.id, resolution: args.settings.resolution.id, aspectRatio: args.settings.aspectRatio.id, duration: args.settings.duration, firstFrameUrl: args.settings.firstFrameUrl, lastFrameUrl: args.settings.lastFrameUrl, referenceImages: args.settings.referenceImages, referenceVideos: args.settings.referenceVideos, referenceAudios: args.settings.referenceAudios });
          const ar = parseAspectRatio(args.settings.aspectRatio.id);
          const vidRefs: RecipeInput[] = [
            ...(args.settings.referenceImages?.map((u) => ({ kind: "image" as const, url: u })) ?? []),
            ...(args.settings.referenceVideos?.map((u) => ({ kind: "video" as const, url: u })) ?? []),
            ...(args.settings.referenceAudios?.map((u) => ({ kind: "audio" as const, url: u })) ?? []),
          ];
          const videoRecipe = buildGenerationRecipe({ mediaKind: "video", model: args.settings.model.id, params: { aspectRatio: args.settings.aspectRatio.id, resolution: args.settings.resolution.id, duration: args.settings.duration, refMode: args.settings.refMode.id }, inputs: { prompt: { kind: "text", text: trimmed }, firstFrame: args.settings.firstFrameUrl ? { kind: "image", url: args.settings.firstFrameUrl } : undefined, lastFrame: args.settings.lastFrameUrl ? { kind: "image", url: args.settings.lastFrameUrl } : undefined, references: vidRefs.length ? vidRefs : undefined } });
          placeholderId = addNode("video", { width: ar.width, height: ar.height, data: { content: trimmed, status: "running", progress: 0, recipe: videoRecipe, taskId: String(result.jobId) } });
          startVideoJob(placeholderId, result.jobId);
          setGenerating(false); // 视频转后台轮询，不阻塞后续并发生成
        } else if (args.mode === "audio") {
          // 音频生成（IJZXW7-B）：generateAudio 当前 mock（后端无音频 provider），就绪切真不改签名
          placeholderId = addNode("audio", { width: 240, height: 120, data: { content: trimmed, status: "running" } });
          const result = await generateAudio({ prompt: trimmed, projectId: Number(projectId), modelId: args.settings.model.id, duration: args.settings.duration, sampleRate: args.settings.sampleRate, format: args.settings.format.id });
          const audioRecipe = buildGenerationRecipe({ mediaKind: "audio", model: args.settings.model.id, params: { duration: args.settings.duration, sampleRate: args.settings.sampleRate, format: args.settings.format.id }, inputs: { prompt: { kind: "text", text: trimmed } } });
          setNodeAsset(placeholderId, String(result.assetId), "audio", result.url, "generated", audioRecipe);
          setGenerating(false);
        }
      } catch (e) {
        if (placeholderId && args.mode === "image") patchNode(placeholderId, { status: "error", errorMessage: userFriendlyErrorMessage(e) });
        setGenerateError(userFriendlyErrorMessage(e));
        setGenerating(false);
      }
    },
    [addNode, patchNode, setNodeAsset, buildImageStreamHandlers, startVideoJob, projectId],
  );

  // 节点 toolbar「生成」：resolveInputs 取上游 text prompt（连线驱动）→ 默认 model 生成（image 非流式 / video 轮询）
  const generateFromNode = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || (node.data.kind !== "image" && node.data.kind !== "video")) return;
      const inputs = resolveInputs(node, nodes, edges, assets);
      const task = nodeKinds[node.data.kind].buildTask(node, inputs);
      const recipeInputs = toRecipeInputs(node, nodes, edges, assets);
      const prompt = task.prompt?.trim();
      if (!prompt) {
        setGenerateError("请先连一个文本节点作 prompt");
        return;
      }
      setGenerating(true);
      setGenerateError(null);
      try {
        if (node.data.kind === "image") {
          const models = await getImageModels();
          const model = models[0];
          if (!model) throw new Error("无可用图片模型");
          patchNode(nodeId, { status: "running" });
          const result = await generateImage({ prompt, projectId: Number(projectId), modelId: model.modelId, sizeId: model.defaultSize, aspectRatio: model.defaultAspectRatio, quantity: 1 });
          if (result.url && result.assetId != null) {
            const recipe = buildGenerationRecipe({ mediaKind: "image", model: model.modelId, params: { aspectRatio: model.defaultAspectRatio, resolution: model.defaultSize, quantity: 1 }, inputs: recipeInputs });
            setNodeAsset(nodeId, String(result.assetId), "image", result.url, "generated", recipe);
          } else patchNode(nodeId, { status: "error", errorMessage: "未返回图片" });
          setGenerating(false);
        } else {
          // video：createVideoJob → recipe 创建即写节点 → startVideoJob per-job 轮询（并发安全）
          const models = await getVideoModels();
          const model = models[0];
          const videoRecipe = buildGenerationRecipe({ mediaKind: "video", model: model?.modelId ?? "", params: { aspectRatio: model?.defaultAspectRatio ?? "16:9", resolution: model?.defaultResolution ?? "1080p", duration: model?.defaultDuration ?? 5, refMode: "none" }, inputs: recipeInputs });
          patchNode(nodeId, { status: "running", progress: 0, recipe: videoRecipe });
          const result = await createVideoJob({ prompt, projectId: Number(projectId), modelId: model?.modelId, resolution: model?.defaultResolution, aspectRatio: model?.defaultAspectRatio, duration: model?.defaultDuration ?? 5, firstFrameUrl: task.firstFrame?.src });
          patchNode(nodeId, { taskId: String(result.jobId) }); // 关联 job：刷新后 recover 按 taskId 续轮询（不靠节点 id）
          startVideoJob(nodeId, result.jobId);
          setGenerating(false); // 视频转后台轮询，不阻塞后续并发生成
        }
      } catch (e) {
        patchNode(nodeId, { status: "error", errorMessage: userFriendlyErrorMessage(e) });
        setGenerateError(userFriendlyErrorMessage(e));
        setGenerating(false);
      }
    },
    [nodes, edges, assets, projectId, patchNode, setNodeAsset, startVideoJob],
  );

  // 刷新恢复（P2 byTaskId）：listJobs(processing) → by taskId 匹配已持久节点。
  // existing → 恢复 status=running + 续轮询（serialize 不持久 status，刷新后丢）；不存在 → 建 job-{jobId} 占位 + taskId。
  const recover = useCallback(
    async (existingNodes: CanvasNode[]) => {
      try {
        // taskId → 节点映射：生成时 persist taskId 的节点，刷新后按 taskId 续轮询（不重建、不卡）
        const byTaskId = new Map<string, CanvasNode>();
        for (const n of existingNodes) {
          const tid = n.data.taskId;
          if (tid) byTaskId.set(tid, n);
        }
        const jobs = await listJobs({ projectId: Number(projectId), status: "processing", size: 50 });
        for (const job of jobs) {
          const jobKey = String(job.jobId);
          const existing = byTaskId.get(jobKey);
          if (existing) {
            // 节点已 load（生成时建 + taskId 持久）→ 恢复 loading 态 + 续轮询（serialize 不持久化 status，刷新后丢）
            patchNode(existing.id, { status: "running", progress: 0 });
            if (existing.data.kind === "video") startVideoJob(existing.id, job.jobId);
            else streamJob(job.jobId, buildImageStreamHandlers(existing.id, String(existing.data.content ?? ""), existing.width ?? 356, existing.height ?? 200));
            continue;
          }
          // 不存在（老数据无 taskId / 来源不明）→ 建 job-{jobId} 占位 + taskId + 续轮询
          const ph = jobToV2Placeholder(job);
          const input = (job.input ?? {}) as { prompt?: string; aspectRatio?: string; resolution?: string; duration?: number; refMode?: string };
          if (ph.kind === "video") {
            // recover recipe（best-effort 从 job.input 重建；model 字段 JobListItem 暂无，留空待后端补）→ 创建即写节点
            const recoverRecipe = buildGenerationRecipe({ mediaKind: "video", model: "", params: { aspectRatio: input.aspectRatio ?? "16:9", resolution: input.resolution ?? "720p", duration: input.duration ?? 5, refMode: input.refMode ?? "omni" }, inputs: { prompt: { kind: "text", text: input.prompt ?? "" } } });
            addNode(ph.kind, { id: ph.id, width: ph.width, height: ph.height, data: { ...ph.data, recipe: recoverRecipe, taskId: jobKey } });
            startVideoJob(ph.id, job.jobId); // per-job 独立轮询：多个 processing 视频并发 recover
          } else {
            addNode(ph.kind, { id: ph.id, width: ph.width, height: ph.height, data: { ...ph.data, taskId: jobKey } });
            streamJob(job.jobId, buildImageStreamHandlers(ph.id, ph.data.content ?? "", ph.width, ph.height));
          }
        }
      } catch (e) {
        console.warn("[canvas-v2] recover processing jobs failed:", e);
      }
    },
    [addNode, patchNode, startVideoJob, buildImageStreamHandlers, projectId],
  );

  // reconcile（P2）：listJobs(succeeded) → 有 taskId 但无 assetId 的节点写 assetId/done。
  // 防 succeeded 回调没跑（如关页面时 onSucceeded 没触发）节点永卡 running。
  const reconcile = useCallback(
    async (existingNodes: CanvasNode[]) => {
      try {
        const byTaskId = new Map<string, CanvasNode>();
        for (const n of existingNodes) {
          if (n.data.taskId && !n.data.assetId) byTaskId.set(n.data.taskId, n);
        }
        if (byTaskId.size === 0) return; // 无候选（无 taskId 或已 done）→ 跳过 listJobs
        const jobs = await listJobs({ projectId: Number(projectId), status: "succeeded", size: 50 });
        for (const job of jobs) {
          const node = byTaskId.get(String(job.jobId));
          if (!node) continue;
          const asset = job.outputAssets?.[0];
          if (asset) {
            patchNode(node.id, { assetId: String(asset.id), status: "done" });
            addAsset({ id: String(asset.id), kind: node.data.kind === "video" ? "video" : "image", src: asset.url, source: "generated" });
          } else {
            patchNode(node.id, { status: "done" }); // succeeded 但无 asset，标 done 不卡
          }
        }
      } catch (e) {
        console.warn("[canvas-v2] reconcile failed:", e);
      }
    },
    [patchNode, addAsset, projectId],
  );

  // hydrate（P2 统一水合）：load 后一次完成 ① ensureAsset ② recover ③ reconcile。page 只调 hydrate(d.nodes)。
  // 取代 page load effect 手写 ensureAsset + recover 两步；reconcile 防 succeeded 回调没跑永卡。
  const hydrate = useCallback(
    async (nodes: CanvasNode[]) => {
      await Promise.all(nodes.filter((n) => n.data.assetId).map((n) => ensureAsset(n.data.assetId as string)));
      await Promise.all([recover(nodes), reconcile(nodes)]);
    },
    [ensureAsset, recover, reconcile],
  );

  return { generate, generateFromNode, recover, reconcile, hydrate, generating, generateError, setGenerateError };
}
