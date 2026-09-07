import { createLogger, timedProviderCall } from "@blue-whale/core/logging";
import { composeTextAttachmentPrompt } from "@blue-whale/core";
import { z } from "zod";
import {
  ERROR_INVALID_INPUT,
  ERROR_PROVIDER_CREDENTIAL_MISSING,
  ERROR_PROVIDER_FAILED,
  ERROR_PROVIDER_TIMEOUT,
  ERROR_REFERENCE_ASSET_UNAVAILABLE,
  ERROR_REFERENCE_LIMIT_EXCEEDED,
  ERROR_UNSUPPORTED_INPUT,
  textAttachmentSnapshotSchema,
} from "@blue-whale/contracts";

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

/**
 * 素材库引用（MaterialReference）：视频生成输入里对上游素材库素材的引用。
 * 零本地落表：类型由调用方在创建任务时声明，Worker 只做格式校验并转成
 * `asset://<素材ID>` 载体交给网关；存在性/状态/物理约束由上游强校验。
 */
export type MaterialReference = {
  id: string;
  /** IKDJNZ：支持参考音频（type:"audio"，素材库音频引用；不占图/视频额度）。 */
  type: "image" | "video" | "audio";
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

class VideoInputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VideoInputError";
  }
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
  materials: MaterialReference[],
): VideoReference[] {
  let imageCount = 0;
  let videoCount = 0;
  let audioCount = 0;
  let knownVideoDuration = 0;
  const references = assets.map<VideoReference>((asset) => {
    if (asset.type === "image") {
      imageCount += 1;
      return { type: "image", url: asset.url };
    }
    if (asset.type === "audio") {
      // IKDJNZ：参考音频——本地音频素材作为 audio reference 支持（不占图/视频额度）。
      audioCount += 1;
      return { type: "audio", url: asset.url };
    }
    if (asset.type !== "video") {
      throw new VideoInputError(
        ERROR_UNSUPPORTED_INPUT,
        "视频生成只支持图片、视频或音频参考素材",
      );
    }
    videoCount += 1;
    validateReferenceVideo(asset);
    if (asset.duration !== null && asset.duration !== undefined) {
      knownVideoDuration += asset.duration;
    }
    return { type: "video", url: asset.url };
  });

  // IKDJNZ：素材库引用（显式声明 + 关联转换）并入 references，统一按素材库来源在前、
  // 未关联本地 Asset 在后排列（对齐前端「素材库引用在前、本地参考在后」的既有提交顺序，
  // 避免破坏现有断言）；图/视频数量与 Seedance 2.0 约束按并集统计，参考音频（image/video 之外的
  // 素材库音频引用）不占图/视频额度。
  const materialRefs = materials.map<VideoReference>((material) => {
    if (material.type === "image") {
      imageCount += 1;
    } else if (material.type === "video") {
      videoCount += 1;
    } else {
      audioCount += 1;
    }
    return { type: material.type, url: `asset://${material.id}` };
  });
  references.unshift(...materialRefs);

  if (imageCount > MAX_REFERENCE_IMAGES || videoCount > MAX_REFERENCE_VIDEOS) {
    throw new VideoInputError(
      ERROR_REFERENCE_LIMIT_EXCEEDED,
      "Seedance 2.0 最多支持 9 张参考图片和 3 个参考视频",
    );
  }
  // IKDJNZ：参考音频与 Seedance 2.0 视频输入绑定（参考音频走 Ark video content.audio_url，
  // 非 2.0 系列不支持）；音频数量上限沿用「每任务最多 3 个参考视频」同档约束，上游强校验。
  if (audioCount > MAX_REFERENCE_VIDEOS) {
    throw new VideoInputError(
      ERROR_REFERENCE_LIMIT_EXCEEDED,
      "Seedance 2.0 最多支持 3 个参考音频",
    );
  }
  if ((videoCount > 0 || audioCount > 0) && !isSeedance2Model(model)) {
    throw new VideoInputError(
      ERROR_UNSUPPORTED_INPUT,
      "只有 Seedance 2.0 支持参考视频和参考音频",
    );
  }
  if (knownVideoDuration > MAX_REFERENCE_VIDEO_SECONDS) {
    throw new VideoInputError(
      ERROR_INVALID_INPUT,
      "参考视频已知总时长不能超过 15 秒",
    );
  }
  return references;
}

function validateReferenceVideo(asset: VideoWorkerInputAsset): void {
  const mime = asset.mime?.split(";", 1)[0]?.trim().toLowerCase();
  if (mime && !REFERENCE_VIDEO_MIMES.has(mime)) {
    throw new VideoInputError(
      ERROR_INVALID_INPUT,
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
      ERROR_INVALID_INPUT,
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
      ERROR_INVALID_INPUT,
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
      ERROR_INVALID_INPUT,
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
      ERROR_INVALID_INPUT,
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
  throw new VideoInputError(ERROR_INVALID_INPUT, "视频素材 ID 无效");
}

function readAssetIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new VideoInputError(ERROR_INVALID_INPUT, "视频参考素材无效");
  }
  return value.map((candidate) => {
    const id = readAssetId(candidate);
    if (id === null) {
      throw new VideoInputError(ERROR_INVALID_INPUT, "视频参考素材 ID 无效");
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

const MATERIAL_ID_PATTERN = /^[Aa]sset-.{1,128}$/;

function readMaterialId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && MATERIAL_ID_PATTERN.test(value)) return value;
  throw new VideoInputError(ERROR_INVALID_INPUT, "素材库引用 ID 无效");
}

function readMaterialRefs(value: unknown): MaterialReference[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new VideoInputError(ERROR_INVALID_INPUT, "素材库参考素材无效");
  }
  return value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      throw new VideoInputError(ERROR_INVALID_INPUT, "素材库参考素材无效");
    }
    const { id, type } = candidate as { id?: unknown; type?: unknown };
    const materialId = readMaterialId(id);
    if (materialId === null) {
      throw new VideoInputError(ERROR_INVALID_INPUT, "素材库引用 ID 无效");
    }
    if (type !== "image" && type !== "video" && type !== "audio") {
      throw new VideoInputError(
        ERROR_INVALID_INPUT,
        "素材库参考素材类型无效",
      );
    }
    return { id: materialId, type };
  });
}

function uniqueMaterialRefs(refs: MaterialReference[]): MaterialReference[] {
  return refs.reduce<MaterialReference[]>((result, ref) => {
    if (!result.some((r) => r.id === ref.id)) result.push(ref);
    return result;
  }, []);
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
