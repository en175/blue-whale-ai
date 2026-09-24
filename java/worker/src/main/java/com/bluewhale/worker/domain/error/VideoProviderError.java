package com.bluewhale.worker.domain.error;

/**
 * 视频供应商错误（video-job-runner.ts:185-193 VideoProviderError 逐字移植）。
 * <p>
 * 携带对外错误码（quota_exhausted / content_rejected / provider_failed 等），
 * 供 runVideoJobStep 的 catch 直接取码落库，不再一律归 provider_failed。
 * <p>
 * submit 阶段由 NewApiVideoClient 经 NewApiErrorClassifier 分类后抛出；
 * poll 阶段由 provider observation.status=="failed" 时映射。
 */
public class VideoProviderError extends RuntimeException {

    private final String code;

    public VideoProviderError(String code, String message) {
        super(message);
        this.code = code;
    }

    public VideoProviderError(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
