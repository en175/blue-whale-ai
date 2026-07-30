"use client";
/**
 * useCanvasGeneration —— 画布生成业务 hook（ADR-0027 / openspec canvas-generation-hook）。
 *
 * IK4AK6 接 Node 生成 API（取代 v2 老 Java 接口）：
 * - image/video 都走 createProjectGenerationJob（Node 全异步，无同步 url / 无 SSE stream）→ 轮询 getJobStatus。
 * - audio 仍 mock（后端无音频 provider，generateAudio 占位）。
 * - recover/reconcile 走 listJobs（Node /api/jobs，records[] + snake_case input/output_assets）。
 * - 视频参考/首尾帧 → 只提交显式角色字段；input_asset_ids 仅保留给旧客户端兼容。
 *
 * 分层：useCanvasDoc（L4 数据层，纯 RF state+persist）→ useCanvasGeneration（L3 业务层，本 hook）
 *       → useCanvasStore（缓存层 assets）→ page（L5 编排，UI + 调本 hook）。
 *
 * 决策见 docs/adr/0027-canvas-generation-hook-hydrate.md；规格见 openspec/changes/canvas-generation-hook/。
 */
import { useCallback, useState } from "react";
import type {
  CanvasNode,
  CanvasNodeData,
  CanvasEdge,
  NodeKindId,
  MediaKind,
  NodeRecipe,
  RecipeInput,
  Asset,
} from "../model";
import type { GenerateArgs } from "../types";
import {
  cancelProjectGenerationJob,
  createProjectGenerationJob,
  generateAudio,
  getImageModels,
  getVideoModels,
  listJobs,
  type CreateProjectGenerationJobPayload,
} from "../api/generation";
import { useVideoJobs } from "./useVideoJobs";
import {
  buildGenerationRecipe,
  resolveInputs,
  toRecipeInputs,
} from "../engine";
import { nodeKinds } from "../kinds";
import { parseAspectRatio } from "../aspectRatio";
import { projectRecoveryTransport } from "@/lib/project-recovery";

function parseQuantity(q: string): number {
  const n = parseInt(q, 10);
  return Number.isNaN(n) ? 1 : n;
}

function userFriendlyErrorMessage(e: unknown): string {
  if (!(e instanceof Error)) return "生成失败，请稍后重试";
  const msg = e.message;
  if (msg.includes("后端未启动") || msg.includes("无法连接"))
    return "无法连接到服务，请检查网络或稍后重试";
  if (msg.includes("ARK_API_KEY") || msg.includes("数据库"))
    return "服务暂时不可用，请稍后重试";
  return "生成失败，请稍后重试";
}

/** Idempotency-Key：每次建任务一个新 UUID（Node 去重 + 重试安全）。 */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

export type UseCanvasGenerationDeps = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  assets: Record<string, Asset>;
  /** 建占位节点（含 placement，page 注入——位置是 UI 编排，不属生成业务）。 */
  addNode: (
    kind: NodeKindId,
    extra?: {
      id?: string;
      width?: number;
      height?: number;
      data?: Partial<CanvasNodeData>;
    },
  ) => string;
  patchNode: (id: string, patch: Partial<CanvasNodeData>) => void;
  patchNodeAndSave: (
    id: string,
    patch: Partial<CanvasNodeData>,
  ) => Promise<void>;
  addAsset: (asset: {
    id: string;
    kind: MediaKind;
    src?: string;
    source?: "generated" | "uploaded";
  }) => void;
  projectId: string;
};

