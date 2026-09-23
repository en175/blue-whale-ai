import { Injectable } from "@nestjs/common";
import { AssetService } from "@lib/shared/assets/assets.service.js";
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

    const frozenInputs: Array<{ asset_id: string; node_id?: string; url: string }> = [];
    for (const input of parsed.data.inputs) {
      const asset = await this.assets.findOwnedSource(input.asset_id, userId);
      if (!asset) throw new DomainError(RESOURCE_NOT_FOUND_CODE);
      if (asset.project_id !== BigInt(projectId) && asset.project_id !== 0n && !linkedIds.has(input.asset_id)) {
        throw new DomainError(RESOURCE_NOT_FOUND_CODE);
      }
      if (asset.type !== "audio" || !asset.storage_key || !/^(https?:\/\/|mediakit:\/\/|vod:\/\/|tos:\/\/)/i.test(asset.url)) {
        throw new DomainError(FAILURE_CODE, "音频资产不可用");
      }
      frozenInputs.push({
        asset_id: input.asset_id,
        ...(input.node_id ? { node_id: input.node_id } : {}),
        url: asset.url,
      });
    }

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
