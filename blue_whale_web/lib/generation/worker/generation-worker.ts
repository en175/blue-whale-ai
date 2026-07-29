import type { WorkerRepo } from "@blue-whale/persistence";
import type { AssetUploadStorage } from "../../assets/handle-upload";

import { ImageProviderError, type ImageProvider } from "./image-provider";
import { VideoProviderError, type VideoProvider } from "./video-provider";

type WorkerDeps = {
  repo: WorkerRepo;
  provider: ImageProvider;
  videoProvider?: VideoProvider;
  workerId: string;
  fetchImpl?: typeof fetch;
  mediaStorage?: Pick<AssetUploadStorage, "prepareUpload" | "makePublic"> | null;
};

/** 生成 worker：认领一个 queued 任务 → 调 provider 出图 → 建素材 → 结任务 → 结算。
 *  返回处理的 jobId，无任务返回 null。纯编排，provider/repo 注入，可单测。 */
export async function processNextJob(deps: WorkerDeps): Promise<string | null> {
  const { repo, workerId } = deps;
  const job = await repo.claimNextJob(workerId);
  if (!job) return null;

  return processClaimedJob(job, deps);
}

/** 用请求携带的 sk token 执行刚创建的精确任务，避免跨用户领取后错扣 quota。 */
export async function processJob(
  deps: WorkerDeps & {
    jobId: string;
    userId: string;
  },
): Promise<string | null> {
  const { repo, workerId, jobId, userId } = deps;
  const job = await repo.claimJobById(jobId, userId, workerId);
  if (!job) return null;

  return processClaimedJob(job, deps);
}

async function processClaimedJob(
  job: NonNullable<Awaited<ReturnType<WorkerRepo["claimNextJob"]>>>,
  deps: WorkerDeps,
): Promise<string> {
  const {
    repo,
    provider,
    videoProvider,
    fetchImpl = fetch,
    mediaStorage,
  } = deps;
  if (job.type !== "image" && job.type !== "video") {
    await repo.failJob(job.id, "unsupported_type", `暂不支持类型: ${job.type}`);
    return job.id;
  }

  const input = job.input ?? {};
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const modelId = typeof input.model_id === "string" ? input.model_id : "";
  if (!prompt || !modelId) {
    await repo.failJob(job.id, "invalid_input", "缺少 prompt 或 model_id");
    return job.id;
  }

  const referenceIds = Array.isArray(input.reference_asset_ids)
    ? input.reference_asset_ids
        .filter(
          (id): id is string | number =>
            typeof id === "string" || typeof id === "number",
        )
        .map(String)
    : [];
  if (referenceIds.length > 1) {
    await repo.failJob(job.id, "unsupported_input", "当前模型仅支持一张参考图");
    return job.id;
  }
  const sourceAssets =
    referenceIds.length > 0
      ? await repo.resolveInputAssets(referenceIds, job.user_id, job.project_id)
      : [];
  if (
    sourceAssets.length !== referenceIds.length ||
    sourceAssets.some((asset) => asset.type !== "image")
  ) {
    await repo.failJob(job.id, "unsupported_input", "参考素材不存在或无权访问");
    return job.id;
  }

  try {
    if (job.type === "video") {
      if (!videoProvider) {
        await repo.failJob(job.id, "provider_config", "视频 provider 未配置");
        return job.id;
      }
      const resolution =
        typeof input.resolution === "string" ? input.resolution : "";
      const ratio =
        typeof input.aspect_ratio === "string" ? input.aspect_ratio : "";
      const dimensions = videoDimensions(resolution, ratio);
      const duration = Number(input.duration);
      if (!dimensions || !Number.isFinite(duration) || duration <= 0) {
        await repo.failJob(job.id, "invalid_input", "视频尺寸或时长无效");
        return job.id;
      }
      const video = await videoProvider.generate({
        model: modelId,
        prompt,
        duration,
        width: dimensions.width,
        height: dimensions.height,
        resolution,
        ratio,
        ...(sourceAssets[0] ? { image: sourceAssets[0].url } : {}),
      });
      const storedVideo = await persistProviderMedia(
        video.url,
        "video",
        job.user_id,
        mediaStorage,
        fetchImpl,
      );
      const assetId = await repo.createAsset({
        user_id: job.user_id,
        project_id: job.project_id,
        generation_job_id: job.id,
        url: storedVideo.url,
        type: "video",
        width: video.width,
        height: video.height,
        storage_key: storedVideo.storageKey,
        mime: storedVideo.mime,
        size: storedVideo.size,
      });
      await finishJob(repo, job.id, [assetId]);
      return job.id;
    }

    const sizeId = typeof input.size === "string" ? input.size : null;
    const cap = await repo.findImageCapability(modelId, sizeId);
    if (!cap) {
      await repo.failJob(
        job.id,
        "model_unavailable",
        `未开通或不受支持的模型: ${modelId}`,
      );
      return job.id;
    }
    const n = Math.max(1, Math.min(4, job.expected_output_count || 1));
    const source = sourceAssets[0];
    let sourceImage;
    if (source) {
      const response = await fetchImpl(source.url);
      if (!response.ok) {
        throw new ImageProviderError("unsupported_input", "参考图片读取失败");
      }
      const blob = await response.blob();
      sourceImage = {
        blob,
        fileName: `asset-${source.id}.${imageExtension(source.mime ?? blob.type)}`,
      };
    }
    const images = await provider.generate({
      model: cap.model_id,
      prompt,
      size: cap.api_size,
      n,
      webSearch: input.web_search === true,
      width: cap.width,
      height: cap.height,
      ...(sourceImage ? { sourceImage } : {}),
    });
    if (images.length === 0) {
      await repo.failJob(job.id, "no_result", "生成服务未返回结果");
      return job.id;
    }
    const assetIds: string[] = [];
    for (const img of images) {
      const storedImage = await persistProviderMedia(
        img.url,
        "image",
        job.user_id,
        mediaStorage,
        fetchImpl,
      );
      const id = await repo.createAsset({
        user_id: job.user_id,
        project_id: job.project_id,
        generation_job_id: job.id,
        url: storedImage.url,
        type: "image",
        width: img.width,
        height: img.height,
        storage_key: storedImage.storageKey,
        mime: storedImage.mime,
        size: storedImage.size,
      });
      assetIds.push(id);
    }
    await finishJob(repo, job.id, assetIds);
    return job.id;
  } catch (e) {
    const code =
      e instanceof ImageProviderError || e instanceof VideoProviderError
        ? e.code
        : "provider_failed";
    const msg = e instanceof Error ? e.message : "unknown";
    await repo.failJob(job.id, code, msg);
    return job.id;
  }
}

