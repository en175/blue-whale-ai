package com.bluewhale.worker.domain.error;

/**
 * 视频输入校验错误（video-job-runner.ts material-reference.ts VideoInputError 逐字移植）。
 * <p>
 * buildSubmitRequest 阶段校验失败时抛出，携带错误码（invalid_input / invalid_reference /
 * invalid_reference_type / invalid_reference_media / unsupported_input /
 * reference_asset_unavailable / reference_limit_exceeded）。
 * <p>
 * runner catch 读取 code 落库（video-job-runner.ts:360-365）。
 */
public class VideoInputError extends RuntimeException {

    private final String code;

    public VideoInputError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
