package com.bluewhale.worker.infrastructure.media;

import com.bluewhale.worker.domain.error.MediaExtractError;
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

@Component
public class FfmpegExtractor {

    private static final Logger log = LoggerFactory.getLogger(FfmpegExtractor.class);

    static final Pattern DURATION_PATTERN =
            Pattern.compile("Duration:\\s*(\\d+):(\\d+):(\\d+(?:\\.\\d+)?)");

    static final Pattern NO_STREAM_PATTERN =
            Pattern.compile("does not contain any stream");

    private final String ffmpegPath;

    public FfmpegExtractor() {
        String envPath = System.getenv("FFMPEG_PATH");
        this.ffmpegPath = (envPath != null && !envPath.isBlank()) ? envPath : "ffmpeg";
    }

    FfmpegExtractor(String ffmpegPath) {
        this.ffmpegPath = ffmpegPath;
    }

    public record ExtractResult(Double duration) {}

    public ExtractResult extract(String inputPath, String outputPath, DoubleConsumer onProgress) {
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
            throw new MediaExtractError(MediaExtractError.EXTRACT_FAILED, e.getMessage(), e);
        }

        AtomicReference<Long> durationMsRef = new AtomicReference<>(null);
        StringBuilder stderrBuilder = new StringBuilder();

        Thread stderrThread = Thread.ofVirtual().start(() -> {
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    stderrBuilder.append(line).append('\n');
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
            }
        });

        Thread stdoutThread = Thread.ofVirtual().start(() -> {
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
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
                    }
                }
            } catch (IOException ignored) {
            }
        });

        int exitCode;
        try {
            exitCode = process.waitFor();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new MediaExtractError(MediaExtractError.EXTRACT_FAILED, "ffmpeg 被中断", e);
        }

        try {
            stderrThread.join();
            stdoutThread.join();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        if (exitCode == 0) {
            Long durationMs = durationMsRef.get();
            Double duration = durationMs != null ? durationMs / 1000.0 : null;
            return new ExtractResult(duration);
        }

        String stderr = stderrBuilder.toString();

        if (NO_STREAM_PATTERN.matcher(stderr).find()) {
            throw new MediaExtractError(
                    MediaExtractError.VIDEO_HAS_NO_AUDIO_TRACK,
                    "视频没有音轨"
            );
        }

        String tail = stderr.length() > 500 ? stderr.substring(stderr.length() - 500) : stderr;
        throw new MediaExtractError(
                MediaExtractError.EXTRACT_FAILED,
                "ffmpeg 退出码 " + exitCode + ": " + tail
        );
    }
}
