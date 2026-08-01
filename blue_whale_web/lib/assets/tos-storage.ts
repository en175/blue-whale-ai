import { randomUUID as nodeRandomUUID } from "node:crypto";
import { buildTosPresignedGetUrl } from "@blue-whale/core";
import { TosClient } from "@volcengine/tos-sdk";

import type { AssetUploadStorage } from "./handle-upload";
import type { AssetReader, AssetSigner } from "./ports";

/**
 * TOS 对象存储适配器：用 core 的 SigV4 预签名实现 AssetSigner/AssetReader。
 * 对齐 Java TosGenerationStorage（GenerationObjectSigner + GenerationObjectReader）。
 *
 * - sign：buildTosPresignedGetUrl（GET 预签名）。
 * - read：预签名后用全局 fetch 拉字节，带大小上限保护（对齐 Java maxReadBytes）。
 *
 * 缺少任一 TOS 环境变量时整体返回 null —— 等价 Java ObjectProvider 缺 Bean，路径判 100202。
 *
 * ⚠️ 算法已配确定性单测（core/tos-presigned-url.test.ts），但本环境未对接真实 TOS；
 *   read 依赖网络，集成路径需真实 AK/SK + TOS 连通后才能验。
 */
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
    method: "PUT";
    expires: number;
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
}

interface TosStorageDependencies {
  client?: TosUploadClient;
  randomUUID?: () => string;
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

export function createTosStorage(
  config: TosStorageConfig,
  dependencies: TosStorageDependencies = {},
): {
  signer: AssetSigner;
  reader: AssetReader;
  uploads: AssetUploadStorage;
} {
  const ttlSeconds = config.signedUrlTtlSeconds ?? 600;
  const maxReadBytes = config.maxReadBytes ?? 20 * 1024 * 1024;
  const endpoint = normalizeEndpoint(config.endpoint);
  const client: TosUploadClient =
    dependencies.client ??
    (new TosClient({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.secretAccessKey,
      endpoint,
      region: config.region,
    }) as unknown as TosUploadClient);
  const randomUUID = dependencies.randomUUID ?? nodeRandomUUID;

  return {
    signer: {
      async sign(storageKey) {
        const { url, expiresAt } = buildTosPresignedGetUrl({
          endpoint,
          bucket: config.bucket,
          region: config.region,
          ak: config.accessKeyId,
          sk: config.secretAccessKey,
          key: storageKey,
          expiresInSeconds: ttlSeconds,
        });
        return { url, expiresAt };
      },
    },
    reader: {
      async read(storageKey) {
        const { url } = buildTosPresignedGetUrl({
          endpoint,
          bucket: config.bucket,
          region: config.region,
          ak: config.accessKeyId,
          sk: config.secretAccessKey,
          key: storageKey,
          expiresInSeconds: 60,
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
        const extension = MIME_EXTENSIONS[input.mime.toLowerCase()] ?? "bin";
        const storageKey = `uploads/${input.userId}/${input.type}/${randomUUID().replace(/-/g, "")}.${extension}`;
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
    },
  };
}
