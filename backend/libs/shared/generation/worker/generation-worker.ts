import {
  DEFAULT_MAX_REFERENCE_IMAGES,
  type WorkerRepo,
} from "@lib/shared/persistence/index.js";
import type { AssetUploadStorage } from "@lib/shared/assets/upload.js";
import sharp from "sharp";

import {
  AudioProviderError,
  type AudioProvider,
  type SeedAudioReference,
} from "@lib/shared/generation-runtime/index.js";
import { composeImagePrompt } from "@blue-whale/core";
import { z } from "zod";
import {
  ERROR_INVALID_INPUT,
  ERROR_MODEL_UNAVAILABLE,
  ERROR_NO_RESULT,
  ERROR_PROVIDER_CONFIG,
  ERROR_PROVIDER_CREDENTIAL_MISSING,
  ERROR_PROVIDER_FAILED,
  ERROR_REFERENCE_ASSET_UNAVAILABLE,
  ERROR_UNSUPPORTED_INPUT,
  ERROR_UNSUPPORTED_TYPE,
  textAttachmentSnapshotSchema,
} from "@blue-whale/contracts";
import {
  mapImageChannelRequest,
  parseStoredImageRequestMapping,
} from "../image-channel-parser.js";
import {
  hasSeedreamSizeTable,
  resolveSeedreamImageSize,
} from "../seedream-image-size.js";
import { ImageProviderError, type ImageProvider } from "./image-provider.js";
import { VideoProviderError, type VideoProvider } from "./video-provider.js";

export type WorkerDeps = {
  repo: WorkerRepo;
  /** 按 job 密封凭证构建图片 provider（与 video 一致：sk token 来自 job，不来自请求闭包，
   *  这样请求内即时调度与进程重启后的恢复扫描可用同一套逻辑）。 */
  createImageProvider: (token: string) => ImageProvider;
  /** 按 job 密封凭证构建音频 provider(与 image/video 一致)。 */
  createAudioProvider: (token: string) => AudioProvider;
  /** 解密 job.input.provider_credential → sk token。 */
  credentialVault: { open: (ciphertext: string) => string };
  videoProvider?: VideoProvider;
  workerId: string;
  fetchImpl?: typeof fetch;
  mediaStorage?: Pick<
    AssetUploadStorage,
    "prepareUpload" | "makePublic"
  > | null;
  /** IK7G9X：按 (token, request_id) 查消费流水 quota（new-api）；缺省不查（actual 落 0 兜底）。 */
  readConsumeQuota?: (
    token: string,
    requestId: string,
  ) => Promise<number | null>;
  /** IK7G9X：quota → 分(fen)。缺省不换算（actual 落 0 兜底）。 */
  quotaToFen?: (quota: number) => bigint;
  /** 实扣取证失败/异常时的告警回调（接入 logger/metrics）。缺省不注入 = 旧行为静默。 */
  warn?: (message: string) => void;
};

/** IKDLQF：job.input 快照上冻结的文本附件（契约「接纳快照」）；旧任务无此字段，视为无附件。 */
type GenerationJobInput = Record<string, unknown> & {
  text_attachments?: unknown;
};

/** 瞬时失败码：网络不可达 / 结果转存失败等——重试有意义。quota/config/校验类不算瞬时。 */
const TRANSIENT_IMAGE_ERROR_CODES = new Set([ERROR_PROVIDER_FAILED]);
/** 图片任务最大重试次数（瞬时失败回 queued 后由恢复扫描或下次调度再领）。 */
const MAX_IMAGE_RETRIES = 3;

function isTransientImageError(code: string): boolean {
  return TRANSIENT_IMAGE_ERROR_CODES.has(code);
}

/** 指数退避：30s → 60s → 120s，封顶 5min。 */
function imageRetryBackoffMs(retryCount: number): number {
  return Math.min(30_000 * 2 ** retryCount, 300_000);
}

/** 生成 worker：认领一个 queued 任务 → 调 provider 出图 → 建素材 → 结任务 → 结算。
 *  返回处理的 jobId，无任务返回 null。纯编排，provider/repo 注入，可单测。 */
export async function processNextJob(deps: WorkerDeps): Promise<string | null> {
  const { repo, workerId } = deps;
  const job = await repo.claimNextJob(workerId);
  if (!job) return null;

  return processClaimedJob(job, deps);
}

