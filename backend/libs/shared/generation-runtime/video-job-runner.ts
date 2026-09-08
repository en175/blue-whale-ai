import { createLogger, timedProviderCall } from "@blue-whale/core/logging";
import { composeTextAttachmentPrompt } from "@blue-whale/core";
import { z } from "zod";
import {
  ERROR_INVALID_INPUT,
  ERROR_PROVIDER_CREDENTIAL_MISSING,
  ERROR_PROVIDER_FAILED,
  ERROR_PROVIDER_TIMEOUT,
  ERROR_REFERENCE_ASSET_UNAVAILABLE,
  ERROR_UNSUPPORTED_INPUT,
  textAttachmentSnapshotSchema,
} from "@blue-whale/contracts";
import { videoDimensions, dimensionsFromSize } from "./video-dimensions.js";
import {
  readAssetId,
  readAssetIds,
  readMaterialId,
  readMaterialRefs,
  uniqueAssetIds,
  uniqueMaterialRefs,
  VideoInputError,
  type MaterialReference,
} from "./material-reference.js";
import { validateReferences } from "./video-reference-validation.js";

const logger = createLogger("generation-runtime");

/** IK9VZ0：视频实扣与预留偏差告警阈值（50%）。估算口径粗糙（groupRatio 硬编码 1 等），
 *  第一版放宽仅告警不阻断，待对账数据积累后再收紧。 */
const VIDEO_QUOTA_DEVIATION_THRESHOLD = 0.5;

/** IKBBXH：视频轮询内循环步调（ms），与 persistence 的 nextPollAt 提前量保持一致。 */
export const VIDEO_POLL_INTERVAL_MS = 5_000;
/** IKBBXH：视频轮询超限即判 provider_timeout 失败，防永不终态任务被 5s 循环无限轮询（720 次 ≈ 60 分钟）。 */
export const MAX_VIDEO_POLLS = 720;

/** 视频 provider（new_api_video）调用计时打点（IK7G9Y），共享实现见 core。 */
function timedVideoProviderCall<T>(
  operation: "submit" | "poll",
  call: () => Promise<T>,
): Promise<T> {
  return timedProviderCall(logger, { provider: "new_api_video", operation }, call);
}

export type VideoJobClaim = {
  id: string;
  projectId: string;
  userId: string;
  input: Record<string, unknown>;
  providerTaskId: string | null;
  cancelRequested: boolean;
  workerId: string;
  fencingToken: number;
  /** 已轮询次数（rescheduleVideoPoll 累计）。IKBBXH：轮询上限判定用。 */
  pollCount: number;
  /** IK9VZ0：视频实扣二次校验的基准（预留金额，fen；无预留/查询失败为 null/undefined）。 */
  reservedAmountFen?: bigint | null;
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
  /** IKDJNZ：该本地素材关联的素材库素材 id（无关联为 null）。命中则上游走 asset://。 */
  material_id?: string | null;
};

