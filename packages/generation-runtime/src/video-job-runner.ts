export type VideoJobClaim = {
  id: string;
  projectId: string;
  userId: string;
  input: Record<string, unknown>;
  providerTaskId: string | null;
  cancelRequested: boolean;
  workerId: string;
  fencingToken: number;
};

export type VideoWorkerInputAsset = {
  id: string;
  type: string;
  url: string;
  mime?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
};

export type VideoReference = {
  type: "image" | "video";
  url: string;
};

export type StoredVideo = {
  url: string;
  storageKey: string | null;
  mime: string | null;
  size: number | null;
};

export type VideoTaskObservation = {
  status: "queued" | "processing" | "succeeded" | "failed";
  progress: number;
  url: string | null;
  error: { code: string; message: string } | null;
};

export interface VideoTaskProvider {
  submit(input: {
    model: string;
    prompt: string;
    duration: number;
    width: number;
    height: number;
    resolution: string;
    ratio: string;
    firstFrameImage?: string;
    lastFrameImage?: string;
    references: VideoReference[];
  }): Promise<{ taskId: string; status: string }>;
  poll(taskId: string): Promise<VideoTaskObservation>;
}

export interface VideoJobRunnerRepo {
  claimVideoJobById(jobId: string, workerId: string): Promise<VideoJobClaim | null>;
  claimNextVideoJob(workerId: string): Promise<VideoJobClaim | null>;
  resolveInputAssets(
    assetIds: string[],
    userId: string,
    projectId: string,
  ): Promise<VideoWorkerInputAsset[]>;
  markVideoSubmitted(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    providerTaskId: string;
  }): Promise<boolean>;
  rescheduleVideoPoll(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    progress: number;
  }): Promise<boolean>;
  publishVideoResult(input: {
    jobId: string;
    projectId: string;
    userId: string;
    workerId: string;
    fencingToken: number;
    url: string;
    storageKey: string | null;
    mime: string | null;
    size: number | null;
    width: number;
    height: number;
    duration: number;
  }): Promise<boolean>;
  failVideoJob(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    code: string;
    message: string;
  }): Promise<boolean>;
  cancelVideoBeforeDispatch(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
  }): Promise<boolean>;
}

export interface GenerationCredentialVault {
  open(ciphertext: string): string;
}

export interface VideoMediaRelay {
  persist(sourceUrl: string, userId: string): Promise<StoredVideo>;
}

class VideoInputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VideoInputError";
  }
}

