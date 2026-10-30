import type { PrismaClient } from "@prisma/client";
import {
  ASSET_UNAVAILABLE_CODE,
  FAILURE_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  type ResultEnvelope,
} from "@lib/contracts";
import type { AssetService } from "@lib/shared/assets/assets.service.js";
import type { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import type { ProjectService } from "@lib/shared/project/project.service.js";
import {
  resolveSourceDuration,
  type ResolvedSourceDuration,
  type SecondsPolicy,
} from "./source-duration.js";

type OwnedAsset = NonNullable<
  Awaited<ReturnType<AssetService["findOwnedSource"]>>
>;

export type MediaAssetType = "video" | "audio" | "image";

export async function requireOwnedProject(args: {
  projects: Pick<ProjectService, "findOwnedById">;
  projectId: string;
  userId: string;
}): Promise<ResultEnvelope<never> | null> {
  const project = await args.projects.findOwnedById(args.projectId, args.userId);
  return project ? null : fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
}

export async function resolveOwnedMediaSource(args: {
  prisma: PrismaClient;
  assets: Pick<AssetService, "findOwnedSource">;
  storage?: AssetStorageService;
  userId: string;
  assetId: string;
  expectedTypes: ReadonlyArray<MediaAssetType>;
  wrongTypeMessage: string;
  durationMessage?: string;
  probeDimensions?: boolean;
  secondsPolicy?: SecondsPolicy;
  maxDurationMs?: number;
  maxDurationMessage?: string;
}): Promise<
  | {
      ok: true;
      asset: OwnedAsset;
      duration: ResolvedSourceDuration | null;
    }
  | { ok: false; envelope: ResultEnvelope<never> }
> {
  const asset = await args.assets.findOwnedSource(args.assetId, args.userId);
  if (!asset) {
    return { ok: false, envelope: fail(RESOURCE_NOT_FOUND_CODE, "资源不存在") };
  }
  if (!args.expectedTypes.includes(asset.type as MediaAssetType)) {
    return { ok: false, envelope: fail(FAILURE_CODE, args.wrongTypeMessage) };
  }
  if (!args.durationMessage) {
    return { ok: true, asset, duration: null };
  }
  const duration = await resolveSourceDuration({
    prisma: args.prisma,
    storage: args.storage!,
    asset: {
      id: args.assetId,
      storage_key: asset.storage_key,
      duration_ms: asset.duration_ms,
      ...(args.probeDimensions ? { width: asset.width, height: asset.height } : {}),
    },
    ...(args.probeDimensions ? { probeDimensions: true } : {}),
    ...(args.secondsPolicy ? { secondsPolicy: args.secondsPolicy } : {}),
  });
  if (duration === null) {
    return {
      ok: false,
      envelope: fail(ASSET_UNAVAILABLE_CODE, args.durationMessage, {
        code: "asset_unavailable",
      }),
    };
  }
  if (args.maxDurationMs !== undefined && duration.durationMs > args.maxDurationMs) {
    return {
      ok: false,
      envelope: fail(
        FAILURE_CODE,
        args.maxDurationMessage ?? "素材时长超出限制",
      ),
    };
  }
  return { ok: true, asset, duration };
}
