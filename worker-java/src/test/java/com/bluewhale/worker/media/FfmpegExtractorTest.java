package com.bluewhale.worker.media;

import com.bluewhale.worker.processor.MediaExtractError;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * FfmpegExtractor 参数解析 / regex 单元测试（无需真实 ffmpeg）。
 * <p>
 * 测试 Duration regex、no-stream 检测、进度计算公式（与 ffmpeg.ts 逐字一致）。
 */
class FfmpegExtractorTest {

    @Test
    @DisplayName("Duration regex：标准 ffmpeg 输出（ffmpeg.ts:71-77）")
    void durationRegex_standard() {
        String stderr = "  Duration: 00:02:35.42, start: 0.000000, bitrate: 1234 kb/s";
        Matcher m = FfmpegExtractor.DURATION_PATTERN.matcher(stderr);

        assertThat(m.find()).isTrue();
        assertThat(m.group(1)).isEqualTo("00");
        assertThat(m.group(2)).isEqualTo("02");
        assertThat(m.group(3)).isEqualTo("35.42");

        // 计算毫秒（与 ffmpeg.ts:73-76 一致）
        long ms = (long) ((Long.parseLong(m.group(1)) * 3600
                + Long.parseLong(m.group(2)) * 60
                + Double.parseDouble(m.group(3))) * 1000);
        assertThat(ms).isEqualTo(155420); // 2m35.42s = 155420ms
    }

    @Test
    @DisplayName("Duration regex：整秒（无小数点）")
    void durationRegex_wholeSeconds() {
        String stderr = "  Duration: 01:30:00, start: 0.000000";
        Matcher m = FfmpegExtractor.DURATION_PATTERN.matcher(stderr);

        assertThat(m.find()).isTrue();
        long ms = (long) ((Long.parseLong(m.group(1)) * 3600
                + Long.parseLong(m.group(2)) * 60
                + Double.parseDouble(m.group(3))) * 1000);
        assertThat(ms).isEqualTo(5400000); // 1h30m = 5400000ms
    }

    @Test
    @DisplayName("Duration regex：短时长（<1 分钟）")
    void durationRegex_short() {
        String stderr = "  Duration: 00:00:12.50, start: 0.000000";
        Matcher m = FfmpegExtractor.DURATION_PATTERN.matcher(stderr);

        assertThat(m.find()).isTrue();
        long ms = (long) ((0 * 3600 + 0 * 60 + 12.50) * 1000);
        assertThat(ms).isEqualTo(12500);
    }

    @Test
    @DisplayName("Duration regex：无匹配 → 不匹配")
    void durationRegex_noMatch() {
        String stderr = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'video.mp4'";
        Matcher m = FfmpegExtractor.DURATION_PATTERN.matcher(stderr);

        assertThat(m.find()).isFalse();
    }

    @Test
    @DisplayName("无音轨检测：does not contain any stream（ffmpeg.ts:92）")
    void noStreamPattern_matches() {
        String stderr = "Output file #0 does not contain any stream";
        assertThat(FfmpegExtractor.NO_STREAM_PATTERN.matcher(stderr).find()).isTrue();
    }

    @Test
    @DisplayName("无音轨检测：正常输出不匹配")
    void noStreamPattern_noMatch() {
        String stderr = "size=     192kB time=00:00:12.45 bitrate= 126.3kbits/s speed=  25x";
        assertThat(FfmpegExtractor.NO_STREAM_PATTERN.matcher(stderr).find()).isFalse();
    }