export type VideoReference = {
  /** IKDJNZ：参考音频（type:"audio"）作为普通 reference 支持；首尾帧仍只允许图片。 */
  type: "image" | "video" | "audio";
  url: string;
  /** IKDJNZ：单数组 references 语义下，帧条目带 role（first_frame/last_frame）；普通参考无 role。 */
  role?: "first_frame" | "last_frame";
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
  /** IK7G9X：new-api 任务当前 quota（预扣额，成功结算后=实际扣费额）。 */
  quota?: number;
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
    /** IK9VZ0：退款校验结果（refund_confirmed / refund_unverified），落 release_note。 */
    releaseNote?: string;
    /** IKBQEE / ADR-0078：调试详情，落 error.details，禁展示用户。 */
    details?: Record<string, unknown>;
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

/**
 * provider 错误：携带对外错误码（quota_exhausted / provider_failed 等），
 * 供 runVideoJobStep 的 catch 直接取码落库，不再一律归 provider_failed。
 */
export class VideoProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VideoProviderError";
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
  /** IK7G9X：把 new-api quota 换算成分(fen)。缺省不换算（publish 时 actual 落 0 兜底）。 */
  quotaToFen?: (quota: number) => bigint | undefined;
  /** IK9VZ0：实扣取证失败（task quota 缺失）告警回调（接入 logger）。缺省不注入 = 旧行为静默。 */
  warn?: (message: string) => void;
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
    await fail(deps.repo, claim, ERROR_PROVIDER_CREDENTIAL_MISSING, "视频任务缺少供应商凭证");
    return claim.id;
  }

  try {
    const provider = deps.createProvider(deps.credentialVault.open(sealedCredential));
    if (!claim.providerTaskId) {
      const request = await buildSubmitRequest(deps.repo, claim);
      const submitted = await timedVideoProviderCall("submit", () => provider.submit(request));
      const updated = await deps.repo.markVideoSubmitted({
        ...claimIdentity(claim),
        providerTaskId: submitted.taskId,
      });
      if (updated) await deps.scheduleNext?.(claim.id, VIDEO_POLL_INTERVAL_MS);
      return claim.id;
    }

    const observation = await timedVideoProviderCall("poll", () => provider.poll(claim.providerTaskId!));
    if (observation.status === "queued" || observation.status === "processing") {
      // IK9Q1B：轮询中间态打 debug，便于定位间歇失败时观察状态演化
      logger.debug(
        `video job 轮询中 jobId=${claim.id} status=${observation.status} progress=${observation.progress}`,
      );
      // IKBBXH：轮询次数达上限仍未终态 → 判 provider_timeout 失败，防永不终态任务无限轮询。
      if ((claim.pollCount ?? 0) >= MAX_VIDEO_POLLS) {
        await fail(
          deps.repo,
          claim,
          ERROR_PROVIDER_TIMEOUT,
          `视频生成轮询超时（超过 ${MAX_VIDEO_POLLS} 次）`,
        );
        return claim.id;
      }
      const updated = await deps.repo.rescheduleVideoPoll({
        ...claimIdentity(claim),
        progress: observation.progress,
      });
      if (updated) await deps.scheduleNext?.(claim.id, VIDEO_POLL_INTERVAL_MS);
      return claim.id;
    }
    if (observation.status === "failed") {
      await fail(
        deps.repo,
        claim,
        observation.error?.code ?? ERROR_PROVIDER_FAILED,
        observation.error?.message ?? "视频生成失败",
      );
      return claim.id;
    }
    if (!observation.url) {
      await fail(deps.repo, claim, ERROR_PROVIDER_FAILED, "视频任务成功但未返回 URL");
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
      await fail(deps.repo, claim, ERROR_INVALID_INPUT, "视频尺寸无效");
      return claim.id;
    }
    // IK7G9X：视频实扣金额 = new-api 任务 quota 换算成分。
    // IK9VZ0：① quota 缺失必须告警，不再静默落 0（视频无 request_id → 流水回退通道）；
    //         ② 终态 quota 与预留（reserved_amount_fen）偏差超阈值二次校验告警（不阻断）。
    let actualAmountFen: bigint | undefined;
    if (deps.quotaToFen && observation.quota !== undefined) {
      actualAmountFen = deps.quotaToFen(observation.quota);
      if (
        claim.reservedAmountFen !== undefined &&
        claim.reservedAmountFen !== null &&
        claim.reservedAmountFen > 0n &&
        actualAmountFen !== undefined
      ) {
        const diffRatio =
          Number(actualAmountFen - claim.reservedAmountFen) /
          Number(claim.reservedAmountFen);
        if (Math.abs(diffRatio) > VIDEO_QUOTA_DEVIATION_THRESHOLD) {
          deps.warn?.(
            `[cost] job ${claim.id} 视频实扣与预留偏差超阈值：reserved=${claim.reservedAmountFen}fen actual=${actualAmountFen}fen（偏差 ${Math.round(Math.abs(diffRatio) * 100)}%），需人工核对`,
          );
        }
      }
    } else {
      deps.warn?.(
        `[cost] job ${claim.id} 视频实扣取证失败：task quota 缺失，actual_amount_fen 将落 0`,
      );
    }
    const published = await deps.repo.publishVideoResult({
      ...claimIdentity(claim),
      projectId: claim.projectId,
      userId: claim.userId,
      ...stored,
      ...dimensions,
      duration: Number(claim.input.duration ?? inputParams?.duration),
      ...(actualAmountFen !== undefined ? { actualAmountFen } : {}),
    });
    if (published) {
      logger.metric({
        event: "task_finished",
        result: "ok",
        fields: { job_type: "video_generation" },
      });
    }
    return claim.id;
  } catch (error) {
    // IKBQEE：provider 错误（含 submit 阶段的欠费识别）经 VideoProviderError 携带错误码，
    // 直接取码落库；VideoInputError 为输入校验码；其余一律 provider_failed。
    const code =
      error instanceof VideoInputError
        ? error.code
        : error instanceof VideoProviderError
          ? error.code
          : ERROR_PROVIDER_FAILED;
    const message = error instanceof Error ? error.message : "视频生成失败";
    // IK9Q1B：失败必留痕——异常堆栈是定位间歇失败（985）的关键，之前只有 DB 侧 error 无任何 worker 日志。
    if (error instanceof Error) {
      logger.error(`runVideoJobStep 异常 jobId=${claim.id} code=${code}: ${error.stack ?? error.message}`);
    } else {
      logger.error(`runVideoJobStep 异常 jobId=${claim.id} code=${code}: ${String(error)}`);
    }
    await fail(deps.repo, claim, code, message);
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
  // IK9Q1B：无论状态迁移是否成功都留痕。此前只有迁移成功才打 metric，
  // 出现「DB 已 failed 但 worker 无任何日志」的排查黑洞（job 985）。
  logger.warn(`video job 失败 jobId=${claim.id} code=${code} message=${message}`);
  // IK9VZ0 I5：视频无 request_id → 消费流水回退通道；release_note 按是否已向 new-api 提交区分：
  // 已提交（providerTaskId 存在，可能已扣）→ refund_unverified；未提交（派发前失败）→ refund_confirmed。
  const failed = await repo.failVideoJob({
    ...claimIdentity(claim),
    code,
    message,
    releaseNote: claim.providerTaskId ? "refund_unverified" : "refund_confirmed",
    // IKBQEE / ADR-0078：调试详情（provider 原文等）进 error.details，禁展示用户。
    details: { raw: message },
  });
  if (failed) {
    logger.metric({
      event: "task_finished",
      result: "fail",
      fields: { job_type: "video_generation", failure_code: code },
    });
  } else {
    // fencing 竞态：job 状态未迁移（可能已被另一 worker/重试处理），不计数但记录。
    logger.warn(`video job 失败但状态未迁移 jobId=${claim.id} code=${code}（fencing 竞态？）`);
  }
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
  const basePrompt =
    typeof claim.input.prompt === "string"
      ? claim.input.prompt
      : typeof claim.input.prompt_text === "string"
        ? claim.input.prompt_text
        : "";
  // IKDLQG：目标驱动视频任务的快照携带 text_attachments（接纳时冻结的当次正文），
  // 提交时按契约确定性组合；存量任务无该字段，prompt 逐字节不变。
  // 快照形状校验与图片 worker 同源（textAttachmentSnapshotSchema），损坏按无附件处理。
  const parsedAttachments = z
    .array(textAttachmentSnapshotSchema)
    .safeParse(claim.input.text_attachments ?? []);
  const prompt = composeTextAttachmentPrompt(
    parsedAttachments.success ? parsedAttachments.data : [],
    basePrompt,
  );
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

  // IKDJNZ：单数组 references 优先（input 快照冻结，保序）；未提供回落旧字段路径。
  const refsFromSingle = readReferences(claim.input.references);
  let firstFrameAssetId = readAssetId(claim.input.first_frame_asset_id);
  let lastFrameAssetId = readAssetId(claim.input.last_frame_asset_id);
  let referenceAssetIds = uniqueAssetIds(
    readAssetIds(claim.input.reference_asset_ids),
  );
  let firstFrameMaterialId = readMaterialId(claim.input.first_frame_material_id);
  let lastFrameMaterialId = readMaterialId(claim.input.last_frame_material_id);
  let referenceMaterials = uniqueMaterialRefs(
    readMaterialRefs(claim.input.reference_materials),
  );
  if (refsFromSingle !== null) {
    // 单数组：按 role 拆帧/参考，asset_id/material_id 已由 handler 校验二选一。
    firstFrameAssetId = null;
    lastFrameAssetId = null;
    referenceAssetIds = [];
    firstFrameMaterialId = null;
    lastFrameMaterialId = null;
    referenceMaterials = [];
    for (const ref of refsFromSingle) {
      if (ref.role === "first_frame") {
        // IKDJNZ review：worker 侧也守住「首尾帧必须图片」（retry 冻结快照可能含历史脏行）。
        if (ref.type !== "image") {
          throw new VideoInputError(ERROR_INVALID_INPUT, "首尾帧素材必须是图片");
        }
        if (ref.asset_id !== undefined) firstFrameAssetId = ref.asset_id;
        else if (ref.material_id !== undefined) firstFrameMaterialId = ref.material_id;
      } else if (ref.role === "last_frame") {
        if (ref.type !== "image") {
          throw new VideoInputError(ERROR_INVALID_INPUT, "首尾帧素材必须是图片");
        }
        if (ref.asset_id !== undefined) lastFrameAssetId = ref.asset_id;
        else if (ref.material_id !== undefined) lastFrameMaterialId = ref.material_id;
      } else {
        if (ref.asset_id !== undefined) referenceAssetIds.push(ref.asset_id);
        else if (ref.material_id !== undefined)
          referenceMaterials.push({ id: ref.material_id, type: ref.type });
      }
    }
    referenceAssetIds = uniqueAssetIds(referenceAssetIds);
    referenceMaterials = uniqueMaterialRefs(referenceMaterials);
  }
  if (firstFrameAssetId !== null && firstFrameMaterialId !== null) {
    throw new VideoInputError(ERROR_INVALID_INPUT, "首帧只能指定一个来源");
  }
  if (lastFrameAssetId !== null && lastFrameMaterialId !== null) {
    throw new VideoInputError(ERROR_INVALID_INPUT, "尾帧只能指定一个来源");
  }
  const hasFirstFrame = firstFrameAssetId !== null || firstFrameMaterialId !== null;
  const hasLastFrame = lastFrameAssetId !== null || lastFrameMaterialId !== null;
  const hasReferences =
    referenceAssetIds.length > 0 || referenceMaterials.length > 0;
  if (hasLastFrame && !hasFirstFrame) {
    throw new VideoInputError(ERROR_INVALID_INPUT, "尾帧必须与首帧一起使用");
  }
  // IKDJNZ：单数组 references 允许首尾帧与普通参考并存（保序单数组天然支持混排）；
  // 互斥校验仅适用于旧的分字段路径（reference_asset_ids/reference_materials/首尾帧字段）。
  if (refsFromSingle === null && (hasFirstFrame || hasLastFrame) && hasReferences) {
    throw new VideoInputError(
      ERROR_INVALID_INPUT,
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
      ERROR_REFERENCE_ASSET_UNAVAILABLE,
      "参考素材不存在或无权访问",
    );
  }

  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  // IKDJNZ：本地 Asset 若已关联素材库素材（material_id 命中），则生成时走素材库 id（asset://），
  // 不走本地 url；未关联的本地 Asset 照旧 url。关联判定按用户确认的流程：
  //   命中 material_id 的 asset 从本地引用中移除，其 material_id 并入素材库引用，
  //   合并后整个素材库引用数组按 id 去重（保留首次出现，跨 role 生效）。
  const isLinked = (assetId: string): string | null => {
    const asset = assetsById.get(assetId);
    const materialId = asset?.material_id ?? null;
    return materialId && materialId.length > 0 ? materialId : null;
  };

  // 首尾帧：若本地帧素材命中关联 → 转素材库首尾帧（同去重池）。
  // IKDJNZ：命中关联的本地帧素材即使类型为 video 也会被转成素材库引用，这里提前拦截——
  // 保留「首尾帧素材必须是图片」的既有约束（本地侧仍按原 asset 类型校验，防关联后绕过）。
  let firstFrameMaterialResolved = firstFrameMaterialId;
  let lastFrameMaterialResolved = lastFrameMaterialId;
  if (firstFrameAssetId !== null && firstFrameMaterialResolved === null) {
    const linked = isLinked(firstFrameAssetId);
    if (linked !== null) {
      const firstFrameAsset = assetsById.get(firstFrameAssetId);
      if (firstFrameAsset && firstFrameAsset.type !== "image") {
        throw new VideoInputError(
          ERROR_UNSUPPORTED_INPUT,
          "首尾帧素材必须是图片",
        );
      }
      firstFrameMaterialResolved = linked;
    }
  }
  if (lastFrameAssetId !== null && lastFrameMaterialResolved === null) {
    const linked = isLinked(lastFrameAssetId);
    if (linked !== null) {
      const lastFrameAsset = assetsById.get(lastFrameAssetId);
      if (lastFrameAsset && lastFrameAsset.type !== "image") {
        throw new VideoInputError(
          ERROR_UNSUPPORTED_INPUT,
          "首尾帧素材必须是图片",
        );
      }
      lastFrameMaterialResolved = linked;
    }
  }

  // 参考素材：命中关联的本地 asset 转素材库引用，未命中的保留本地引用。
  const materialRefsFromAssets: MaterialReference[] = [];
  const unlinkedReferenceAssetIds: string[] = [];
  for (const id of referenceAssetIds) {
    const materialId = isLinked(id);
    if (materialId !== null) {
      const asset = assetsById.get(id);
      const type: "image" | "video" | "audio" =
        asset?.type === "video"
          ? "video"
          : asset?.type === "audio"
            ? "audio"
            : "image";
      materialRefsFromAssets.push({ id: materialId, type });
    } else {
      unlinkedReferenceAssetIds.push(id);
    }
  }

  // 合并素材库引用（显式声明 + 关联转换），按 id 去重保留首次出现。
  const mergedMaterials = uniqueMaterialRefs([
    ...referenceMaterials,
    ...materialRefsFromAssets,
  ]);

  const firstFrame = firstFrameAssetId ? assetsById.get(firstFrameAssetId) : undefined;
  const lastFrame = lastFrameAssetId ? assetsById.get(lastFrameAssetId) : undefined;
  if (
    (firstFrame && firstFrame.type !== "image") ||
    (lastFrame && lastFrame.type !== "image")
  ) {
    throw new VideoInputError(
      ERROR_UNSUPPORTED_INPUT,
      "首尾帧素材必须是图片",
    );
  }
  const referenceAssets = unlinkedReferenceAssetIds.map((id) => {
    const asset = assetsById.get(id);
    if (!asset) {
      throw new VideoInputError(
        ERROR_REFERENCE_ASSET_UNAVAILABLE,
        "参考素材不存在或无权访问",
      );
    }
    return asset;
  });
  const references = validateReferences(model, referenceAssets, mergedMaterials);
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

  // 帧来源二选一：本地 Asset 解析出的 TOS URL，或素材库 asset:// URI（火山原生载体）。
  // IKDJNZ：本地帧素材命中关联（material_id）时优先走素材库 asset://（不走 url）。
  // 单数组 references 语义下帧与参考可并存，帧作为带 role 的 reference 条目传给上游。
  const firstFrameImage =
    firstFrameMaterialResolved !== null
      ? `asset://${firstFrameMaterialResolved}`
      : firstFrame?.url;
  const lastFrameImage =
    lastFrameMaterialResolved !== null
      ? `asset://${lastFrameMaterialResolved}`
      : lastFrame?.url;

  // IKDJNZ review：单数组路径把首尾帧并入 references（带 role），避免 submitVideo 的
  // 首尾帧互斥守卫拒绝并存；旧字段路径仍走 firstFrameImage/lastFrameImage 独立字段。
  const useSingleReferences = refsFromSingle !== null;
  if (useSingleReferences) {
    const frameRefs: VideoReference[] = [];
    if (firstFrameImage) frameRefs.push({ type: "image", url: firstFrameImage, role: "first_frame" });
    if (lastFrameImage) frameRefs.push({ type: "image", url: lastFrameImage, role: "last_frame" });
    return {
      model,
      prompt,
      duration,
      ...dimensions,
      resolution,
      ratio,
      references: [...frameRefs, ...references],
    };
  }

  return {
    model,
    prompt,
    duration,
    ...dimensions,
    resolution,
    ratio,
    ...(firstFrameImage ? { firstFrameImage } : {}),
    ...(lastFrameImage ? { lastFrameImage } : {}),
    references,
  };
}

