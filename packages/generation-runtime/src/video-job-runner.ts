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
    firstFrameImage?: string;
    lastFrameImage?: string;
    referenceImages: string[];
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
    const dimensions = videoDimensions(claim.input.resolution, claim.input.aspect_ratio);
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
    });
    return claim.id;
  } catch (error) {
    await fail(
      deps.repo,
      claim,
      "provider_failed",
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
  const prompt = typeof claim.input.prompt === "string" ? claim.input.prompt : "";
  const model = typeof claim.input.model_id === "string" ? claim.input.model_id : "";
  const duration = Number(claim.input.duration);
  const dimensions = videoDimensions(claim.input.resolution, claim.input.aspect_ratio);
  if (!prompt || !model || !Number.isFinite(duration) || duration <= 0 || !dimensions) {
    throw new Error("视频生成参数无效");
  }

  const firstFrameAssetId = readAssetId(claim.input.first_frame_asset_id);
  const lastFrameAssetId = readAssetId(claim.input.last_frame_asset_id);
  const referenceAssetIds = readAssetIds(claim.input.reference_asset_ids);
  const assetIds = uniqueAssetIds([
    firstFrameAssetId,
    lastFrameAssetId,
    ...referenceAssetIds,
  ]);
  const assets = await repo.resolveInputAssets(assetIds, claim.userId, claim.projectId);
  if (assets.length !== assetIds.length || assets.some((asset) => asset.type !== "image")) {
    throw new Error("参考素材不存在或无权访问");
  }

  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const firstFrame = firstFrameAssetId ? assetsById.get(firstFrameAssetId) : undefined;
  const lastFrame = lastFrameAssetId ? assetsById.get(lastFrameAssetId) : undefined;
  const referenceImages = referenceAssetIds.map((id) => assetsById.get(id)?.url).filter(
    (url): url is string => typeof url === "string",
  );

  return {
    model,
    prompt,
    duration,
    ...dimensions,
    ...(firstFrame ? { firstFrameImage: firstFrame.url } : {}),
    ...(lastFrame ? { lastFrameImage: lastFrame.url } : {}),
    referenceImages,
  };
}

function readAssetId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) return value;
  if (value === undefined || value === null) return null;
  throw new Error("视频素材 ID 无效");
}

function readAssetIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("视频参考素材无效");
  return value.map(readAssetId).filter((id): id is string => id !== null);
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
