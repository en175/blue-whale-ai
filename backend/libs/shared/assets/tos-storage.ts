import { randomUUID as nodeRandomUUID } from "node:crypto";
import { TosClient } from "@volcengine/tos-sdk";

const MODEL_READING_IMAGE_PROCESS = "image/resize,l_1568/format,jpg/quality,q_85";
import type { AssetUploadStorage } from "./upload.js";
import type { AssetProbe, AssetReader, AssetSigner, MediaInfo } from "./ports.js";

export interface TosStorageConfig {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
  region: string;
  signedUrlTtlSeconds?: number;
  maxReadBytes?: number;
}

interface TosUploadClient {
  getPreSignedUrl(input: {
    bucket: string;
    key: string;
    method: "GET" | "PUT";
    expires: number;
    query?: Record<string, string>;
  }): string | Promise<string>;
  headObject(input: { bucket: string; key: string }): Promise<{
    data?: { contentLength?: number | string; contentType?: string };
    headers?: Record<string, string | undefined>;
  }>;
  putObjectAcl(input: {
    bucket: string;
    key: string;
    acl: "public-read";
  }): Promise<unknown>;
  deleteMultiObjects(input: {
    bucket: string;
    quiet?: boolean;
    objects: { key: string; versionId?: string }[];
  }): Promise<{ data?: { Deleted?: unknown[]; Error?: unknown[] } }>;
}

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === 404
  );
}

export function loadTosStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): TosStorageConfig | null {
  const accessKeyId = env.VOLC_ACCESS_KEY_ID;
  const secretAccessKey = env.VOLC_SECRET_ACCESS_KEY;
  const endpoint = env.VOLC_TOS_ENDPOINT;
  const bucket = env.VOLC_TOS_BUCKET;
  const region = env.VOLC_TOS_REGION;
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket || !region)
    return null;
  return { accessKeyId, secretAccessKey, endpoint, bucket, region };
}

export function createTosStorage(config: TosStorageConfig): {
  signer: AssetSigner;
  reader: AssetReader;
  uploads: AssetUploadStorage;
  probe: AssetProbe;
} {
  const ttlSeconds = config.signedUrlTtlSeconds ?? 600;
  const maxReadBytes = config.maxReadBytes ?? 20 * 1024 * 1024;
  const endpoint = normalizeEndpoint(config.endpoint);
  const client = new TosClient({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.secretAccessKey,
    endpoint,
    region: config.region,
  }) as unknown as TosUploadClient;

  return {
    signer: {
      async sign(storageKey, options) {
        const url = await client.getPreSignedUrl({
          bucket: config.bucket,
          key: storageKey,
          method: "GET",
          expires: ttlSeconds,
          ...(options?.forModelReading
            ? { query: { "x-tos-process": MODEL_READING_IMAGE_PROCESS } }
            : {}),
        });
        return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
      },
    },
    reader: {
      async read(storageKey) {
        const url = await client.getPreSignedUrl({
          bucket: config.bucket,
          key: storageKey,
          method: "GET",
          expires: 60,
        });
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`TOS read failed: ${res.status}`);
        }
        const contentLength = Number(res.headers.get("content-length") ?? "0");
        if (contentLength > maxReadBytes) {
          throw new Error("TOS 对象超过读取上限");
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > maxReadBytes) {
          throw new Error("TOS 对象超过读取上限");
        }
        return buf;
      },
    },
    uploads: {
      async prepareUpload(input) {
        const extension =
          MIME_EXTENSIONS[input.mime.toLowerCase()] ?? (input.type === "image" ? "jpg" : "bin");
        const storageKey = input.keyPrefix
          ? `${input.keyPrefix}/${input.type}/${nodeRandomUUID().replace(/-/g, "")}.${extension}`
          : `uploads/${input.userId}/${input.type}/${nodeRandomUUID().replace(/-/g, "")}.${extension}`;
        const uploadUrl = await client.getPreSignedUrl({
          bucket: config.bucket,
          key: storageKey,
          method: "PUT",
          expires: ttlSeconds,
        });
        return {
          storageKey,
          publicUrl: `https://${config.bucket}.${endpoint}/${storageKey}`,
          uploadUrl,
          headers: { "Content-Type": input.mime },
          expiresIn: ttlSeconds,
        };
      },
      async readHead(storageKey, length) {
        try {
          const url = await client.getPreSignedUrl({
            bucket: config.bucket,
            key: storageKey,
            method: "GET",
            expires: 60,
          });
          const res = await fetch(url, {
            headers: { range: `bytes=0-${Math.max(0, length - 1)}` },
          });
          if (!res.ok) return null;
          return new Uint8Array(await res.arrayBuffer());
        } catch {
          return null;
        }
      },
      async inspectObject(storageKey) {
        try {
          const response = await client.headObject({
            bucket: config.bucket,
            key: storageKey,
          });
          const contentLength =
            response.data?.contentLength ??
            response.headers?.["content-length"];
          const size = Number(contentLength);
          if (!Number.isFinite(size) || size < 0) {
            throw new Error("TOS HEAD response is missing content length");
          }
          return {
            size,
            mime:
              response.data?.contentType ??
              response.headers?.["content-type"] ??
              null,
            publicUrl: `https://${config.bucket}.${endpoint}/${storageKey}`,
          };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      },
      async makePublic(storageKey) {
        await client.putObjectAcl({
          bucket: config.bucket,
          key: storageKey,
          acl: "public-read",
        });
      },
      async deleteMultiObjects(storageKeys) {
        const keys = storageKeys.filter(Boolean);
        if (keys.length === 0) return;
        try {
          const result = await client.deleteMultiObjects({
            bucket: config.bucket,
            quiet: true,
            objects: keys.map((key) => ({ key })),
          });
          const errors = result?.data?.Error ?? [];
          if (errors.length > 0) {
            throw new Error(
              `TOS batch delete partial failure: ${JSON.stringify(errors)}`,
            );
          }
        } catch (error) {
          if (isNotFound(error)) return;
          throw error;
        }
      },
    },
    probe: async (storageKey) => {
      const url = await client.getPreSignedUrl({
        bucket: config.bucket,
        key: storageKey,
        method: "GET",
        expires: 60,
        query: { "x-tos-process": "video/info" },
      });
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      } catch (error) {
        throw new Error(`TOS media info request failed for ${storageKey}`, { cause: error });
      }
      if (!res.ok) {
        throw new Error(`TOS media info failed for ${storageKey}: HTTP ${res.status}`);
      }
      const contentLength = Number(res.headers.get("content-length") ?? "0");
      if (Number.isFinite(contentLength) && contentLength > 256 * 1024) {
        throw new Error(`TOS media info response too large for ${storageKey}`);
      }
      let raw: unknown;
      try {
        raw = await res.json();
      } catch {
        throw new Error(`TOS media info invalid JSON for ${storageKey}`);
      }
      return parseMediaInfo(raw);
    },
  };
}

