import { randomUUID as nodeRandomUUID } from "node:crypto";
import { createRequire } from "node:module";

import type { VideoMediaRelay } from "./video-job-runner.js";

export interface GenerationTosConfig {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
  region: string;
  signedUrlTtlSeconds?: number;
  maxVideoBytes?: number;
}

interface TosVideoClient {
  getPreSignedUrl(input: {
    bucket: string;
    key: string;
    method: "PUT";
    expires: number;
  }): string | Promise<string>;
  putObjectAcl(input: {
    bucket: string;
    key: string;
    acl: "public-read";
  }): Promise<unknown>;
}

type TosClientConstructor = new (input: {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
  region: string;
}) => TosVideoClient;

const require = createRequire(import.meta.url);

export function loadGenerationTosConfig(
  env: NodeJS.ProcessEnv = process.env,
): GenerationTosConfig | null {
  const accessKeyId = env.VOLC_ACCESS_KEY_ID;
  const secretAccessKey = env.VOLC_SECRET_ACCESS_KEY;
  const endpoint = env.VOLC_TOS_ENDPOINT;
  const bucket = env.VOLC_TOS_BUCKET;
  const region = env.VOLC_TOS_REGION;
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket || !region) {
    return null;
  }
  return { accessKeyId, secretAccessKey, endpoint, bucket, region };
}

export function createTosVideoMediaRelay(
  config: GenerationTosConfig,
  dependencies: {
    client?: TosVideoClient;
    fetchImpl?: typeof fetch;
    randomUUID?: () => string;
  } = {},
): VideoMediaRelay {
  const endpoint = config.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const ttlSeconds = config.signedUrlTtlSeconds ?? 600;
  const maxVideoBytes = config.maxVideoBytes ?? 200 * 1024 * 1024;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const randomUUID = dependencies.randomUUID ?? nodeRandomUUID;
  const client: TosVideoClient =
    dependencies.client ??
    createTosClient(config, endpoint);

  return {
    async persist(sourceUrl, userId) {
      const source = await fetchImpl(sourceUrl);
      if (!source.ok) throw new Error(`生成视频下载失败: ${source.status}`);
      const mime =
        source.headers.get("content-type")?.split(";", 1)[0]?.trim() ||
        "video/mp4";
      if (!mime.startsWith("video/")) throw new Error("生成结果不是视频");
      const bytes = new Uint8Array(await source.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error("生成视频为空");
      if (bytes.byteLength > maxVideoBytes) throw new Error("生成视频超过转存上限");

      const extension = videoExtension(mime);
      const storageKey = `generated/${userId}/video/${randomUUID().replace(/-/g, "")}.${extension}`;
      const uploadUrl = await client.getPreSignedUrl({
        bucket: config.bucket,
        key: storageKey,
        method: "PUT",
        expires: ttlSeconds,
      });
      const uploaded = await fetchImpl(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: new Uint8Array(bytes).slice(),
      });
      if (!uploaded.ok) throw new Error(`生成视频转存失败: ${uploaded.status}`);
      await client.putObjectAcl({
        bucket: config.bucket,
        key: storageKey,
        acl: "public-read",
      });

      return {
        url: `https://${config.bucket}.${endpoint}/${storageKey}`,
        storageKey,
        mime,
        size: bytes.byteLength,
      };
    },
  };
}

function createTosClient(
  config: GenerationTosConfig,
  endpoint: string,
): TosVideoClient {
  const sdk = require("@volcengine/tos-sdk") as {
    TosClient: TosClientConstructor;
  };
  return new sdk.TosClient({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.secretAccessKey,
    endpoint,
    region: config.region,
  });
}

function videoExtension(mime: string): string {
  if (mime === "video/webm") return "webm";
  if (mime === "video/quicktime") return "mov";
  return "mp4";
}
