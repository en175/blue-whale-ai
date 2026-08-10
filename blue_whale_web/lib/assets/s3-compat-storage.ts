import { createHmac, randomUUID as nodeRandomUUID } from "node:crypto";

import type { AssetUploadStorage } from "./handle-upload";
import type { AssetReader, AssetSigner } from "./ports";

/**
 * S3 兼容直传存储适配器：确定性验收拓扑（storage-stub）与自建 S3 兼容存储共用。
 *
 * 与 TOS 适配器的差异：
 * - 预签名用轻量 HMAC（sig = HMAC-SHA256(secret, `${METHOD}\n${key}\n${expires}`) hex），
 *   不依赖 SigV4 生态；storage-stub 用同一算法验签（stub 是确定性假供应商，不模拟真实云）。
 * - 双基址：uploadUrl/publicUrl 用 publicBase（浏览器经宿主机映射端口可达），
 *   inspectObject/read 用 internalBase（web 容器在 compose 内网直达）。单地址部署时两者同值。
 * - makePublic 为 no-op：对象可见性由签名 GET 控制，无 ACL 概念。
 */
export interface S3CompatStorageConfig {
  /** 浏览器可达基址，如 http://localhost:4330（无尾斜杠）。 */
  publicBase: string;
  /** 服务端可达基址，如 http://storage-stub:4330（无尾斜杠）。 */
  internalBase: string;
  secret: string;
  signedUrlTtlSeconds?: number;
  maxReadBytes?: number;
}

export function loadS3CompatStorageConfig(
  env: Record<string, string | undefined> = process.env,
): S3CompatStorageConfig | null {
  const publicBase = env.ASSET_UPLOAD_PUBLIC_BASE;
  const secret = env.ASSET_UPLOAD_SECRET;
  if (!publicBase || !secret) return null;
  return {
    publicBase: publicBase.replace(/\/$/, ""),
    internalBase: (env.ASSET_UPLOAD_INTERNAL_BASE ?? publicBase).replace(
      /\/$/,
      "",
    ),
    secret,
  };
}

function objectPath(storageKey: string): string {
  return `/objects/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

function sign(secret: string, method: string, key: string, expires: number) {
  return createHmac("sha256", secret)
    .update(`${method}\n${key}\n${expires}`)
    .digest("hex");
}

function signedUrl(
  base: string,
  secret: string,
  method: string,
  storageKey: string,
  expires: number,
): string {
  const signature = sign(secret, method, storageKey, expires);
  return `${base}${objectPath(storageKey)}?bw-auth=direct&bw-expires=${expires}&bw-signature=${signature}`;
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

interface S3CompatStorageDependencies {
  randomUUID?: () => string;
  /** 测试注入：服务端 HEAD/GET 请求改用该实现（默认全局 fetch）。 */
  serverFetch?: typeof fetch;
}

export function createS3CompatStorage(
  config: S3CompatStorageConfig,
  dependencies: S3CompatStorageDependencies = {},
): {
  signer: AssetSigner;
  reader: AssetReader;
  uploads: AssetUploadStorage;
} {
  const ttlSeconds = config.signedUrlTtlSeconds ?? 600;
  const maxReadBytes = config.maxReadBytes ?? 20 * 1024 * 1024;
  const randomUUID = dependencies.randomUUID ?? nodeRandomUUID;
  const serverFetch = dependencies.serverFetch ?? fetch;

  return {
    signer: {
      async sign(storageKey) {
        const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
        return {
          url: signedUrl(
            config.publicBase,
            config.secret,
            "GET",
            storageKey,
            expires,
          ),
          expiresAt: new Date(expires * 1000),
        };
      },
    },
    reader: {
      async read(storageKey) {
        const expires = Math.floor(Date.now() / 1000) + 60;
        const res = await serverFetch(
          signedUrl(
            config.internalBase,
            config.secret,
            "GET",
            storageKey,
            expires,
          ),
        );
        if (!res.ok) {
          throw new Error(`S3-compat read failed: ${res.status}`);
        }
        const contentLength = Number(res.headers.get("content-length") ?? "0");
        if (contentLength > maxReadBytes) {
          throw new Error("S3-compat 对象超过读取上限");
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > maxReadBytes) {
          throw new Error("S3-compat 对象超过读取上限");
        }
        return buf;
      },
    },
    uploads: {
      async prepareUpload(input) {
        const extension = MIME_EXTENSIONS[input.mime.toLowerCase()] ?? "bin";
        const storageKey = input.keyPrefix
          ? `${input.keyPrefix}/${input.type}/${randomUUID().replace(/-/g, "")}.${extension}`
          : `uploads/${input.userId}/${input.type}/${randomUUID().replace(/-/g, "")}.${extension}`;
        const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
        return {
          storageKey,
          publicUrl: signedUrl(
            config.publicBase,
            config.secret,
            "GET",
            storageKey,
            // 与 TOS publicUrl（永久公开）语义对齐：给足够长的有效期，
            // 该 URL 会持久化进 assets.url；真实 S3 部署应换 CDN/公开桶。
            10 * 365 * 24 * 3600,
          ),
          uploadUrl: signedUrl(
            config.publicBase,
            config.secret,
            "PUT",
            storageKey,
            expires,
          ),
          headers: { "Content-Type": input.mime },
          expiresIn: ttlSeconds,
        };
      },
      async inspectObject(storageKey) {
        const expires = Math.floor(Date.now() / 1000) + 60;
        const res = await serverFetch(
          signedUrl(
            config.internalBase,
            config.secret,
            "HEAD",
            storageKey,
            expires,
          ),
          { method: "HEAD" },
        );
        if (res.status === 404) return null;
        if (!res.ok) {
          throw new Error(`S3-compat HEAD failed: ${res.status}`);
        }
        const size = Number(res.headers.get("content-length") ?? "NaN");
        if (!Number.isFinite(size) || size < 0) {
          throw new Error("S3-compat HEAD response is missing content length");
        }
        return {
          size,
          mime: res.headers.get("content-type"),
          publicUrl: signedUrl(
            config.publicBase,
            config.secret,
            "GET",
            storageKey,
            10 * 365 * 24 * 3600,
          ),
        };
      },
      async makePublic() {
        // no-op：签名 GET 已提供访问路径，无 ACL。
      },
    },
  };
}
