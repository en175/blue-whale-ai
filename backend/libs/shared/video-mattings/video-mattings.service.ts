import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  VIDEO_MATTING_CLIENT_TOKEN_PATTERN,
  VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR,
  VIDEO_MATTING_DEFAULT_FORMAT,
  VIDEO_MATTING_INPUT_KEYS,
  VIDEO_MATTING_JOB_TYPE,
  VIDEO_MATTING_MAX_DURATION_MS,
  VIDEO_MATTING_SOURCE,
  fail,
  ok,
  videoMattingInputSchema,
  type VideoMattingInput,
} from "@lib/contracts";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import {
  createMediaToolJobWithRecovery,
  mediaToolRequestHash,
  readAcceptedMediaToolReplay,
  renderMediaToolReplay,
  stripCanvasBinding,
  type MediaToolRecovery,
} from "@lib/shared/generation/media-tool-recovery.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

const IDEMPOTENCY_OPERATION = "video_matting.create";
const REQUEST_PATH = "/video-mattings";

const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [VIDEO_MATTING_INPUT_KEYS.sourceAssetId]: "缺少或非法的源素材 ID（source_asset_id）",
  [VIDEO_MATTING_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [VIDEO_MATTING_INPUT_KEYS.mode]: "抠像模式仅支持 portrait（人像）/ greenscreen（绿幕）",
  [VIDEO_MATTING_INPUT_KEYS.format]: "输出格式仅支持 WEBM / MP4",
  [VIDEO_MATTING_INPUT_KEYS.backgroundColor]: "背景色仅支持 white / black / green",
};

function readableParseError(
  issues: readonly { code: string; message?: string; path: readonly (string | number | symbol)[]; keys?: readonly string[] }[],
): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    return "请求包含不支持的参数，仅允许智能抠像任务的 source_asset_id / target_node_id / mode / format / background_color / client_token 键";
  }
  if (first?.code === "custom" && first.message) {
    return first.message;
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

function requestHashOf(projectId: string, input: VideoMattingInput): string {
  return createHash("sha256")
    .update(
      `POST:/api/projects/${projectId}/video-mattings` +
        `:${input[VIDEO_MATTING_INPUT_KEYS.sourceAssetId]}` +
        `\0${input[VIDEO_MATTING_INPUT_KEYS.targetNodeId]}` +
        `\0${input[VIDEO_MATTING_INPUT_KEYS.mode]}` +
        `\0${input[VIDEO_MATTING_INPUT_KEYS.format]}` +
        `\0${input[VIDEO_MATTING_INPUT_KEYS.backgroundColor] ?? ""}`,
    )
    .digest("hex");
}

@Injectable()
export class VideoMattingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: Record<string, unknown>,
  ) {
    const { client_token: clientToken, ...withoutToken } = body ?? {};
    if (
      typeof clientToken !== "string" ||
      !VIDEO_MATTING_CLIENT_TOKEN_PATTERN.test(clientToken)
    ) {
      return fail(PARAM_MISSING_CODE, "缺少或非法的 client_token（幂等键，≤64 位可打印 ASCII、大小写敏感）");
    }
    const gate = stripCanvasBinding(withoutToken, "client_token", clientToken);
    if (gate.error) return gate.error;
    const { binding, rest } = gate;

    const normalizedBody: Record<string, unknown> = { ...rest };
    if (normalizedBody[VIDEO_MATTING_INPUT_KEYS.format] === undefined) {
      normalizedBody[VIDEO_MATTING_INPUT_KEYS.format] = VIDEO_MATTING_DEFAULT_FORMAT;
    }
    if (
      normalizedBody[VIDEO_MATTING_INPUT_KEYS.format] === "MP4" &&
      normalizedBody[VIDEO_MATTING_INPUT_KEYS.backgroundColor] === undefined
    ) {
      normalizedBody[VIDEO_MATTING_INPUT_KEYS.backgroundColor] =
        VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR;
    }
    const parsed = videoMattingInputSchema.safeParse(normalizedBody);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: VideoMattingInput = parsed.data;
    const requestHash = binding
      ? mediaToolRequestHash(IDEMPOTENCY_OPERATION, projectId, REQUEST_PATH, body ?? {})
      : requestHashOf(projectId, input);

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    const recovery: MediaToolRecovery | null = binding
      ? {
          projectId,
          userId,
          taskType: VIDEO_MATTING_JOB_TYPE,
          operation: IDEMPOTENCY_OPERATION,
          requestHash,
          binding,
        }
      : null;
    const replay = recovery
      ? await readAcceptedMediaToolReplay(this.prisma.client, recovery)
      : await readAcceptedMediaToolReplay(this.prisma.client, {
          projectId,
          operation: IDEMPOTENCY_OPERATION,
          requestHash,
          key: clientToken,
        });
    if (replay) {
      return renderMediaToolReplay(
        replay,
        binding
          ? undefined
          : () => fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）"),
      );
    }

    const asset = await this.assets.findOwnedSource(
      input[VIDEO_MATTING_INPUT_KEYS.sourceAssetId],
      userId,
    );
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "video") {
      return fail(FAILURE_CODE, "仅支持对视频资产发起智能抠像");
    }

    if (asset.duration_ms != null && asset.duration_ms > VIDEO_MATTING_MAX_DURATION_MS) {
      return fail(FAILURE_CODE, "暂支持 10 分钟以内的视频智能抠像");
    }

    const frozenInput: VideoMattingInput = { ...input };

    const outcome = await createMediaToolJobWithRecovery(
      this.prisma.client,
      recovery,
      async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: VIDEO_MATTING_JOB_TYPE,
            source: VIDEO_MATTING_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
      binding
        ? undefined
        : { projectId, operation: IDEMPOTENCY_OPERATION, requestHash, key: clientToken },
    );
    if (outcome.kind === "envelope") return outcome.envelope;
    if (outcome.kind === "idempotency_conflict") {
      if (binding) return fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷");
      return fail(IDEMPOTENCY_KEY_REUSED_CODE, "client_token 已被使用（同 token 仅可重放相同参数）");
    }
    return ok({
      job_id: outcome.jobId,
      status: outcome.status,
      ...(outcome.bindingView ? { canvas_binding: outcome.bindingView } : {}),
    });
  }

  async markFailed(
    jobId: string,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await createGenerationCommandRepo(this.prisma.client).markFailedQueued(
      jobId,
      code,
      message,
      details,
    );
  }
}