export function parseMediaInfo(raw: unknown): MediaInfo {
  const root = isRecord(raw) ? raw : {};
  const format = isRecord(root.format) ? root.format : {};
  const streams = Array.isArray(root.streams)
    ? root.streams.filter(isRecord)
    : [];
  const mediaStreams = streams.filter((stream) => {
    if (numberValue(isRecord(stream.disposition) ? stream.disposition.attached_pic : null) === 1) {
      return false;
    }
    const type = stringValue(stream.codec_type);
    return type === "video" || type === "audio";
  });
  const durationSeconds =
    firstPositive([numberValue(format.duration)]) ??
    firstPositive(mediaStreams.map((stream) => numberValue(stream.duration)));
  const video = mediaStreams.find(
    (stream) => stringValue(stream.codec_type) === "video",
  );
  const audio = mediaStreams.find((stream) => stringValue(stream.codec_type) === "audio");
  const width = positiveNumber(numberValue(video?.width));
  const height = positiveNumber(numberValue(video?.height));
  const codec =
    stringValue(video?.codec_name) ?? stringValue(audio?.codec_name);
  const fps = parseFps(video?.avg_frame_rate);
  const sizeBytes = positiveNumber(numberValue(format.size));
  const container = stringValue(format.format_name);
  const durationMs =
    durationSeconds == null ? null : Math.round(durationSeconds * 1000);
  if (durationMs == null && width == null && sizeBytes == null) {
    throw new Error("TOS media info 缺少可用字段");
  }
  return { sizeBytes, durationMs, width, height, codec, container, fps };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function firstPositive(values: Array<number | null>): number | null {
  const found = values.find((value) => value != null && value > 0);
  return found ?? null;
}

function positiveNumber(value: number | null): number | null {
  return value != null && value > 0 ? value : null;
}

function parseFps(value: unknown): number | null {
  const text = stringValue(value);
  if (text === null) {
    return null;
  }
  const slash = text.indexOf("/");
  if (slash < 0) {
    const parsed = numberValue(text);
    return parsed != null && parsed > 0 ? parsed : null;
  }
  const numerator = numberValue(text.slice(0, slash));
  const denominator = numberValue(text.slice(slash + 1));
  if (numerator == null || denominator == null || denominator === 0) {
    return null;
  }
  const parsed = numerator / denominator;
  return parsed > 0 ? Math.round(parsed * 1000) / 1000 : null;
}
