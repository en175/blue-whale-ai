package com.bluewhale.worker.domain.contract;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class VideoSampleContractGoldenTest {

    private static final long G06_CREATED_AT_MS =
            Instant.parse("2026-09-29T02:00:00Z").toEpochMilli();

    private static final long G06_EXPECTED_DEADLINE_MS =
            Instant.parse("2026-10-06T01:00:00Z").toEpochMilli();

    @Test
    @DisplayName("G06: 截止 = created_at + 7 天 − 1 小时安全余量（epoch 毫秒，与 TS 同一公式）")
    void g06_finalizeDeadlineMatchesTsContract() {
        assertThat(VideoSampleContract.finalizeDeadlineMs(G06_CREATED_AT_MS))
                .isEqualTo(G06_EXPECTED_DEADLINE_MS);
        assertThat(VideoSampleContract.finalizeDeadlineMs(G06_CREATED_AT_MS))
                .isLessThan(G06_CREATED_AT_MS + 7L * 24 * 60 * 60 * 1000);
    }

    @Test
    @DisplayName("G06: 常量与 TS 契约同值（窗口 7 天、余量 1 小时——校准只动这两个数）")
    void g06_constantsMirrorTsContract() {
        assertThat(VideoSampleContract.FINALIZE_WINDOW_DAYS).isEqualTo(7);
        assertThat(VideoSampleContract.FINALIZE_SAFETY_MARGIN_MS).isEqualTo(3_600_000L);
        assertThat(VideoSampleContract.INPUT_SAMPLE_MODE).isEqualTo("sample_mode");
        assertThat(VideoSampleContract.VIDEO_FINAL_RESOLUTION).isEqualTo("1080p");
    }

    @Test
    @DisplayName("G06: 折回 RFC3339 与金标字面量一致（两端各自折时区只有一种结果）")
    void g06_deadlineRendersGoldenLiteral() {
        assertThat(Instant.ofEpochMilli(VideoSampleContract.finalizeDeadlineMs(G06_CREATED_AT_MS)).toString())
                .isEqualTo("2026-10-06T01:00:00Z");
    }
}
