package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.AudioSpeedContract;

/**
 * 音频调速（火山 MediaKit adjust-audio-speed）供应商错误（IKHW5A，父单 IKHVYO）。
 * <p>
 * 按 code 落 error JSON。content / quota 类信号沿用 NewApiErrorClassifier 分类
 * （§5 优先级不变），其余一律在处理器归并兜底码
 * {@link AudioSpeedContract#ERROR_AUDIO_SPEED_FAILED}
 * （无 worker 级自动重试；火山任务 failed——含 speed 越界等供应商侧官方约束拒绝——
 * 也归并该码，上游可读原因随 message 透传前端投影）。
 */
public class AudioSpeedError extends RuntimeException {

    /** 执行兜底失败码（数值 1051 = TS error-codes.ts ERROR_AUDIO_SPEED_FAILED）。 */
    public static final String AUDIO_SPEED_FAILED = "audio_speed_failed";

    private final String code;

    public AudioSpeedError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