export async function runVideoJobStep(deps: {
  repo: VideoJobRunnerRepo;
  workerId: string;
  jobId?: string;
  createProvider: (token: string) => VideoTaskProvider;
  credentialVault: GenerationCredentialVault;
  mediaRelay: VideoMediaRelay;
  scheduleNext?: (jobId: string, delayMs: number) => Promise<void>;
}): Promise<string | null> {
  const claim = deps.jobId
    ? await deps.repo.claimVideoJobById(deps.jobId, deps.workerId)
    : await deps.repo.claimNextVideoJob(deps.workerId);
  if (!claim) return null;

  if (claim.cancelRequested && !claim.providerTaskId) {
    await deps.repo.cancelVideoBeforeDispatch(claimIdentity(claim));
    return claim.id;
  }

  const sealedCredential = claim.input.provider_credential;
  if (typeof sealedCredential !== "string" || sealedCredential.length === 0) {
    await fail(deps.repo, claim, "provider_credential_missing", "视频任务缺少供应商凭证");
    return claim.id;
  }

  try {
    const provider = deps.createProvider(deps.credentialVault.open(sealedCredential));
    if (!claim.providerTaskId) {
      const request = await buildSubmitRequest(deps.repo, claim);
      const submitted = await provider.submit(request);
      const updated = await deps.repo.markVideoSubmitted({
        ...claimIdentity(claim),
        providerTaskId: submitted.taskId,
      });
      if (updated) await deps.scheduleNext?.(claim.id, 2_000);
      return claim.id;
    }

    const observation = await provider.poll(claim.providerTaskId);
    if (observation.status === "queued" || observation.status === "processing") {
      const updated = await deps.repo.rescheduleVideoPoll({
        ...claimIdentity(claim),
        progress: observation.progress,
      });
      if (updated) await deps.scheduleNext?.(claim.id, 2_000);
      return claim.id;
    }
    if (observation.status === "failed") {
      await fail(
        deps.repo,
        claim,
        observation.error?.code ?? "provider_failed",
        observation.error?.message ?? "视频生成失败",
      );
      return claim.id;
    }
    if (!observation.url) {
      await fail(deps.repo, claim, "provider_failed", "视频任务成功但未返回 URL");
      return claim.id;
    }

    const stored = await deps.mediaRelay.persist(observation.url, claim.userId);
    const inputParams =
      claim.input.parameters && typeof claim.input.parameters === "object"
        ? (claim.input.parameters as Record<string, unknown>)
        : null;
    const dimensions =
      videoDimensions(claim.input.resolution, claim.input.aspect_ratio) ??
      dimensionsFromSize(inputParams?.size);
    if (!dimensions) {
      await fail(deps.repo, claim, "invalid_input", "视频尺寸无效");
      return claim.id;
    }
    await deps.repo.publishVideoResult({
      ...claimIdentity(claim),
      projectId: claim.projectId,
      userId: claim.userId,
      ...stored,
      ...dimensions,
      duration: Number(claim.input.duration ?? inputParams?.duration),
    });
    return claim.id;
  } catch (error) {
    await fail(
      deps.repo,
      claim,
      error instanceof VideoInputError ? error.code : "provider_failed",
      error instanceof Error ? error.message : "视频生成失败",
    );
    return claim.id;
  }
}

function claimIdentity(claim: VideoJobClaim) {
  return {
    jobId: claim.id,
    workerId: claim.workerId,
    fencingToken: claim.fencingToken,
  };
}

async function fail(
  repo: VideoJobRunnerRepo,
  claim: VideoJobClaim,
  code: string,
  message: string,
): Promise<void> {
  await repo.failVideoJob({ ...claimIdentity(claim), code, message });
}

async function buildSubmitRequest(
  repo: VideoJobRunnerRepo,
  claim: VideoJobClaim,
): Promise<Parameters<VideoTaskProvider["submit"]>[0]> {
  // plan/scene_card 任务把参数收敛在 prompt_text + parameters.*（T11/T13 契约），
  // Dock 任务为扁平字段；两套形态在此对齐。
  const params =
    claim.input.parameters && typeof claim.input.parameters === "object"
      ? (claim.input.parameters as Record<string, unknown>)
      : null;
  const prompt =
    typeof claim.input.prompt === "string"
      ? claim.input.prompt
      : typeof claim.input.prompt_text === "string"
        ? claim.input.prompt_text
        : "";
  const model =
    typeof claim.input.model_id === "string"
      ? claim.input.model_id
      : typeof params?.model_id === "string"
        ? params.model_id
        : "";
  const duration = Number(claim.input.duration ?? params?.duration);
  let dimensions = videoDimensions(claim.input.resolution, claim.input.aspect_ratio);
  if (!dimensions) {
    dimensions = dimensionsFromSize(params?.size);
  }
  if (!prompt || !model || !Number.isFinite(duration) || duration <= 0 || !dimensions) {
    throw new Error("视频生成参数无效");
  }

  const firstFrameAssetId = readAssetId(claim.input.first_frame_asset_id);
  const lastFrameAssetId = readAssetId(claim.input.last_frame_asset_id);
  const referenceAssetIds = uniqueAssetIds(readAssetIds(claim.input.reference_asset_ids));
  if (lastFrameAssetId && !firstFrameAssetId) {
    throw new VideoInputError("invalid_video_inputs", "尾帧必须与首帧一起使用");
  }
  if ((firstFrameAssetId || lastFrameAssetId) && referenceAssetIds.length > 0) {
    throw new VideoInputError(
      "invalid_video_inputs",
      "首尾帧模式不能与普通参考素材混用",
    );
  }
  const assetIds = uniqueAssetIds([
    firstFrameAssetId,
    lastFrameAssetId,
    ...referenceAssetIds,
  ]);
  const assets = await repo.resolveInputAssets(assetIds, claim.userId, claim.projectId);
  if (assets.length !== assetIds.length) {
    throw new VideoInputError(
      "reference_asset_unavailable",
      "参考素材不存在或无权访问",
    );
  }

  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const firstFrame = firstFrameAssetId ? assetsById.get(firstFrameAssetId) : undefined;
  const lastFrame = lastFrameAssetId ? assetsById.get(lastFrameAssetId) : undefined;
  if (
    (firstFrame && firstFrame.type !== "image") ||
    (lastFrame && lastFrame.type !== "image")
  ) {
    throw new VideoInputError(
      "unsupported_reference_type",
      "首尾帧素材必须是图片",
    );
  }
  const referenceAssets = referenceAssetIds.map((id) => {
    const asset = assetsById.get(id);
    if (!asset) {
      throw new VideoInputError(
        "reference_asset_unavailable",
        "参考素材不存在或无权访问",
      );
    }
    return asset;
  });
  const references = validateReferences(model, referenceAssets);
  const resolution =
    typeof claim.input.resolution === "string"
      ? claim.input.resolution
      : typeof params?.size === "string"
        ? params.size
        : "";
  const ratio =
    typeof claim.input.aspect_ratio === "string"
      ? claim.input.aspect_ratio
      : typeof params?.aspect_ratio === "string"
        ? params.aspect_ratio
        : "";

  return {
    model,
    prompt,
    duration,
    ...dimensions,
    resolution,
    ratio,
    ...(firstFrame ? { firstFrameImage: firstFrame.url } : {}),
    ...(lastFrame ? { lastFrameImage: lastFrame.url } : {}),
    references,
  };
}