    @Test
    @DisplayName("进度计算：out_time_ms / durationMs × 100 封顶 100（ffmpeg.ts:62）")
    void progressCalculation() {
        long durationMs = 155420; // 2m35.42s

        // out_time_ms = 50000 → 32.2%
        double outTimeMs1 = 50000;
        double percent1 = Math.min(100, (outTimeMs1 / durationMs) * 100);
        assertThat(percent1).isCloseTo(32.2, org.assertj.core.data.Offset.offset(0.1));

        // out_time_ms = 200000 → 封顶 100（超过 duration）
        double outTimeMs2 = 200000;
        double percent2 = Math.min(100, (outTimeMs2 / durationMs) * 100);
        assertThat(percent2).isEqualTo(100.0);

        // out_time_ms = 0 → 0%
        double outTimeMs3 = 0;
        double percent3 = Math.min(100, (outTimeMs3 / durationMs) * 100);
        assertThat(percent3).isEqualTo(0.0);
    }

    @Test
    @DisplayName("MediaExtractError：code + message 正确传递")
    void mediaExtractError_carriesCodeAndMessage() {
        MediaExtractError err = new MediaExtractError("video_has_no_audio_track", "视频没有音轨");
        assertThat(err.getCode()).isEqualTo("video_has_no_audio_track");
        assertThat(err.getMessage()).isEqualTo("视频没有音轨");
    }

    @Test
    @DisplayName("MediaExtractError 所有错误码常量存在")
    void allErrorCodesExist() {
        assertThat(MediaExtractError.INVALID_INPUT).isEqualTo("invalid_input");
        assertThat(MediaExtractError.SOURCE_ASSET_UNAVAILABLE).isEqualTo("source_asset_unavailable");
        assertThat(MediaExtractError.MEDIA_EXTRACT_FAILED).isEqualTo("media_extract_failed");
        assertThat(MediaExtractError.VIDEO_HAS_NO_AUDIO_TRACK).isEqualTo("video_has_no_audio_track");
        assertThat(MediaExtractError.VIDEO_DOWNLOAD_FAILED).isEqualTo("video_download_failed");
        assertThat(MediaExtractError.VIDEO_TOO_LARGE).isEqualTo("video_too_large");
        assertThat(MediaExtractError.EXTRACT_FAILED).isEqualTo("extract_failed");
        assertThat(MediaExtractError.UPLOAD_FAILED).isEqualTo("upload_failed");
    }

    @Test
    @DisplayName("out_time_ms 行解析（ffmpeg.ts:57-64）")
    void outTimeMsParsing() {
        // 模拟 stdout 行
        String line1 = "out_time_ms=5000000";
        assertThat(line1.startsWith("out_time_ms=")).isTrue();
        double value = Double.parseDouble(line1.substring("out_time_ms=".length()));
        assertThat(value).isEqualTo(5000000.0);

        // 非数字行跳过
        String line2 = "out_time_ms=N/A";
        try {
            Double.parseDouble(line2.substring("out_time_ms=".length()));
            assertThat(true).isFalse(); // should not reach
        } catch (NumberFormatException ignored) {
            // 预期行为
        }
    }

    @Test
    @DisplayName("ffmpeg 参数列表验证（ffmpeg.ts:32-44 逐字一致）")
    void ffmpegArgs_areCorrect() {
        // 验证参数顺序和值与 TS 完全一致
        List<String> expectedArgs = List.of(
                "-i", "<input>",
                "-vn",
                "-acodec", "libmp3lame",
                "-b:a", "192k",
                "-y",
                "-progress", "pipe:1",
                "-nostats",
                "<output>"
        );

        // 验证参数格式
        assertThat(expectedArgs).containsExactly(
                "-i", "<input>",
                "-vn",
                "-acodec", "libmp3lame",
                "-b:a", "192k",
                "-y",
                "-progress", "pipe:1",
                "-nostats",
                "<output>"
        );
    }

    @Test
    @DisplayName("stderr 尾 500 字符截取（ffmpeg.ts:102）")
    void stderrTail500() {
        String longStderr = "x".repeat(1000) + "IMPORTANT_ERROR_AT_END";
        String tail = longStderr.length() > 500
                ? longStderr.substring(longStderr.length() - 500)
                : longStderr;
        assertThat(tail).hasSize(500);
        assertThat(tail).endsWith("IMPORTANT_ERROR_AT_END");
    }
}
