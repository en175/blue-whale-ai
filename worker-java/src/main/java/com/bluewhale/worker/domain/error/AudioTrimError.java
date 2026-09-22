package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.AudioTrimContract;

/**
 * 音频截取（火山 MediaKit trim-audio）供应商错误（IKHB6F，父单 IKHB08）。
 * <p>
 * 按 code 落 error JSON。content / quota 类信号沿用 NewApiErrorClassifier 分类
 * （§5 优先级不变），其余一律在处理器归并兜底码
 * {@link AudioTrimContract#ERROR_AUDIO_TRIM_FAILED}
 * （无 worker 级自动重试；火山任务 failed——含 end_time 超真实片尾等供应商侧官方约束
 * 拒绝——也归并该码，上游可读原因随 message 透传前端投影）。
 */
public class AudioTrimError extends RuntimeException {

    /** 执行兜底失败码（数值 1048 = TS error-codes.ts ERROR_AUDIO_TRIM_FAILED）。 */
    public static final String AUDIO_TRIM_FAILED = "audio_trim_failed";

    private final String code;

    public AudioTrimError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