const MAX_REFERENCE_IMAGES = 9;
const MAX_REFERENCE_VIDEOS = 3;
const MAX_REFERENCE_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_REFERENCE_VIDEO_SECONDS = 15;
const MIN_REFERENCE_VIDEO_SIDE = 300;
const MAX_REFERENCE_VIDEO_SIDE = 6000;
const MIN_REFERENCE_VIDEO_PIXELS = 409_600;
const MAX_REFERENCE_VIDEO_PIXELS = 8_295_044;
const MIN_REFERENCE_VIDEO_RATIO = 0.4;
const MAX_REFERENCE_VIDEO_RATIO = 2.5;
const REFERENCE_VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);

function validateReferences(
  model: string,
  assets: VideoWorkerInputAsset[],
): VideoReference[] {
  let imageCount = 0;
  let videoCount = 0;
  let knownVideoDuration = 0;
  const references = assets.map<VideoReference>((asset) => {
    if (asset.type === "image") {
      imageCount += 1;
      return { type: "image", url: asset.url };
    }
    if (asset.type !== "video") {
      throw new VideoInputError(
        "unsupported_reference_type",
        "视频生成只支持图片或视频参考素材",
      );
    }
    videoCount += 1;
    validateReferenceVideo(asset);
    if (asset.duration !== null && asset.duration !== undefined) {
      knownVideoDuration += asset.duration;
    }
    return { type: "video", url: asset.url };
  });

  if (imageCount > MAX_REFERENCE_IMAGES || videoCount > MAX_REFERENCE_VIDEOS) {
    throw new VideoInputError(
      "reference_limit_exceeded",
      "Seedance 2.0 最多支持 9 张参考图片和 3 个参考视频",
    );
  }
  if (videoCount > 0 && !isSeedance2Model(model)) {
    throw new VideoInputError(
      "unsupported_video_inputs",
      "只有 Seedance 2.0 支持参考视频",
    );
  }
  if (knownVideoDuration > MAX_REFERENCE_VIDEO_SECONDS) {
    throw new VideoInputError(
      "invalid_reference_video",
      "参考视频已知总时长不能超过 15 秒",
    );
  }
  return references;
}