async function persistProviderMedia(
  sourceUrl: string,
  type: "image" | "video",
  userId: string,
  storage:
    | Pick<AssetUploadStorage, "prepareUpload" | "makePublic">
    | null
    | undefined,
  fetchImpl: typeof fetch,
): Promise<{
  url: string;
  storageKey: string | null;
  mime: string | null;
  size: number | null;
}> {
  if (!storage) {
    return { url: sourceUrl, storageKey: null, mime: null, size: null };
  }

  const source = await fetchImpl(sourceUrl);
  if (!source.ok) throw new Error(`生成结果下载失败: ${source.status}`);
  const mime =
    source.headers.get("content-type")?.split(";", 1)[0]?.trim() ||
    (type === "image" ? "image/png" : "video/mp4");
  if (!mime.startsWith(`${type}/`)) {
    throw new Error("生成结果媒体类型不匹配");
  }
  const content = new Uint8Array(await source.arrayBuffer());
  if (content.byteLength === 0) throw new Error("生成结果为空");

  const prepared = await storage.prepareUpload({ userId, type, mime });
  const uploaded = await fetchImpl(prepared.uploadUrl, {
    method: "PUT",
    headers: prepared.headers,
    body: new Uint8Array(content).slice(),
  });
  if (!uploaded.ok) throw new Error(`生成结果转存失败: ${uploaded.status}`);
  await storage.makePublic(prepared.storageKey);

  return {
    url: prepared.publicUrl,
    storageKey: prepared.storageKey,
    mime,
    size: content.byteLength,
  };
}

async function finishJob(
  repo: WorkerRepo,
  jobId: string,
  assetIds: string[],
): Promise<void> {
  await repo.completeJob(jobId, assetIds);
  await repo.settleReservation(jobId);
  await repo.appendLog(
    jobId,
    "succeeded",
    "succeeded",
    `产出 ${assetIds.length} 个素材`,
    { asset_ids: assetIds },
  );
}

function imageExtension(mime: string): string {
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

function videoDimensions(
  resolution: unknown,
  aspectRatio: unknown,
): { width: number; height: number } | null {
  if (typeof resolution !== "string" || typeof aspectRatio !== "string") {
    return null;
  }
  const height = Number(/^([0-9]+)p$/.exec(resolution)?.[1]);
  const ratio = /^([1-9][0-9]*):([1-9][0-9]*)$/.exec(aspectRatio);
  if (!Number.isFinite(height) || height <= 0 || !ratio) return null;
  const width =
    Math.round((height * Number(ratio[1])) / Number(ratio[2]) / 2) * 2;
  return { width, height };
}