/** 恢复扫描用：认领一个到点的音频任务并处理。
 *  IKBGKA（review 2 轮）：图片已迁 MQ，本函数只服务音频 inline 恢复；
 *  IKCR78：音频也已迁 MQ——生产路径不再调用本函数（孤儿由 RecoveryService 补入队到 RocketMQ），
 *  仅保留导出供单测覆盖 claimNextInProcessJob 语义。 */
export async function processNextInProcessJob(
  deps: WorkerDeps,
): Promise<string | null> {
  const job = await deps.repo.claimNextInProcessJob(deps.workerId);
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

/** 图片 MQ 消费端：按 RocketMQ 消息 jobId 领单个图片 job 并处理（IKBGKA）。
 *  镜像 processJob 但按 id 领（无 request userId）——job 自带 user_id，消费端非 request-scoped。 */
export async function processImageJobById(
  jobId: string,
  deps: WorkerDeps,
): Promise<string | null> {
  const job = await deps.repo.claimImageJobById(jobId, deps.workerId);
  if (!job) return null;

  return processClaimedJob(job, deps);
}

/** IKE4GC：把冻结在产品格式的 audio references（{role, asset_id, type}）解析成
 *  seed-audio 的《references》数组（audio→audio_url、image→image_url）。
 *  **与视频不同：音频生成不做 url→material_id 转换**——asset_id 一律用本地 asset 的 TOS url
 *  （即便已绑定素材库也不转 asset://）。material_id（素材库引用）**在提交任务时**被拦截，
 *  worker 不处理 material_id，只在提交期校验。仅音频生成使用；找不到 asset 来源返回失败（调用方 failClaimed）。 */
type RawAudioReference = {
  role?: unknown;
  asset_id?: unknown;
  material_id?: unknown;
  type?: unknown;
};
async function resolveAudioSeedReferences(
  raw: unknown,
  userId: string,
  projectId: string,
  repo: WorkerRepo,
): Promise<{ ok: true; refs: SeedAudioReference[] } | { ok: false; message: string }> {
  // 无 references（纯文本生成）→ 空数组；非数组/损坏快照 → 失败，不静默丢参考（避免白生成）。
  if (raw === undefined || raw === null) return { ok: true, refs: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, message: "参考素材引用无效" };
  }
  const items = raw.filter(
    (it): it is RawAudioReference =>
      typeof it === "object" && it !== null,
  );
  const assetIds = items
    .map((it) =>
      typeof it.asset_id === "string" && it.asset_id.length > 0
        ? it.asset_id
        : null,
    )
    .filter((id): id is string => id !== null);
  const assets =
    assetIds.length > 0
      ? await repo.resolveInputAssets(assetIds, userId, projectId)
      : [];
  const assetsById = new Map(assets.map((a) => [a.id, a]));
  const refs: SeedAudioReference[] = [];
  // 同一素材来源重复出现 → 只保留首次（跨 role 生效）。
  // 与视频不同：音频生成不做 url→material_id 转换——asset_id 一律用本地 TOS url（即便绑定素材库也不转 asset://）；
  // material_id（素材库引用）在**提交任务时**已拦截，worker 不处理 material_id。
  const seen = new Set<string>();
  for (const it of items) {
    // 提交期已保证项只带 asset_id；material_id/缺失来源项在提交期被 400 拦截，此处跳过不复审。
    const assetId =
      typeof it.asset_id === "string" && it.asset_id.length > 0
        ? it.asset_id
        : null;
    if (assetId === null) continue;
    const asset = assetsById.get(assetId);
    if (!asset) {
      return {
        ok: false,
        message: "参考素材不存在或无权访问",
      };
    }
    // 参考介质以资产实际类型为准（视频/未知类型不适用于音频生成参考）。
    if (asset.type !== "audio" && asset.type !== "image") {
      return { ok: false, message: "参考素材类型不适用" };
    }
    if (asset.url === null || seen.has(asset.url)) continue;
    seen.add(asset.url);
    refs.push(
      asset.type === "audio"
        ? { audio_url: asset.url }
        : { image_url: asset.url },
    );
  }
  return { ok: true, refs };
}

/** 音频 MQ 消费端：按 RocketMQ 消息 jobId 领单个音频 job 并处理（IKCR78）。
 *  镜像 processImageJobById——audio 走 data 直传 + 单 asset，与图片同构；消费端非 request-scoped。 */