function validateReferenceVideo(asset: VideoWorkerInputAsset): void {
  const mime = asset.mime?.split(";", 1)[0]?.trim().toLowerCase();
  if (mime && !REFERENCE_VIDEO_MIMES.has(mime)) {
    throw new VideoInputError(
      "invalid_reference_video",
      "参考视频只支持 MP4 或 MOV",
    );
  }
  if (
    asset.size !== null &&
    asset.size !== undefined &&
    (!Number.isFinite(asset.size) ||
      asset.size <= 0 ||
      asset.size > MAX_REFERENCE_VIDEO_BYTES)
  ) {
    throw new VideoInputError(
      "invalid_reference_video",
      "单个参考视频不能超过 200 MB",
    );
  }
  if (
    asset.duration !== null &&
    asset.duration !== undefined &&
    (!Number.isFinite(asset.duration) ||
      asset.duration < 2 ||
      asset.duration > MAX_REFERENCE_VIDEO_SECONDS)
  ) {
    throw new VideoInputError(
      "invalid_reference_video",
      "单个参考视频时长必须为 2 至 15 秒",
    );
  }
  validateReferenceVideoDimensions(asset);
}

function validateReferenceVideoDimensions(asset: VideoWorkerInputAsset): void {
  const width = asset.width;
  const height = asset.height;
  const knownSides = [width, height].filter(
    (side): side is number => side !== null && side !== undefined,
  );
  if (
    knownSides.some(
      (side) =>
        !Number.isInteger(side) ||
        side < MIN_REFERENCE_VIDEO_SIDE ||
        side > MAX_REFERENCE_VIDEO_SIDE,
    )
  ) {
    throw new VideoInputError(
      "invalid_reference_video",
      "参考视频单边像素必须为 300 至 6000",
    );
  }
  if (width === null || width === undefined || height === null || height === undefined) {
    return;
  }
  const pixels = width * height;
  const ratio = width / height;
  if (
    pixels < MIN_REFERENCE_VIDEO_PIXELS ||
    pixels > MAX_REFERENCE_VIDEO_PIXELS ||
    ratio < MIN_REFERENCE_VIDEO_RATIO ||
    ratio > MAX_REFERENCE_VIDEO_RATIO
  ) {
    throw new VideoInputError(
      "invalid_reference_video",
      "参考视频宽高比或总像素不满足 Seedance 2.0 要求",
    );
  }
}

function isSeedance2Model(model: string): boolean {
  return model === "seedance-2" || /^doubao-seedance-2-0(?:-|$)/.test(model);
}

function readAssetId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) return value;
  if (value === undefined || value === null) return null;
  throw new VideoInputError("invalid_video_inputs", "视频素材 ID 无效");
}

function readAssetIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new VideoInputError("invalid_video_inputs", "视频参考素材无效");
  }
  return value.map((candidate) => {
    const id = readAssetId(candidate);
    if (id === null) {
      throw new VideoInputError("invalid_video_inputs", "视频参考素材 ID 无效");
    }
    return id;
  });
}

function uniqueAssetIds(ids: Array<string | null>): string[] {
  return ids.reduce<string[]>((result, id) => {
    if (id && !result.includes(id)) result.push(id);
    return result;
  }, []);
}

function videoDimensions(
  resolution: unknown,
  aspectRatio: unknown,
): { width: number; height: number } | null {
  if (typeof resolution !== "string" || typeof aspectRatio !== "string") return null;
  const height = Number(/^([0-9]+)p$/.exec(resolution)?.[1]);
  const ratio = /^([1-9][0-9]*):([1-9][0-9]*)$/.exec(aspectRatio);
  if (!Number.isFinite(height) || height <= 0 || !ratio) return null;
  const width = Math.round((height * Number(ratio[1])) / Number(ratio[2]) / 2) * 2;
  return { width, height };
}

/** plan/scene_card 任务用 capabilities 的 "宽x高" size 档（如 1280x720）。 */
function dimensionsFromSize(size: unknown): { width: number; height: number } | null {
  if (typeof size !== "string") return null;
  const match = /^([0-9]+)x([0-9]+)$/i.exec(size);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0)
    return null;
  return { width, height };
}
