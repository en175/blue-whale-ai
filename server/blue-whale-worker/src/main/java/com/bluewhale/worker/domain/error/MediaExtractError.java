package com.bluewhale.worker.domain.error;

/**
 * 可预期的媒体提取错误（media-extract-runner.ts:121-129）。
 * <p>
 * 按 code 落 error JSON，不判为系统失败。
 * 错误码定义于 packages/contracts/src/error-codes.ts:20-70。
 */
public class MediaExtractError extends RuntimeException {

    /** 错误码（与 TS error-codes.ts 字符串码完全一致）。 */
    public static final String INVALID_INPUT = "invalid_input";
    public static final String SOURCE_ASSET_UNAVAILABLE = "source_asset_unavailable";
    public static final String MEDIA_EXTRACT_FAILED = "media_extract_failed";
    public static final String VIDEO_HAS_NO_AUDIO_TRACK = "video_has_no_audio_track";
    public static final String VIDEO_DOWNLOAD_FAILED = "video_download_failed";
    public static final String VIDEO_TOO_LARGE = "video_too_large";
    public static final String EXTRACT_FAILED = "extract_failed";
    public static final String UPLOAD_FAILED = "upload_failed";
    /** IKH28T（迁移契约 §18）：火山执行路径兜底失败码（数值 1044）——网关分类链外的火山任务失败
     *  与转存失败归并本码，与本地 ffmpeg 链路兜底 MEDIA_EXTRACT_FAILED(1020) 区分（ADR-0103）。 */
    public static final String MEDIA_EXTRACT_PROVIDER_FAILED = "media_extract_provider_failed";

    private final String code;

    public MediaExtractError(String code, String message) {
        super(message);
        this.code = code;
    }

    public MediaExtractError(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
