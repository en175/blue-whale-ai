package com.bluewhale.worker.domain.contract;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * IKIZQ8 金标对账：样片两阶段契约的 Java 侧实现与 TS 契约
 * （{@code backend/libs/contracts/video-sample-mode.ts}，IKIZQ5 冻结）逐值对齐。
 *
 * <p>期望值逐字取自金标用例 {@code docs/specs/2026-09-29-ikizq5-video-sample-mode-golden-cases.json}
 * 的 G06（可信截止时间）—— 不是从 Java 实现反推：两端任何一侧改了公式或常量，
 * 这里的字面量就红（ADR-0084 跨语言防漂移）。
 */
class VideoSampleContractGoldenTest {

    /** 金标 G06：网关回传样片上游 Draft created_at=2026-09-29T02:00:00Z。 */
    private static final long G06_CREATED_AT_MS =
            Instant.parse("2026-09-29T02:00:00Z").toEpochMilli();

    /** 金标 G06 期望：finalize_deadline_at=2026-10-06T01:00:00Z（严格早于 created_at+7 天）。 */
    private static final long G06_EXPECTED_DEADLINE_MS =
            Instant.parse("2026-10-06T01:00:00Z").toEpochMilli();

    @Test
    @DisplayName("G06: 截止 = created_at + 7 天 − 1 小时安全余量（epoch 毫秒，与 TS 同一公式）")
    void g06_finalizeDeadlineMatchesTsContract() {
        assertThat(VideoSampleContract.finalizeDeadlineMs(G06_CREATED_AT_MS))
                .isEqualTo(G06_EXPECTED_DEADLINE_MS);
        // 严格早于 created_at+7 天（余量 > 0 是方向性不变式，不钉具体值）
        assertThat(VideoSampleContract.finalizeDeadlineMs(G06_CREATED_AT_MS))
                .isLessThan(G06_CREATED_AT_MS + 7L * 24 * 60 * 60 * 1000);
    }

    @Test
    @DisplayName("G06: 常量与 TS 契约同值（窗口 7 天、余量 1 小时——校准只动这两个数）")
    void g06_constantsMirrorTsContract() {
        assertThat(VideoSampleContract.FINALIZE_WINDOW_DAYS).isEqualTo(7);
        assertThat(VideoSampleContract.FINALIZE_SAFETY_MARGIN_MS).isEqualTo(3_600_000L);
        assertThat(VideoSampleContract.INPUT_SAMPLE_MODE).isEqualTo("sample_mode");
    }

    @Test
    @DisplayName("G06: 折回 RFC3339 与金标字面量一致（两端各自折时区只有一种结果）")
    void g06_deadlineRendersGoldenLiteral() {
        assertThat(Instant.ofEpochMilli(VideoSampleContract.finalizeDeadlineMs(G06_CREATED_AT_MS)).toString())
                .isEqualTo("2026-10-06T01:00:00Z");
    }
}
