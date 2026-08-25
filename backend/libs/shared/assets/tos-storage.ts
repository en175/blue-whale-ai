import { randomUUID as nodeRandomUUID } from "node:crypto";
import { TosClient } from "@volcengine/tos-sdk";

/**
 * 给模型读图时的 TOS 图片处理参数（IKAZC2）。
 *
 * `l_1568` 限长边而不是限宽或高——竖图横图一视同仁；`format,jpg` 是因为 PNG 对照片类内容
 * 是最坏的编码（那张 8MB 的图正是 PNG）；`q_85` 是肉眼无损与体积的常规折中。
 *
 * 1568 对齐主流视觉模型的处理分辨率上限。调这个数之前先确认模型侧真的能吃下更大的，否则
 * 只是把钱花在会被对方丢掉的像素上。
 */
const MODEL_READING_IMAGE_PROCESS = "image/resize,l_1568/format,jpg/quality,q_85";
import type { AssetUploadStorage } from "./upload.js";
import type { AssetReader, AssetSigner } from "./ports.js";

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
      /**
       * 读取用的预签名 GET URL —— 走官方 SDK（IKAL46）。
       *
       * 这里原本调的是手写的 `buildTosPresignedGetUrl`。那份实现自己的注释就写着「本环境未对接
       * 真实 TOS 做端到端校验」，而 2026-08-25 第一次真跑就被 TOS 以
       * `SignatureDoesNotMatch` 403 拒绝：素材授权建好了、URL 也签出来了，模型侧一下载就失败，
       * 表现成「读不到图」。同一个文件里的上传 PUT 预签名一直走 SDK 且一直可用，没有理由让
       * 读取这一侧单独手写一套 SigV4。
       */
      async sign(storageKey, options) {
        const url = await client.getPreSignedUrl({
          bucket: config.bucket,
          key: storageKey,
          method: "GET",
          expires: ttlSeconds,
          // 给模型读的图在 CDN 侧就降采样（IKAZC2）。
          //
          // 实测同一张 2140×2668 的 PNG：原图 8,666,873 字节，加上这段处理参数之后
          // 453,691 字节——小 19 倍。而模型侧看到的信息量没有损失：视觉模型有自己的处理
          // 分辨率上限，长边 1568 已经到顶，再大的像素在它那边也会被丢掉，只是白付 token、
          // 带宽和延迟。
          //
          // 必须**签进去**而不是拼在 URL 后面：这是 TOS4 query 签名，事后追加任何参数都会
          // 被判 SignatureDoesNotMatch。SDK 的 `query` 入参会把它算进规范请求。
          ...(options?.forModelReading
            ? { query: { "x-tos-process": MODEL_READING_IMAGE_PROCESS } }
            : {}),
        });
        return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
      },
    },
    reader: {
      async read(storageKey) {
        // 与上面的 signer 同因换成官方 SDK（IKAL46）：手写签名被 TOS 拒为
        // SignatureDoesNotMatch，这条读路径迟早会踩到同一颗雷。
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
        const extension = MIME_EXTENSIONS[input.mime.toLowerCase()] ?? "bin";
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
