package com.bluewhale.worker.domain.contract;

/**
 * IKIZQ8：Seedance 2.5 样片两阶段契约的 Worker 侧镜像（事实源
 * {@code backend/libs/contracts/video-sample-mode.ts}，IKIZQ5 冻结）。
 *
 * <p>只镜像 Worker 执行需要的常量与公式；浏览器契约/错误码由 business-api 投影，
 * 不在本进程。⚠️ 改这里必须同步改 TS 契约——两端按金标用例 G06 对账
 * （{@code docs/specs/2026-09-29-ikizq5-video-sample-mode-golden-cases.json}）。
 */
public final class VideoSampleContract {

    /** input 快照里的样片标记键（接纳侧在样片分支冻结 {@code sample_mode: true}）。 */
    public static final String INPUT_SAMPLE_MODE = "sample_mode";

    /** 成片分辨率（TS 契约 {@code VIDEO_FINAL_RESOLUTION} 镜像）——finalize 请求体
     *  显式声明的唯一合法值（网关校验显式分辨率只能取该值）。 */
    public static final String VIDEO_FINAL_RESOLUTION = "1080p";

    /** 官方窗口：Draft ID 自上游 Draft created_at 起 7 天有效（IKIZBQ）。 */
    public static final long FINALIZE_WINDOW_DAYS = 7;

    /**
     * 安全余量（ms）：截止 = 可信 created_at + 7 天 − 余量。首版取 1 小时（保守值），
     * 与 TS 契约 {@code FINALIZE_SAFETY_MARGIN_MS} 同值；上线前按 IKIZKG 临界受理实测
     * 校准，届时两端只改这一个常量。
     */
    public static final long FINALIZE_SAFETY_MARGIN_MS = 60L * 60 * 1000;

    private VideoSampleContract() {}

    /**
     * 可信上游 Draft created_at（epoch 毫秒）→ 实际转成片截止（epoch 毫秒）。
     *
     * <p>与 TS {@code finalizeDeadlineFromUpstreamCreatedAt} 逐字同一公式（跨语言金标
     * G06：created_at=2026-09-29T02:00:00Z ⇒ deadline=2026-10-06T01:00:00Z）。
     * 存毫秒整数、投影层折 RFC3339——时区只折一次，不在两端各解释一遍。
     *
     * @return 截止时刻 epoch 毫秒
     */
    public static long finalizeDeadlineMs(long upstreamCreatedAtMs) {
        return upstreamCreatedAtMs
                + FINALIZE_WINDOW_DAYS * 24L * 60 * 60 * 1000
                - FINALIZE_SAFETY_MARGIN_MS;
    }
}
