// IKARDY：ffmpeg 抽音轨（mp3）实现。依赖 ffmpeg-static 打包二进制，零系统依赖。
// 解析 stderr Duration 取总时长，-progress out_time_ms 算提取百分比。
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { Readable } from "node:stream";
import { createRequire } from "node:module";

import { MediaExtractError } from "@lib/shared/generation-runtime/index.js";

const require = createRequire(import.meta.url);
/** ffmpeg-static 打包二进制路径（postinstall 下载；package types 不可靠，走 createRequire）。 */
const ffmpegPath: string = require("ffmpeg-static") as string;

export interface ExtractAudioResult {
  duration: number | null;
}

/**
 * 用 ffmpeg 从视频抽音轨为 mp3（192k）。
 * - 无音轨 → 抛 MediaExtractError("video_has_no_audio_track")，不产输出。
 * - 其他失败 → 抛 MediaExtractError("extract_failed")。
 */
export function extractAudioToMp3(input: {
  inputPath: string;
  outputPath: string;
  onProgress: (percent: number) => void;
}): Promise<ExtractAudioResult> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new MediaExtractError("extract_failed", "ffmpeg-static 未找到二进制"));
      return;
    }
    const args = [
      "-i",
      input.inputPath,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-b:a",
      "192k",
      "-y",
      "-progress",
      "pipe:1",
      "-nostats",
      input.outputPath,
    ];
    const child = spawn(ffmpegPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    }) as unknown as ChildProcessByStdio<null, Readable, Readable>;

    let durationMs: number | null = null;
    let outTimeMs: number | null = null;
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      // -progress pipe:1 输出 key=value（out_time_ms=...）
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.startsWith("out_time_ms=")) continue;
        const value = Number(line.slice("out_time_ms=".length));
        if (Number.isFinite(value)) outTimeMs = value;
        if (durationMs !== null && durationMs > 0 && outTimeMs !== null) {
          input.onProgress(Math.min(100, (outTimeMs / durationMs) * 100));
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (durationMs === null) {
        const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
        if (match) {
          durationMs =
            (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) *
            1000;
        }
      }
    });

    child.on("error", (error) => {
      reject(new MediaExtractError("extract_failed", error.message));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          duration: durationMs === null ? null : durationMs / 1000,
        });
        return;
      }
      // 无音轨：-vn 后无输出流 → ffmpeg 报错 "Output file #0 does not contain any stream"
      if (/does not contain any stream/.test(stderr)) {
        reject(
          new MediaExtractError("video_has_no_audio_track", "视频没有音轨"),
        );
        return;
      }
      reject(
        new MediaExtractError(
          "extract_failed",
          `ffmpeg 退出码 ${code}: ${stderr.slice(-500)}`,
        ),
      );
    });
  });
}
