import { Injectable } from "@nestjs/common";
import {
  AUDIO_MIX_JOB_TYPE,
  AUDIO_MIX_MAX_INPUTS,
  AUDIO_MIX_MIN_INPUTS,
  AUDIO_SPEED_JOB_TYPE,
  AUDIO_SPEED_MAX_SPEED,
  AUDIO_SPEED_MIN_SPEED,
  AUDIO_TRIM_JOB_TYPE,
  AUDIO_VIDEO_MUX_JOB_TYPE,
  MEDIA_EXTRACT_JOB_TYPE,
  VIDEO_ENHANCE_JOB_TYPE,
  VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
  VIDEO_MATTING_JOB_TYPE,
  VIDEO_MATTING_MAX_DURATION_MS,
  VIDEO_SCENE_SPLIT_JOB_TYPE,
  VIDEO_SCENE_SPLIT_MAX_DURATION_MS,
  VIDEO_SUBTITLE_ERASE_JOB_TYPE,
  VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
  VOCAL_SPLIT_JOB_TYPE,
  roundAudioSpeed,
  roundAudioTrimSeconds,
} from "@lib/contracts";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import {
  resolveSourceDuration,
  storageKeyOfAsset,
  type ResolvedSourceDuration,
  type SecondsPolicy,
} from "@lib/shared/media-tools/source-duration.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import {
  MediaToolBillingService,
  type MediaToolQuote,
} from "./media-tool-billing.service.js";
import {
  CONSTANT_PRICING_TOOLS,
  MUX_SYNC_MODES,
  SINGLE_SOURCE_SECONDS_TOOLS,
  mixChargeSeconds,
  muxChargeInput,
  speedChargeSeconds,
  trimChargeSeconds,
  type MuxSyncMode,
} from "./tool-quote-input.js";

const EMPTY_QUOTE: MediaToolQuote = { credits: null, quote_revision: null };
const ASSET_ID_PATTERN = /^[1-9][0-9]*$/;

const SINGLE_SOURCE_TYPES: Record<string, readonly string[]> = {
  [MEDIA_EXTRACT_JOB_TYPE]: ["video"],
  [VIDEO_ENHANCE_JOB_TYPE]: ["video"],
  [VIDEO_FRAME_INTERPOLATION_JOB_TYPE]: ["video"],
  [VIDEO_MATTING_JOB_TYPE]: ["video"],
  [VIDEO_SCENE_SPLIT_JOB_TYPE]: ["video"],
  [VIDEO_SUBTITLE_ERASE_JOB_TYPE]: ["video"],
  [VOCAL_SPLIT_JOB_TYPE]: ["video", "audio"],
  [AUDIO_TRIM_JOB_TYPE]: ["audio"],
  [AUDIO_SPEED_JOB_TYPE]: ["audio"],
};

const MAX_DURATION_MS: Record<string, number> = {
  [VIDEO_MATTING_JOB_TYPE]: VIDEO_MATTING_MAX_DURATION_MS,
  [VIDEO_SCENE_SPLIT_JOB_TYPE]: VIDEO_SCENE_SPLIT_MAX_DURATION_MS,
  [VIDEO_SUBTITLE_ERASE_JOB_TYPE]: VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
};

const FLOOR_SECONDS_TOOLS: ReadonlySet<string> = new Set([
  VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
  VIDEO_MATTING_JOB_TYPE,
  VIDEO_SUBTITLE_ERASE_JOB_TYPE,
]);

function assetIdOf(value: unknown): string | null {
  return typeof value === "string" && ASSET_ID_PATTERN.test(value) ? value : null;
}