export async function processAudioJobById(
  jobId: string,
  deps: WorkerDeps,
): Promise<string | null> {
  const job = await deps.repo.claimAudioJobById(jobId, deps.workerId);
  if (!job) return null;

  return processClaimedJob(job, deps);
}

async function processClaimedJob(
  job: NonNullable<Awaited<ReturnType<WorkerRepo["claimNextJob"]>>>,
  deps: WorkerDeps,
): Promise<string> {
  const {
    repo,
    workerId,
    createImageProvider,
    credentialVault,
    videoProvider,
    fetchImpl = fetch,
    mediaStorage,
  } = deps;
  // IK7GRP：claim 后 job 已是 processing + 当前 worker 持 lease；围栏凭证（workerId + fencingToken）
  // 随每次写方法透传，stale worker（旧 fencing_token / 失效 lease）的迟到写入被仓储层拒绝。
  const fenceProof = { workerId, fencingToken: job.fencingToken };
  if (job.cancelRequested) {
    // 沿用历史命名的通用派发前取消事务：围栏保护与预留释放对图片/音频同样适用。
    await repo.cancelVideoBeforeDispatch({ jobId: job.id, ...fenceProof });
    return job.id;
  }
  // IK9VZ0：失败释放校验用——本 job 曾发出的 new-api 请求证据（request_id 列表 + sk token）。
  let attemptedRequestIds: string[] = [];
  let providerTokenRef: string | undefined;
  // IK7GRP：统一失败入口——守卫失败时（job 已被新 worker 接管）仓储层返回 false，静默跳过。
  const failClaimed = async (code: string, msg: string) => {
    // IK9VZ0：失败释放校验——job 曾向 new-api 发出请求且有 request_id 时，先查流水确认是否真退款。
    // 校验结果落 release_note：流水确认无扣费 → refund_confirmed；已扣/查询异常 → refund_unverified。
    // 无证据（无 request_id / 未注入查询）时默认 refund_unverified——无法确认 new-api 是否退款，
    // 统一留痕供对账追溯（需求 4 完整性：每次失败释放必写 release_note）。
    let releaseNote: string = "refund_unverified";
    if (attemptedRequestIds.length > 0 && deps.readConsumeQuota && providerTokenRef) {
      let charged = false;
      let verified = true;
      for (const requestId of attemptedRequestIds) {
        try {
          const q = await deps.readConsumeQuota(providerTokenRef, requestId);
          if (q !== null && q > 0) {
            charged = true;
            deps.warn?.(
              `[cost] job ${job.id} 失败但 new-api 流水显示已扣 quota=${q}（request_id=${requestId}），需人工核对退款`,
            );
          }
        } catch {
          // 查询异常：无法确认退款 → 不得记 refund_confirmed（审计结论写反风险，IK9VZ0 C2）
          verified = false;
        }
      }
      // 仅当所有证据查询成功且均无扣费时才算 confirmed。
      if (verified && !charged) releaseNote = "refund_confirmed";
    }
    const failed = await repo.failJob({
      jobId: job.id,
      errorCode: code,
      errorMessage: msg,
      ...fenceProof,
      releaseNote,
      // IKBQEE / ADR-0078：调试详情（provider 原文/request_id 等）进 error.details，禁展示用户。
      details: {
        ...(attemptedRequestIds.length > 0
          ? { request_ids: attemptedRequestIds }
          : {}),
        raw: msg,
      },
    });
  };
  if (job.type !== "image" && job.type !== "video" && job.type !== "audio") {
    await failClaimed(ERROR_UNSUPPORTED_TYPE, `暂不支持类型: ${job.type}`);
    return job.id;
  }

  const input = (job.input ?? {}) as GenerationJobInput;
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const modelId = typeof input.model_id === "string" ? input.model_id : "";
  // IKDLQF：图片任务允许空 prompt 仅凭非空白附件正文驱动（契约「接纳快照」）；
  // 无附件（含 video/audio）时校验与旧行为逐字节一致；快照形状损坏按无附件处理。
  const parsedAttachments = z.array(textAttachmentSnapshotSchema).safeParse(input.text_attachments ?? []);
  const textAttachments = parsedAttachments.success ? parsedAttachments.data : [];
  const hasNonBlankAttachment =
    job.type === "image" &&
    textAttachments.some((a) => a.text.trim().length > 0);
  if ((!prompt && !hasNonBlankAttachment) || !modelId) {
    await failClaimed(ERROR_INVALID_INPUT, "缺少 prompt 或 model_id");
    return job.id;
  }

  // IKA72G：字段语义统一——图片参考图 = input_asset_ids（与创建校验/前端契约对齐），
  // 视频普通参考素材 = reference_asset_ids（首尾帧走 first/last_frame_asset_id 不受此限）。
  const referenceField =
    job.type === "image" ? "input_asset_ids" : "reference_asset_ids";
  const referenceIds = Array.isArray(input[referenceField])
    ? input[referenceField]
        .filter(
          (id): id is string | number =>
            typeof id === "string" || typeof id === "number",
        )
        .map(String)
    : [];
  // IKE4GC：音频参考素材走新单数组 references；旧字段 reference_asset_ids 对音频仍不支持，防御拦截。
  if (job.type === "audio" && referenceIds.length > 0) {
    await failClaimed(
      ERROR_UNSUPPORTED_INPUT,
      "音频生成暂不支持旧参考字段，请使用 references",
    );
    return job.id;
  }
  // IKA72G：图片参考图上限读取模型能力配置（features.max_reference_images），与创建校验同源；
  // 能力行缺失回退与网关/ARK 一致的常量 10。video 走 RocketMQ video-job-runner（9 图 + 3 视频，
  // 创建预检 12 一致），本 worker 旧版单图视频分支维持 1 张并输出真实上限文案。
  let imageCapability: Awaited<
    ReturnType<WorkerRepo["findImageCapability"]>
  > | null = null;
  let maxReferenceCount = 1;
  if (job.type === "image") {
    const sizeId = typeof input.size === "string" ? input.size : null;
    imageCapability = await repo.findImageCapability(modelId, sizeId);
    if (!imageCapability) {
      await failClaimed(
        ERROR_MODEL_UNAVAILABLE,
        `未开通或不受支持的模型: ${modelId}`,
      );
      return job.id;
    }
    maxReferenceCount =
      imageCapability.max_reference_images ?? DEFAULT_MAX_REFERENCE_IMAGES;
  }
  if (referenceIds.length > maxReferenceCount) {
    await failClaimed(
      ERROR_UNSUPPORTED_INPUT,
      `当前模型最多支持 ${maxReferenceCount} 张参考图`,
    );
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
    await failClaimed(ERROR_UNSUPPORTED_INPUT, "参考素材不存在或无权访问");
    return job.id;
  }

  try {
    if (job.type === "audio") {
      const sealedCredential = job.input?.provider_credential;
      if (typeof sealedCredential !== "string" || sealedCredential.length === 0) {
        await failClaimed(
          ERROR_PROVIDER_CREDENTIAL_MISSING,
          "音频任务缺少供应商凭证",
        );
        return job.id;
      }
      const providerToken = credentialVault.open(sealedCredential);
      const provider = deps.createAudioProvider(providerToken);
      providerTokenRef = providerToken;
      const cap = await repo.findImageCapability(modelId, null);
      if (!cap) {
        await failClaimed(
          ERROR_MODEL_UNAVAILABLE,
          `未开通或不受支持的模型: ${modelId}`,
        );
        return job.id;
      }
      // IKE4GC：解析音频参考素材（input.references，产品格式 → seed-audio references）。
      const audioRefs = await resolveAudioSeedReferences(
        input.references,
        job.user_id,
        job.project_id,
        repo,
      );
      if (!audioRefs.ok) {
        await failClaimed(ERROR_REFERENCE_ASSET_UNAVAILABLE, audioRefs.message);
        return job.id;
      }
      const audio = await provider.generate({
        model: cap.model_id,
        prompt,
        ...(audioRefs.refs.length > 0 ? { references: audioRefs.refs } : {}),
      });
      // audio.data 为原始字节;url 为空串,persistProviderMedia 走 data 直传路径。
      const stored = await persistProviderMedia(
        "",
        "audio",
        job.user_id,
        mediaStorage,
        fetchImpl,
        audio.data,
      );
      const assetId = await repo.createAsset({
        user_id: job.user_id,
        project_id: job.project_id,
        generation_job_id: job.id,
        url: stored.url,
        type: "audio",
        width: null,
        height: null,
        storage_key: stored.storageKey,
        mime: stored.mime,
        size: stored.size,
        duration: audio.duration ?? null,
        ...fenceProof,
      });
      if (assetId === null) return job.id;
      // IK9ILQ：音频实扣金额 = 本次调用消费流水 quota → 分(fen)，仿图片路径接 requestId。
      let actualAmountFen: bigint | undefined;
      if (audio.requestId) {
        attemptedRequestIds = [audio.requestId];
      }
      if (deps.readConsumeQuota && deps.quotaToFen && audio.requestId) {
        try {
          const quota = await deps.readConsumeQuota(
            providerToken,
            audio.requestId,
          );
          if (quota !== null && quota > 0) {
            actualAmountFen = deps.quotaToFen(quota);
          }
        } catch {
          // 查询失败落 0,与图片缺省一致
        }
      }
      await finishJob(repo, job.id, [assetId], fenceProof, actualAmountFen);
      return job.id;
    }

    if (job.type === "video") {
      if (!videoProvider) {
        await failClaimed(ERROR_PROVIDER_CONFIG, "视频 provider 未配置");
        return job.id;
      }
      const resolution =
        typeof input.resolution === "string" ? input.resolution : "";
      const ratio =
        typeof input.aspect_ratio === "string" ? input.aspect_ratio : "";
      const dimensions = videoDimensions(resolution, ratio);
      const duration = Number(input.duration);
      if (!dimensions || !Number.isFinite(duration) || duration <= 0) {
        await failClaimed(ERROR_INVALID_INPUT, "视频尺寸或时长无效");
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
        ...fenceProof,
      });
      if (assetId === null) return job.id;
      await finishJob(repo, job.id, [assetId], fenceProof);
      return job.id;
    }

    // 图片：sk token 从 job 密封凭证解出（不依赖请求闭包），恢复扫描也能重放。
    const sealedCredential = job.input?.provider_credential;
    if (typeof sealedCredential !== "string" || sealedCredential.length === 0) {
      await failClaimed(
        ERROR_PROVIDER_CREDENTIAL_MISSING,
        "图片任务缺少供应商凭证",
      );
      return job.id;
    }
    const providerToken = credentialVault.open(sealedCredential);
    const provider = createImageProvider(providerToken);
    providerTokenRef = providerToken;

    // IKA72G：capability 已在参考图上限校验处按同一 sizeId 取回，这里直接复用（避免重复查询）。
    const cap = imageCapability;
    if (!cap) {
      await failClaimed(
        ERROR_MODEL_UNAVAILABLE,
        `未开通或不受支持的模型: ${modelId}`,
      );
      return job.id;
    }
    const aspectRatio =
      typeof input.aspect_ratio === "string" ? input.aspect_ratio : null;
    const sizeId = typeof input.size === "string" ? input.size : null;
    const mapping = parseStoredImageRequestMapping(
      cap.channel_parser,
      cap.request_mapping,
      {
        sizeId: cap.default_size,
        ratioId: cap.default_aspect_ratio,
      },
    );
    let providerSize = cap.api_size;
    let providerQuality: string | undefined;
    if (mapping.parser === "gpt" || mapping.parser === "banana") {
      const mapped = mapImageChannelRequest(mapping, sizeId, aspectRatio);
      if (!mapped.ok) {
        await failClaimed(ERROR_INVALID_INPUT, "模型、分辨率与宽高比组合不受支持");
        return job.id;
      }
      providerSize = mapped.size;
      providerQuality = mapped.quality;
    } else if (cap.api_size && aspectRatio && hasSeedreamSizeTable(cap.model_id)) {
      // seedream 族按代码表换算；族外模型直接沿用能力行 api_value。
      providerSize = resolveSeedreamImageSize(
        cap.model_id,
        cap.api_size,
        aspectRatio,
      );
      if (!providerSize) {
        await failClaimed(ERROR_INVALID_INPUT, "模型、分辨率与宽高比组合不受支持");
        return job.id;
      }
    }
    const n = Math.max(1, Math.min(4, job.expected_output_count || 1));
    const sourceImages = [];
    for (const source of sourceAssets) {
      if (typeof source.url !== "string" || source.url.length === 0) {
        throw new ImageProviderError(ERROR_UNSUPPORTED_INPUT, "参考图片缺少地址");
      }
      sourceImages.push({ url: source.url });
    }
    const sequential = input.sequential_image_generation === true;
    const providerInput = {
      model: cap.model_id,
      // IKDLQF：有文本附件时按契约组合（附件正文按序在前、忽略纯空白、非空 prompt 最后追加）；
      // 无附件时沿用原 prompt，与旧链路逐字节一致。
      prompt:
        textAttachments.length > 0
          ? composeImagePrompt(textAttachments, prompt)
          : prompt,
      size: providerSize,
      ...(providerQuality ? { quality: providerQuality } : {}),
      webSearch: input.web_search === true,
      sequential,
      width: cap.width,
      height: cap.height,
      ...(sourceImages.length === 1
        ? { sourceImage: sourceImages[0]! }
        : sourceImages.length > 1
          ? { sourceImages }
          : {}),
    };
    const images = [];
    let remaining = n;
    for (let attempt = 0; remaining > 0 && attempt < n; attempt += 1) {
      const batch = await provider.generate({
        ...providerInput,
        n: remaining,
      });
      images.push(...batch);
      // IK9VZ0：逐批累加 request_id 证据——若后续批次生成失败，已成功批次的扣费
      // 仍可被失败释放校验追溯（C3：此前循环结束后才赋值，后批失败会丢失前批证据）。
      for (const img of batch) {
        if (img.requestId) attemptedRequestIds.push(img.requestId);
      }
      if (batch.length === 0) break;
      remaining = n - images.length;
    }
    if (images.length === 0) {
      await failClaimed(ERROR_NO_RESULT, "生成服务未返回结果");
      return job.id;
    }
    // IK67HE/T14：部分成功（images.length < n 但 > 0）→ 已成功的转 Asset 并 completeJob，
    // 由 completeJob 按槽位聚合为 partially_succeeded（ADR-0026）；缺失槽标 failed 供重试补齐。
    if (images.length !== n) {
      await repo.appendLog(
        job.id,
        "partial_output",
        "processing",
        `生成服务返回 ${images.length} 张，期望 ${n} 张，按部分成功处理`,
      );
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
        width: positiveDimension(img.width) ?? storedImage.width,
        height: positiveDimension(img.height) ?? storedImage.height,
        storage_key: storedImage.storageKey,
        mime: storedImage.mime,
        size: storedImage.size,
        ...fenceProof,
      });
      // IK7GRP：createAsset 守卫失败（job 已被新 worker 接管）→ 中止后续建素材与结任务，
      // 当前 worker 已无 lease，finishJob / failClaimed 守卫也会拒绝，直接退出。
      if (id === null) return job.id;
      assetIds.push(id);
    }
    // IK7G9X：图片实扣金额 = 本次调用消费流水 quota 汇总 → 分(fen)。
    // 收集所有生成请求的 request_id（同一次 generate 的多张图共用 requestId，去重后查）。
    // IK9VZ0：取证失败（无 request_id / 流水查不到或≤0 / 查询抛错）必须告警，不再静默落 0。
    let actualAmountFen: bigint | undefined;
    if (deps.readConsumeQuota && deps.quotaToFen) {
      const requestIds = [
        ...new Set(
          images
            .map((img) => img.requestId)
            .filter((r): r is string => Boolean(r)),
        ),
      ];
      if (requestIds.length === 0) {
        deps.warn?.(
          `[cost] job ${job.id} 实扣取证失败：无 request_id，actual_amount_fen 将落 0`,
        );
      }
      let totalQuota = 0;
      let allResolved = true;
      for (const requestId of requestIds) {
        try {
          const quota = await deps.readConsumeQuota(providerToken, requestId);
          if (quota === null || quota <= 0) {
            deps.warn?.(
              `[cost] job ${job.id} 实扣取证失败：request_id=${requestId} 流水 quota=${quota}，actual_amount_fen 将落 0`,
            );
            allResolved = false;
            break;
          }
          totalQuota += quota;
        } catch (e) {
          deps.warn?.(
            `[cost] job ${job.id} 实扣取证异常：request_id=${requestId} ${
              e instanceof Error ? e.message : String(e)
            }，actual_amount_fen 将落 0`,
          );
          allResolved = false;
          break;
        }
      }
      if (allResolved && requestIds.length > 0) {
        actualAmountFen = deps.quotaToFen(totalQuota);
      }
    }
    await finishJob(repo, job.id, assetIds, fenceProof, actualAmountFen);
    return job.id;
  } catch (e) {
    const code =
      e instanceof ImageProviderError ||
      e instanceof VideoProviderError ||
      e instanceof AudioProviderError
        ? e.code
        : ERROR_PROVIDER_FAILED;
    const msg = e instanceof Error ? e.message : "unknown";
    // 图片瞬时失败（网络不可达 / 转存失败等）按指数退避回 queued 重试，不再一次判死。
    // 对应线上 job 416「new-api 不可达」类：实际下次调用即可成功（已 curl 验证 new-api 可达）。
    if (
      job.type === "image" &&
      isTransientImageError(code) &&
      job.retry_count < MAX_IMAGE_RETRIES
    ) {
      const nextActionAt = new Date(
        Date.now() + imageRetryBackoffMs(job.retry_count),
      );
      const requeued = await repo.requeueImageJobForRetry(job.id, nextActionAt);
      if (requeued) {
        await repo.appendLog(
          job.id,
          "retry_scheduled",
          "queued",
          `瞬时失败第 ${job.retry_count + 1}/${MAX_IMAGE_RETRIES} 次重试已排队: ${code}: ${msg}`,
        );
        return job.id;
      }
    }
    await failClaimed(code, msg);
    return job.id;
  }
}

