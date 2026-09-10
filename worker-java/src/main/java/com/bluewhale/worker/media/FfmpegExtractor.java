package com.bluewhale.worker.media;

import com.bluewhale.worker.processor.MediaExtractError;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.DoubleConsumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * ffmpeg 抽音轨封装（ffmpeg.ts:1-107 逐字移植）。
 * <p>
 * 参数逐字一致：{@code -i <in> -vn -acodec libmp3lame -b:a 192k -y -progress pipe:1 -nostats <out>}
 * <p>
 * 进度解析：stderr Duration regex → 总时长 ms；stdout out_time_ms → 百分比封顶 100。
 * <p>
 * 无超时控制（契约 §8：原样继承 TS 行为）。
 * <p>
 * ffmpeg 二进制路径：env {@code FFMPEG_PATH}，缺省 {@code "ffmpeg"}。
 * Dockerfile 必须 ship 一个（apt install ffmpeg）。
 */
@Component
public class FfmpegExtractor {

    private static final Logger log = LoggerFactory.getLogger(FfmpegExtractor.class);

    /** Duration regex（ffmpeg.ts:71 逐字一致）。 */
    static final Pattern DURATION_PATTERN =
            Pattern.compile("Duration:\\s*(\\d+):(\\d+):(\\d+(?:\\.\\d+)?)");

    /** 无音轨判定（ffmpeg.ts:92）。 */
    static final Pattern NO_STREAM_PATTERN =
            Pattern.compile("does not contain any stream");

    /**
     * ffmpeg 二进制路径。env FFMPEG_PATH 覆盖；缺省 "ffmpeg"（PATH 查找）。
     * Dockerfile 须 apt install ffmpeg（或等效）。
     */
    private final String ffmpegPath;

    public FfmpegExtractor() {
        String envPath = System.getenv("FFMPEG_PATH");
        this.ffmpegPath = (envPath != null && !envPath.isBlank()) ? envPath : "ffmpeg";
    }

    /** 测试用构造器：允许注入 ffmpeg 路径。 */
    FfmpegExtractor(String ffmpegPath) {
        this.ffmpegPath = ffmpegPath;
    }

    /**
     * 提取结果。duration 为秒（与 TS 一致：ffmpeg.ts:86-88）；null 表示无法解析。
     */
    public record ExtractResult(Double duration) {}

    /**
     * 用 ffmpeg 从视频抽音轨为 mp3（192k）。
     * <p>
     * 逐字移植 ffmpeg.ts:22-106：
     * <ul>
     *   <li>args: -i, inputPath, -vn, -acodec, libmp3lame, -b:a, 192k, -y, -progress, pipe:1, -nostats, outputPath</li>
     *   <li>stdout: out_time_ms= → percent = min(100, outTimeMs/durationMs*100)</li>
     *   <li>stderr: Duration regex → durationMs</li>
     *   <li>退出码 0 → resolve(duration)；非 0 且 "does not contain any stream" → video_has_no_audio_track；其他 → extract_failed + stderr 尾 500</li>
     * </ul>
     *
     * @param inputPath  输入视频文件路径
     * @param outputPath 输出 mp3 文件路径
     * @param onProgress 进度回调 0-100（与 TS onProgress 语义一致）
     * @return 提取结果（duration 秒）
     * @throws MediaExtractError video_has_no_audio_track / extract_failed
     */
    public ExtractResult extract(String inputPath, String outputPath, DoubleConsumer onProgress) {
        // ffmpeg.ts:32-44
        ProcessBuilder pb = new ProcessBuilder(
                ffmpegPath,
                "-i", inputPath,
                "-vn",
                "-acodec", "libmp3lame",
                "-b:a", "192k",
                "-y",
                "-progress", "pipe:1",
                "-nostats",
                outputPath
        );
        pb.redirectInput(ProcessBuilder.Redirect.from(new java.io.File("/dev/null")));

        Process process;
        try {
            process = pb.start();
        } catch (IOException e) {
            // ffmpeg.ts:80-82：child.on("error")
            throw new MediaExtractError(MediaExtractError.EXTRACT_FAILED, e.getMessage(), e);
        }

        // 共享状态（线程安全：AtomicReference）
        AtomicReference<Long> durationMsRef = new AtomicReference<>(null);
        StringBuilder stderrBuilder = new StringBuilder();

        // stderr 读取线程（Duration 解析）
        Thread stderrThread = Thread.ofVirtual().start(() -> {
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    stderrBuilder.append(line).append('\n');
                    // ffmpeg.ts:70-77：首次匹配 Duration 后停止解析
                    if (durationMsRef.get() == null) {
                        Matcher m = DURATION_PATTERN.matcher(stderrBuilder.toString());
                        if (m.find()) {
                            long ms = (long) (
                                    (Long.parseLong(m.group(1)) * 3600
                                            + Long.parseLong(m.group(2)) * 60
                                            + Double.parseDouble(m.group(3))) * 1000
                            );
                            durationMsRef.set(ms);
                        }
                    }
                }
            } catch (IOException ignored) {
                // 进程退出时流关闭
            }
        });

        // stdout 读取线程（out_time_ms 进度）
        Thread stdoutThread = Thread.ofVirtual().start(() -> {
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    // ffmpeg.ts:57-64
                    if (!line.startsWith("out_time_ms=")) continue;
                    try {
                        double outTimeMs = Double.parseDouble(line.substring("out_time_ms=".length()));
                        if (Double.isFinite(outTimeMs)) {
                            Long durationMs = durationMsRef.get();
                            if (durationMs != null && durationMs > 0) {
                                double percent = Math.min(100, (outTimeMs / durationMs) * 100);
                                onProgress.accept(percent);
                            }
                        }
                    } catch (NumberFormatException ignored) {
                        // 非数字行跳过
                    }
                }
            } catch (IOException ignored) {
                // 进程退出时流关闭
            }
        });

        int exitCode;
        try {
            // 无超时控制（契约 §8：原样继承 TS 行为）
            exitCode = process.waitFor();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new MediaExtractError(MediaExtractError.EXTRACT_FAILED, "ffmpeg 被中断", e);
        }

        // 等待输出流读取完成
        try {
            stderrThread.join();
            stdoutThread.join();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        // ffmpeg.ts:84-104
        if (exitCode == 0) {
            Long durationMs = durationMsRef.get();
            Double duration = durationMs != null ? durationMs / 1000.0 : null;
            return new ExtractResult(duration);
        }

        String stderr = stderrBuilder.toString();

        // 无音轨判定（ffmpeg.ts:91-96）
        if (NO_STREAM_PATTERN.matcher(stderr).find()) {
            throw new MediaExtractError(
                    MediaExtractError.VIDEO_HAS_NO_AUDIO_TRACK,
                    "视频没有音轨"
            );
        }

        // 其他失败（ffmpeg.ts:97-103）：附 stderr 尾 500 字符
        String tail = stderr.length() > 500 ? stderr.substring(stderr.length() - 500) : stderr;
        throw new MediaExtractError(
                MediaExtractError.EXTRACT_FAILED,
                "ffmpeg 退出码 " + exitCode + ": " + tail
        );
    }
}