function numberOrUndefined(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trimTimeOrUndefined(value: unknown): number | undefined | null {
  const number = numberOrUndefined(value);
  if (number == null) return number;
  return number >= 0 ? roundAudioTrimSeconds(number) : null;
}

@Injectable()
export class MediaToolQuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetService,
    private readonly storage: AssetStorageService,
    private readonly billing: MediaToolBillingService,
  ) {}

  async quote(
    toolType: string,
    userId: string,
    raw: Record<string, unknown>,
  ): Promise<MediaToolQuote> {
    try {
      const input = await this.derive(toolType, userId, raw);
      if (input === null) return EMPTY_QUOTE;
      return await this.billing.quote(toolType, userId, input);
    } catch (error) {
      logger.warn(
        `[billing] 工具报价推导失败：tool=${toolType} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return EMPTY_QUOTE;
    }
  }

  private async source(
    userId: string,
    assetId: string | null,
    expectedTypes: readonly string[],
    maxDurationMs?: number,
    probeDimensions = false,
    secondsPolicy?: SecondsPolicy,
  ): Promise<ResolvedSourceDuration | null> {
    if (assetId === null) return null;
    const asset = await this.assets.findOwnedSource(assetId, userId);
    if (!asset || !expectedTypes.includes(asset.type)) return null;
    const resolved = await resolveSourceDuration({
      prisma: this.prisma.client,
      storage: this.storage,
      asset: {
        id: assetId,
        storage_key: storageKeyOfAsset(asset),
        duration_ms: asset.duration_ms,
        width: asset.width,
        height: asset.height,
      },
      probeDimensions,
      ...(secondsPolicy ? { secondsPolicy } : {}),
    });
    if (resolved === null) return null;
    if (maxDurationMs !== undefined && resolved.durationMs > maxDurationMs) {
      return null;
    }
    return {
      ...resolved,
      width: resolved.width ?? asset.width,
      height: resolved.height ?? asset.height,
    };
  }

  private async derive(
    toolType: string,
    userId: string,
    raw: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    if (CONSTANT_PRICING_TOOLS.has(toolType)) return raw;
    if (SINGLE_SOURCE_SECONDS_TOOLS.has(toolType)) {
      return this.deriveSingleSource(toolType, userId, raw);
    }
    switch (toolType) {
      case AUDIO_TRIM_JOB_TYPE:
        return this.deriveTrim(userId, raw);
      case AUDIO_SPEED_JOB_TYPE:
        return this.deriveSpeed(userId, raw);
      case AUDIO_MIX_JOB_TYPE:
        return this.deriveMix(userId, raw);
      case AUDIO_VIDEO_MUX_JOB_TYPE:
        return this.deriveMux(userId, raw);
      default:
        return null;
    }
  }

  private async deriveSingleSource(
    toolType: string,
    userId: string,
    raw: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const resolved = await this.source(
      userId,
      assetIdOf(raw.source_asset_id),
      SINGLE_SOURCE_TYPES[toolType] ?? [],
      MAX_DURATION_MS[toolType],
      false,
      FLOOR_SECONDS_TOOLS.has(toolType) ? "floor" : undefined,
    );
    return resolved === null ? null : { ...raw, duration: resolved.seconds };
  }

  private async deriveTrim(
    userId: string,
    raw: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const start = trimTimeOrUndefined(raw.start_time);
    const end = trimTimeOrUndefined(raw.end_time);
    if (start === null || end === null) return null;
    if (start !== undefined && end !== undefined && start >= end) return null;
    const resolved = await this.source(
      userId,
      assetIdOf(raw.source_asset_id),
      SINGLE_SOURCE_TYPES[AUDIO_TRIM_JOB_TYPE]!,
    );
    if (resolved === null) return null;
    const duration = trimChargeSeconds(start, end, resolved.seconds);
    return duration > 0 ? { ...raw, duration } : null;
  }

  private async deriveSpeed(
    userId: string,
    raw: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const speed = raw.speed === undefined ? 1 : numberOrUndefined(raw.speed);
    if (speed === null || speed === undefined) return null;
    if (speed < AUDIO_SPEED_MIN_SPEED || speed > AUDIO_SPEED_MAX_SPEED) return null;
    if (roundAudioSpeed(speed) !== speed) return null;
    const resolved = await this.source(
      userId,
      assetIdOf(raw.source_asset_id),
      SINGLE_SOURCE_TYPES[AUDIO_SPEED_JOB_TYPE]!,
    );
    return resolved === null
      ? null
      : { ...raw, duration: speedChargeSeconds(resolved.seconds, speed) };
  }

  private async deriveMix(
    userId: string,
    raw: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    if (!Array.isArray(raw.inputs)) return null;
    if (raw.inputs.length < AUDIO_MIX_MIN_INPUTS || raw.inputs.length > AUDIO_MIX_MAX_INPUTS) {
      return null;
    }
    const ids = raw.inputs.map((input) =>
      assetIdOf(
        typeof input === "object" && input !== null
          ? (input as { asset_id?: unknown }).asset_id
          : undefined,
      ),
    );
    if (ids.some((id) => id === null)) return null;
    if (new Set(ids).size !== ids.length) return null;
    const resolved = await Promise.all(
      ids.map((id) => this.source(userId, id, ["audio"])),
    );
    if (resolved.some((item) => item === null)) return null;
    return {
      ...raw,
      duration: mixChargeSeconds(
        (resolved as ResolvedSourceDuration[]).map((item) => item.durationMs),
      ),
    };
  }

  private async deriveMux(
    userId: string,
    raw: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const audioId = assetIdOf(
      typeof raw.audio === "object" && raw.audio !== null
        ? (raw.audio as { assetId?: unknown }).assetId
        : undefined,
    );
    const videoId = assetIdOf(
      typeof raw.video === "object" && raw.video !== null
        ? (raw.video as { assetId?: unknown }).assetId
        : undefined,
    );
    const sync = raw.sync === undefined ? "none" : raw.sync;
    if (!(MUX_SYNC_MODES as readonly unknown[]).includes(sync)) return null;
    const [audio, video] = await Promise.all([
      this.source(userId, audioId, ["audio"]),
      this.source(userId, videoId, ["video"], undefined, true),
    ]);
    if (audio === null || video === null) return null;
    const charged = muxChargeInput({
      videoMs: video.durationMs,
      audioMs: audio.durationMs,
      sync: sync as MuxSyncMode,
      width: video.width,
      height: video.height,
    });
    return charged === null ? null : { ...raw, ...charged };
  }
}