export function useCanvasGeneration(deps: UseCanvasGenerationDeps) {
  const {
    nodes,
    edges,
    assets,
    addNode,
    patchNode,
    patchNodeAndSave,
    addAsset,
    projectId,
  } = deps;
  const jobs = useVideoJobs(projectId); // 通用 job 轮询（image/video 共用，原名 useVideoJobs 遗留）
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [videoJob, setVideoJob] = useState<{
    id: number;
    status: string;
    error: string | null;
  } | null>(null);
  const [cancellingVideo, setCancellingVideo] = useState(false);

  // 出图：注册 asset + 节点 assetId 引用 + status=done（assetId 全链路 String）；recipe 随生成冻结写回
  const setNodeAsset = useCallback(
    (
      nodeId: string,
      assetId: string,
      kind: MediaKind,
      src: string,
      source: "generated" | "uploaded" = "generated",
      recipe?: NodeRecipe,
    ) => {
      addAsset({ id: assetId, kind, src, source });
      patchNode(
        nodeId,
        recipe
          ? { assetId, status: "done", recipe }
          : { assetId, status: "done" },
      );
    },
    [addAsset, patchNode],
  );

  /** 启动一个 Node GenerationJob 的轮询：succeeded→写 asset+done；failed→报错。image/video 通用。 */
  const startJob = useCallback(
    (
      nodeId: string,
      jobId: number,
      kind: "image" | "video",
      recipe?: NodeRecipe,
    ) => {
      if (kind === "video") {
        setVideoJob({ id: jobId, status: "processing", error: null });
      }
      jobs.start(jobId, {
        onProgress: (progress) => {
          patchNode(nodeId, { progress });
          if (kind === "video") {
            setVideoJob({ id: jobId, status: "processing", error: null });
          }
        },
        onSucceeded: ({ assetId, assetUrl }) => {
          setNodeAsset(nodeId, assetId, kind, assetUrl, "generated", recipe);
          if (kind === "video") {
            setVideoJob({ id: jobId, status: "succeeded", error: null });
          }
        },
        onFailed: (message) => {
          patchNode(nodeId, { status: "error", errorMessage: message });
          setGenerateError(message);
          if (kind === "video") {
            setVideoJob({ id: jobId, status: "failed", error: message });
          }
        },
        onCancelled: () => {
          patchNode(nodeId, {
            status: "error",
            errorMessage: "视频生成已取消",
          });
          if (kind === "video") {
            setVideoJob({ id: jobId, status: "cancelled", error: null });
          }
        },
      });
    },
    [jobs, patchNode, setNodeAsset],
  );

  // IK55VL：取消入口在画布视频卡上（面板状态条评审后移除），按节点 taskId 取消。
  const cancelVideoJob = useCallback(
    async (taskId: number) => {
      if (!projectId) return;
      setCancellingVideo(true);
      try {
        await cancelProjectGenerationJob(Number(projectId), taskId);
        setVideoJob((current) =>
          current?.id === taskId
            ? { ...current, status: "cancel_requested" }
            : current,
        );
      } catch (error) {
        const message = userFriendlyErrorMessage(error);
        setGenerateError(message);
        setVideoJob((current) =>
          current?.id === taskId ? { ...current, error: message } : current,
        );
      } finally {
        setCancellingVideo(false);
      }
    },
    [projectId],
  );

  // Dock 生成：image / video（createProjectGenerationJob + 后台轮询）/ audio（mock）
  const generate = useCallback(
    async (promptText: string, args: GenerateArgs) => {
      const trimmed = promptText.trim();
      if (!trimmed || !projectId) return;
      setGenerating(true);
      setGenerateError(null);
      let placeholderId: string | null = null;
      try {
        if (args.mode === "image") {
          const s = args.settings;
          const ar = parseAspectRatio(s.aspectRatio.id);
          const referenceImages = args.referenceImages ?? [];
          const imageRefs: RecipeInput[] = referenceImages.map((u) => ({
            kind: "image",
            url: u,
          }));
          const imageRecipe = buildGenerationRecipe({
            mediaKind: "image",
            model: s.modelId,
            params: {
              aspectRatio: s.aspectRatio.id,
              resolution: s.size,
              quantity: parseQuantity(s.quantity),
            },
            inputs: {
              prompt: { kind: "text", text: trimmed },
              references: imageRefs.length ? imageRefs : undefined,
            },
          });
          placeholderId = addNode("image", {
            width: ar.width,
            height: ar.height,
            data: { content: trimmed, status: "running", recipe: imageRecipe },
          });
          const payload: CreateProjectGenerationJobPayload = {
            type: "image",
            input_asset_ids: args.inputAssetIds ?? [],
            expected_output_count: parseQuantity(s.quantity),
            parameters: {
              prompt: trimmed,
              aspect_ratio: s.aspectRatio.id,
              model_id: s.modelId,
              size: s.size,
              web_search: s.webSearch,
              sequential_image_generation: s.sequential,
            },
          };
          const { generation_job_id } = await createProjectGenerationJob(
            Number(projectId),
            payload,
            newIdempotencyKey(),
          );
          await patchNodeAndSave(placeholderId, {
            taskId: String(generation_job_id),
          });
          startJob(placeholderId, generation_job_id, "image", imageRecipe);
          setGenerating(false); // 转后台轮询，不阻塞并发生成
        } else if (args.mode === "video") {
          const s = args.settings;
          const ar = parseAspectRatio(s.aspectRatio.id);
          const vidRefs: RecipeInput[] =
            s.referenceMedia?.map((reference) => ({
              kind: reference.kind,
              url: reference.url,
              ...(reference.assetId ? { assetId: reference.assetId } : {}),
            })) ?? [];
          const videoRecipe = buildGenerationRecipe({
            mediaKind: "video",
            model: s.model.id,
            params: {
              aspectRatio: s.aspectRatio.id,
              resolution: s.resolution.id,
              duration: s.duration,
              refMode: s.refMode.id,
            },
            inputs: {
              prompt: { kind: "text", text: trimmed },
              firstFrame: s.firstFrameUrl
                ? {
                    kind: "image",
                    url: s.firstFrameUrl,
                    ...(args.firstFrameAssetId !== undefined
                      ? { assetId: String(args.firstFrameAssetId) }
                      : {}),
                  }
                : undefined,
              lastFrame: s.lastFrameUrl
                ? {
                    kind: "image",
                    url: s.lastFrameUrl,
                    ...(args.lastFrameAssetId !== undefined
                      ? { assetId: String(args.lastFrameAssetId) }
                      : {}),
                  }
                : undefined,
              references: vidRefs.length ? vidRefs : undefined,
            },
          });
          placeholderId = addNode("video", {
            width: ar.width,
            height: ar.height,
            data: {
              content: trimmed,
              status: "running",
              progress: 0,
              recipe: videoRecipe,
            },
          });
          const payload: CreateProjectGenerationJobPayload = {
            type: "video",
            expected_output_count: parseQuantity(s.quantity),
            parameters: {
              prompt: trimmed,
              model_id: s.model.id,
              aspect_ratio: s.aspectRatio.id,
              resolution: s.resolution.id,
              duration: s.duration,
            },
            ...(args.firstFrameAssetId !== undefined
              ? { first_frame_asset_id: args.firstFrameAssetId }
              : {}),
            ...(args.lastFrameAssetId !== undefined
              ? { last_frame_asset_id: args.lastFrameAssetId }
              : {}),
            ...(args.referenceAssetIds?.length
              ? { reference_asset_ids: args.referenceAssetIds }
              : {}),
          };
          const { generation_job_id } = await createProjectGenerationJob(
            Number(projectId),
            payload,
            newIdempotencyKey(),
          );
          await patchNodeAndSave(placeholderId, {
            taskId: String(generation_job_id),
          });
          startJob(placeholderId, generation_job_id, "video", videoRecipe);
          setGenerating(false);
        } else if (args.mode === "audio") {
          // 音频生成（IK55VM）：generateAudio 当前 mock（后端无音频 provider），就绪切真不改签名
          const s = args.settings;
          const count = s.quantity ? parseQuantity(s.quantity) : 1;
          const referenceAssetIds = s.references
            ?.map((r) => Number(r.assetId))
            .filter((n) => Number.isSafeInteger(n) && n > 0);
          const audioRecipe = buildGenerationRecipe({
            mediaKind: "audio",
            model: s.model.id,
            params: {
              mode: s.mode,
              lyrics: s.lyrics,
              instrumental: s.instrumental,
              quantity: count,
            },
            inputs: {
              prompt: { kind: "text", text: trimmed },
              ...(s.references?.length
                ? {
                    references: s.references.map((r) => ({
                      kind: r.kind,
                      assetId: r.assetId,
                      url: r.url,
                    })),
                  }
                : {}),
            },
          });
          // 数量选择（1x 起）：mock 逐张落卡（真接口就绪后由 job 多产物取代）
          for (let i = 0; i < count; i++) {
            placeholderId = addNode("audio", {
              width: 240,
              height: 120,
              data: { content: trimmed, status: "running" },
            });
            const result = await generateAudio({
              prompt: trimmed,
              projectId: Number(projectId),
              mode: s.mode,
              modelId: s.model.id,
              lyrics: s.lyrics,
              instrumental: s.instrumental,
              quantity: count,
              referenceAssetIds,
            });
            setNodeAsset(
              placeholderId,
              String(result.assetId),
              "audio",
              result.url,
              "generated",
              audioRecipe,
            );
          }
          setGenerating(false);
        }
      } catch (e) {
        if (placeholderId)
          patchNode(placeholderId, {
            status: "error",
            errorMessage: userFriendlyErrorMessage(e),
          });
        setGenerateError(userFriendlyErrorMessage(e));
        setGenerating(false);
      }
    },
    [addNode, patchNode, patchNodeAndSave, setNodeAsset, startJob, projectId],
  );

  // 节点 toolbar「生成」：resolveInputs 取上游 text prompt（连线驱动）→ 默认 model 生成（image/video 均轮询）
  const generateFromNode = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || (node.data.kind !== "image" && node.data.kind !== "video"))
        return;
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
          const recipe = buildGenerationRecipe({
            mediaKind: "image",
            model: model.model_id,
            params: {
              aspectRatio: model.default_aspect_ratio,
              resolution: model.default_size,
              quantity: 1,
            },
            inputs: recipeInputs,
          });
          patchNode(nodeId, { status: "running", recipe });
          const payload: CreateProjectGenerationJobPayload = {
            type: "image",
            input_asset_ids: [],
            expected_output_count: 1,
            parameters: {
              prompt,
              aspect_ratio: model.default_aspect_ratio,
              model_id: model.model_id,
              size: model.default_size,
              web_search: false,
              sequential_image_generation: false,
            },
          };
          const { generation_job_id } = await createProjectGenerationJob(
            Number(projectId),
            payload,
            newIdempotencyKey(),
          );
          await patchNodeAndSave(nodeId, { taskId: String(generation_job_id) });
          startJob(nodeId, generation_job_id, "image", recipe);
          setGenerating(false);
        } else {
          // video：默认 model（后端 ModelCapabilityView 共用 shape，default_size 即分辨率）→ createProjectGenerationJob → 轮询
          const models = await getVideoModels();
          const model = models[0];
          if (!model) throw new Error("无可用视频模型");
          const aspectRatio = model?.default_aspect_ratio ?? "16:9";
          const resolution = model?.default_size ?? "1080p";
          const duration = 5;
          const videoRecipe = buildGenerationRecipe({
            mediaKind: "video",
            model: model.model_id,
            params: { aspectRatio, resolution, duration, refMode: "none" },
            inputs: recipeInputs,
          });
          patchNode(nodeId, {
            status: "running",
            progress: 0,
            recipe: videoRecipe,
          });
          const payload: CreateProjectGenerationJobPayload = {
            type: "video",
            expected_output_count: 1,
            parameters: {
              prompt,
              model_id: model.model_id,
              aspect_ratio: aspectRatio,
              resolution,
              duration,
            },
          };
          const { generation_job_id } = await createProjectGenerationJob(
            Number(projectId),
            payload,
            newIdempotencyKey(),
          );
          await patchNodeAndSave(nodeId, { taskId: String(generation_job_id) });
          startJob(nodeId, generation_job_id, "video", videoRecipe);
          setGenerating(false);
        }
      } catch (e) {
        patchNode(nodeId, {
          status: "error",
          errorMessage: userFriendlyErrorMessage(e),
        });
        setGenerateError(userFriendlyErrorMessage(e));
        setGenerating(false);
      }
    },
    [nodes, edges, assets, projectId, patchNode, patchNodeAndSave, startJob],
  );

  // recover（刷新恢复）：独立 Worker 接管前是 queued、接管后是 processing；两种都按 taskId 续轮询。
  // MVP 仅恢复已知 taskId 节点（serialize 持久 taskId）；孤儿 processing（无对应节点）不重建占位——
  // v2 清表后无老数据；重建占位待 job.input 形状稳定后再做。
  const recover = useCallback(
    async (existingNodes: CanvasNode[]) => {
      try {
        const byTaskId = new Map<string, CanvasNode>();
        for (const n of existingNodes) {
          const tid = n.data.taskId;
          if (tid) byTaskId.set(tid, n);
        }
        if (byTaskId.size === 0) return; // 无持久 taskId → 跳过 listJobs
        const [queued, processing, failed] = await Promise.all([
          listJobs({
            projectId: Number(projectId),
            status: "queued",
            size: 50,
          }),
          listJobs({
            projectId: Number(projectId),
            status: "processing",
            size: 50,
          }),
          listJobs({
            projectId: Number(projectId),
            status: "failed",
            size: 50,
          }),
        ]);
        const activeJobs = new Map(
          [...queued, ...processing].map((job) => [job.job_id, job]),
        );
        for (const job of activeJobs.values()) {
          const existing = byTaskId.get(job.job_id);
          if (!existing) continue;
          patchNode(existing.id, { status: "running", progress: 0 });
          startJob(
            existing.id,
            Number(job.job_id),
            existing.data.kind === "video" ? "video" : "image",
          );
        }
        for (const job of failed) {
          const existing = byTaskId.get(job.job_id);
          if (!existing) continue;
          patchNode(existing.id, { status: "error", errorMessage: "生成失败" });
        }
      } catch (e) {
        console.warn("[canvas-v2] recover processing jobs failed:", e);
      }
    },
    [patchNode, startJob, projectId],
  );

  // reconcile：listJobs(succeeded) → 有 taskId 但无 assetId 的节点写 assetId/done。
  // 防 succeeded 回调没跑（如关页面时 onSucceeded 没触发）节点永卡 running。
  const reconcile = useCallback(
    async (existingNodes: CanvasNode[]) => {
      try {
        const byTaskId = new Map<string, CanvasNode>();
        for (const n of existingNodes) {
          if (n.data.taskId && !n.data.assetId) byTaskId.set(n.data.taskId, n);
        }
        if (byTaskId.size === 0) return;
        const list = await listJobs({
          projectId: Number(projectId),
          status: "succeeded",
          size: 50,
        });
        for (const job of list) {
          const node = byTaskId.get(job.job_id);
          if (!node) continue;
          const asset = job.output_assets?.[0];
          if (asset) {
            patchNode(node.id, { assetId: String(asset.id), status: "done" });
            addAsset({
              id: String(asset.id),
              kind: node.data.kind === "video" ? "video" : "image",
              src: asset.url,
              source: "generated",
            });
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

  // hydrate（统一水合）：一次项目 snapshot 批量注册全部素材，再恢复/收敛任务状态。
  const hydrate = useCallback(
    async (ns: CanvasNode[]) => {
      const snapshot = await projectRecoveryTransport.loadSnapshot(
        Number(projectId),
        new AbortController().signal,
      );
      for (const asset of Object.values(snapshot.assets)) {
        addAsset({
          id: String(asset.asset_id),
          kind: asset.type as Asset["kind"],
          src: asset.access_url,
        });
      }
      await Promise.all([recover(ns), reconcile(ns)]);
    },
    [addAsset, projectId, recover, reconcile],
  );

  return {
    generate,
    generateFromNode,
    recover,
    reconcile,
    hydrate,
    generating,
    generateError,
    setGenerateError,
    videoJobStatus: videoJob?.status ?? null,
    videoJobError: videoJob?.error ?? null,
    cancelVideoJob,
    cancellingVideo,
  };
}