/** IKDJNZ：解析单数组 references（handler 已校验格式）。未提供返回 null（走旧字段路径）。 */
type SingleReferenceItem = {
  role: "first_frame" | "last_frame" | "reference";
  asset_id?: string;
  material_id?: string;
  type: "image" | "video" | "audio";
};
function readReferences(value: unknown): SingleReferenceItem[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new VideoInputError(ERROR_INVALID_INPUT, "参考素材引用无效");
  }
  return value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      throw new VideoInputError(ERROR_INVALID_INPUT, "参考素材引用无效");
    }
    const { role, asset_id, material_id, type } = candidate as Record<
      string,
      unknown
    >;
    if (role !== "first_frame" && role !== "last_frame" && role !== "reference") {
      throw new VideoInputError(ERROR_INVALID_INPUT, "参考素材引用无效");
    }
    if (type !== "image" && type !== "video" && type !== "audio") {
      throw new VideoInputError(ERROR_INVALID_INPUT, "参考素材引用类型无效");
    }
    const item: SingleReferenceItem = { role, type };
    if (asset_id !== undefined) {
      const aid = readAssetId(asset_id);
      if (aid === null) {
        throw new VideoInputError(ERROR_INVALID_INPUT, "参考素材引用无效");
      }
      item.asset_id = aid;
    } else if (material_id !== undefined) {
      const mid = readMaterialId(material_id);
      if (mid === null) {
        throw new VideoInputError(ERROR_INVALID_INPUT, "素材库引用 ID 无效");
      }
      item.material_id = mid;
    } else {
      throw new VideoInputError(ERROR_INVALID_INPUT, "参考素材引用无效");
    }
    return item;
  });
}
