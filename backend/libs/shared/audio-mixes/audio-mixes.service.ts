import { Injectable } from "@nestjs/common";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { loadTosStorageConfig } from "@lib/shared/assets/tos-storage.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import {
  AUDIO_MIX_JOB_TYPE,
  AUDIO_MIX_SOURCE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  FAILURE_CODE,
  DomainError,
  audioMixCreateSchema,
  ok,
} from "@lib/contracts";

@Injectable()
export class AudioMixesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
    private readonly storage: AssetStorageService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: unknown,
    internal: { providerCredential?: string } = {},
  ) {
    const parsed = audioMixCreateSchema.safeParse(body);
    if (!parsed.success) throw new DomainError(PARAM_MISSING_CODE, parsed.error.issues[0]?.message ?? "音频混合参数非法");

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) throw new DomainError(RESOURCE_NOT_FOUND_CODE);

    const links = await this.prisma.client.project_asset.findMany({
      where: { user_id: BigInt(userId), project_id: BigInt(projectId), is_delete: 0 },
      select: { asset_id: true },
    });
    const linkedIds = new Set(links.map((link) => link.asset_id.toString()));
    const uploads = this.storage.uploads;
    if (!uploads) throw new DomainError(FAILURE_CODE, "音频存储不可用");

    const frozenInputs: Array<{ asset_id: string; node_id?: string; url: string }> = new Array(parsed.data.inputs.length);
    const durations: Array<number | null> = new Array(parsed.data.inputs.length);
    const abort = new AbortController();
    let nextIndex = 0;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(() => {
        abort.abort();
        reject(new DomainError(FAILURE_CODE, "音频资产校验超时"));
      }, 15_000);
    });
    const resolveNext = async () => {
      while (!abort.signal.aborted && nextIndex < parsed.data.inputs.length) {
        const index = nextIndex++;
        const input = parsed.data.inputs[index]!;
        const asset = await this.assets.findOwnedSource(input.asset_id, userId);
        if (!asset) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
        if (asset.project_id !== BigInt(projectId) && asset.project_id !== 0n && !linkedIds.has(input.asset_id)) {
          throw new DomainError(RESOURCE_NOT_FOUND_CODE);
        }
        if (asset.type !== "audio" || !/^(https?:\/\/|mediakit:\/\/|vod:\/\/|tos:\/\/)/i.test(asset.url)) {
          throw new DomainError(FAILURE_CODE, "音频资产不可用");
        }
        let storageKey = asset.storage_key;
        if (!storageKey) {
          // 兼容历史 TOS Asset：已完成音频可能仅保留公网 URL，仍须限制在我方桶后还原 key 验对象。
          const config = loadTosStorageConfig();
          const endpoint = config?.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
          const origin = config ? `https://${config.bucket}.${endpoint}` : null;
          try {
            const url = new URL(asset.url);
            if (!origin || url.origin !== origin || !url.pathname || url.pathname === "/" || url.search) {
              throw new Error("不是我方 TOS 公网对象");
            }
            storageKey = decodeURIComponent(url.pathname.slice(1));
          } catch {
            throw new DomainError(FAILURE_CODE, "音频资产不可用");
          }
        }
        let publicUrl: string;
        try {
          const object = await uploads.inspectObject(storageKey);
          if (!object || object.size <= 0 || new URL(object.publicUrl).protocol !== "https:") {
            throw new Error("音频对象不存在或无法公开读取");
          }
          const response = await fetch(object.publicUrl, {
            method: "GET",
            headers: { Range: "bytes=0-0" },
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5_000)]),
          });
          await response.body?.cancel();
          if (!response.ok) throw new Error(`音频公开读取失败: HTTP ${response.status}`);
          publicUrl = object.publicUrl;
        } catch {
          throw new DomainError(FAILURE_CODE, "音频资产不可用");
        }
        frozenInputs[index] = {
          asset_id: input.asset_id,
          ...(input.node_id ? { node_id: input.node_id } : {}),
          url: publicUrl,
        };
        durations[index] = asset.duration_ms == null || !Number.isFinite(asset.duration_ms) || asset.duration_ms < 0
          ? null : asset.duration_ms;
      }
    };
    try {
      await Promise.race([
        Promise.all(Array.from({ length: Math.min(8, parsed.data.inputs.length) }, () => resolveNext())),
        deadline,
      ]);
    } catch (error) {
      abort.abort();
      throw error;
    } finally {
      clearTimeout(deadlineTimer);
    }
    const estimatedDurationMs = durations.some((duration) => duration === null)
      ? null : Math.max(...(durations as number[]));

    const job = await this.prisma.client.generation_jobs.create({
      data: {
        user_id: BigInt(userId),
        project_id: BigInt(projectId),
        type: AUDIO_MIX_JOB_TYPE,
        source: AUDIO_MIX_SOURCE,
        status: "queued",
        progress: 0,
        expected_output_count: 1,
        input: {
          source_node_id: parsed.data.source_node_id,
          inputs: frozenInputs,
          output_format: parsed.data.output_format,
          estimated_duration_ms: estimatedDurationMs,
          ...(internal.providerCredential ? { provider_credential: internal.providerCredential } : {}),
        },
        next_action_at: new Date(Date.now() - 60_000),
      },
    });
    return ok({ job_id: job.id.toString(), status: "queued" });
  }

  async markFailed(jobId: string, code: string, message: string): Promise<void> {
    await createGenerationCommandRepo(this.prisma.client).markFailedQueued(jobId, code, message);
  }
}
