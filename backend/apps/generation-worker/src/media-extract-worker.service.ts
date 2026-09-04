// IKARDY：媒体提取（视频→音频）worker 服务。装配 repo + TOS 下载/上传端口 + ffmpeg，跑 runMediaExtractStep 短步骤。
import { hostname } from "node:os";
import { Injectable } from "@nestjs/common";
import { createWorkerRepo } from "@blue-whale/persistence";
import { createLogger } from "@blue-whale/core/logging";
import { runMediaExtractStep } from "@lib/shared/generation-runtime/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { loadTosStorageConfig } from "@lib/shared/assets/tos-storage.js";
import { extractAudioToMp3 } from "@lib/shared/media-extraction/ffmpeg.js";
import {
  createTosMediaExtractDownloader,
  createTosMediaExtractUploader,
} from "@lib/shared/media-extraction/tos-media-extract.js";

const logger = createLogger("generation-worker");

@Injectable()
export class MediaExtractWorkerService {
  private readonly workerId = `extract-${hostname()}-${process.pid}`;

  constructor(private readonly prisma: PrismaService) {}

  get repo() {
    return createWorkerRepo(this.prisma.client);
  }

  async runStep(jobId: string): Promise<string | null> {
    logger.debug(`mediaExtract runStep start jobId=${jobId}`);
    const tosConfig = loadTosStorageConfig();
    if (!tosConfig) {
      throw new Error("TOS configuration required for media extract");
    }
    return runMediaExtractStep({
      repo: this.repo,
      workerId: this.workerId,
      jobId,
      download: createTosMediaExtractDownloader(),
      extract: { extract: extractAudioToMp3 },
      upload: createTosMediaExtractUploader(tosConfig),
    });
  }
}