export async function persistProviderMedia(
  sourceUrl: string,
  type: "image" | "video" | "audio",
  userId: string,
  storage:
    Pick<AssetUploadStorage, "prepareUpload" | "makePublic"> | null | undefined,
  fetchImpl: typeof fetch,
  data?: Uint8Array,
): Promise<{
  url: string;
  storageKey: string | null;
  mime: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
}> {
  // IK9ILQ：audio 走 data 直传（sourceUrl 为空串），mediaStorage 缺失时回退 url:"" 会产生
  // 死资产，这里显式失败（worker catch 归为 provider_failed，任务失败而非产出 url:"" 资产）。
  if (data !== undefined && !storage) {
    throw new Error("音频转存存储未配置");
  }
  if (!storage) {
    return {
      url: sourceUrl,
      storageKey: null,
      mime: null,
      size: null,
      width: null,
      height: null,
    };
  }

  let mime: string | null = null;
  let content = data;
  if (content === undefined) {
    const source = await fetchImpl(sourceUrl);
    if (!source.ok) throw new Error(`生成结果下载失败: ${source.status}`);
    mime =
      source.headers.get("content-type")?.split(";", 1)[0]?.trim() ||
      (type === "image"
        ? "image/png"
        : type === "video"
          ? "video/mp4"
          : "audio/mpeg");
    content = new Uint8Array(await source.arrayBuffer());
  } else {
    mime = type === "audio" ? "audio/mpeg" : null;
  }
  if (mime && !mime.startsWith(`${type}/`)) {
    throw new Error("生成结果媒体类型不匹配");
  }
  if (content.byteLength === 0) throw new Error("生成结果为空");
  let width: number | null = null;
  let height: number | null = null;
  if (type === "image") {
    try {
      const metadata = await sharp(content).metadata();
      width = positiveDimension(metadata.width);
      height = positiveDimension(metadata.height);
    } catch {
      // Unknown provider formats still persist; the info panel reports unknown
      // rather than failing an otherwise valid generation.
    }
  }

  const prepared = await storage.prepareUpload({
    userId,
    type,
    // data 直传仅在 audio 使用(mime 恒为 audio/mpeg);null 兜底防非 audio 直传误用。
    mime: mime ?? (type === "audio" ? "audio/mpeg" : "application/octet-stream"),
  });
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
    width,
    height,
  };
}

function positiveDimension(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

async function finishJob(
  repo: WorkerRepo,
  jobId: string,
  assetIds: string[],
  fenceProof: { workerId: string; fencingToken: number },
  actualAmountFen?: bigint,
): Promise<void> {
  // IK7GRP / IK9VZ0：completeJob + settleReservation 合并单事务（图片/音频结算原子化）。
  // 中间抛错整事务回滚——不再出现「job 已 succeeded 但预留仍 reserved」的账不平。
  const completed = await repo.completeJobAndSettle({
    jobId,
    assetIds,
    ...fenceProof,
    ...(actualAmountFen !== undefined ? { actualAmountFen } : {}),
  });
  if (!completed) return;
  await repo.appendLog(
    jobId,
    "succeeded",
    "succeeded",
    `产出 ${assetIds.length} 个素材`,
    { asset_ids: assetIds },
  );
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
