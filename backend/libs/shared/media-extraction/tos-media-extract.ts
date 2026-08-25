// IKARDY：媒体提取的 TOS 下载/上传端口。复用 createTosStorage（预签名签名 + 预签名 PUT + public-read）。
import { stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";

import { MediaExtractError, type MediaExtractDownloader, type MediaExtractUploader } from "@blue-whale/generation-runtime";
import { createTosStorage, type TosStorageConfig } from "@lib/shared/assets/tos-storage.js";

export interface TosMediaExtractPorts {
  download: MediaExtractDownloader;
  upload: MediaExtractUploader;
}

/** 下载端口：直接 fetch 资产公网 url（资产 public-read，无需签名）→ 流式落临时文件。
 *  手动读流计数：超 maxBytes 立即中断（防大视频打爆磁盘），onProgress 回报下载进度（供续租心跳）。 */
export function createTosMediaExtractDownloader(): MediaExtractDownloader {
  return {
    async download({ url, outputPath, maxBytes, onProgress }) {
      const res = await fetch(url);
      if (!res.ok) {
        throw new MediaExtractError(
          "video_download_failed",
          `TOS 视频下载失败: ${res.status}`,
        );
      }
      const contentLength = Number(res.headers.get("content-length") ?? "0");
      if (contentLength > maxBytes) {
        throw new MediaExtractError("video_too_large", "视频超过大小上限");
      }
      if (!res.body) {
        throw new MediaExtractError("video_download_failed", "TOS 响应无内容");
      }
      const ws = createWriteStream(outputPath);
      const reader = res.body.getReader();
      let received = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > maxBytes) {
            throw new MediaExtractError("video_too_large", "视频超过大小上限");
          }
          ws.write(value);
          if (contentLength > 0 && onProgress) {
            onProgress(Math.min(100, (received / contentLength) * 100));
          }
        }
      } finally {
        reader.releaseLock();
      }
      await new Promise<void>((resolve, reject) => {
        ws.end((error?: Error | null) => (error ? reject(error) : resolve()));
      });
      const size = (await stat(outputPath)).size;
      if (size > maxBytes) {
        throw new MediaExtractError("video_too_large", "视频超过大小上限");
      }
    },
  };
}

/** 上传端口：mp3 文件 → 预签名 PUT → public-read，返回存储结果。 */
export function createTosMediaExtractUploader(
  config: TosStorageConfig,
): MediaExtractUploader {
  const storage = createTosStorage(config);
  return {
    async upload({ filePath, userId, mime }) {
      const prepared = await storage.uploads.prepareUpload({
        mime,
        userId,
        type: "audio",
        keyPrefix: "media-extract",
      });
      const { readFile } = await import("node:fs/promises");
      const bytes = await readFile(filePath);
      const put = await fetch(prepared.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": prepared.headers["Content-Type"] ?? mime },
        body: bytes,
      });
      if (!put.ok) {
        throw new MediaExtractError("upload_failed", `TOS 音频上传失败: ${put.status}`);
      }
      await storage.uploads.makePublic(prepared.storageKey);
      return {
        url: prepared.publicUrl,
        storageKey: prepared.storageKey,
        mime,
        size: bytes.byteLength,
      };
    },
  };
}
