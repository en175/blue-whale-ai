package com.bluewhale.worker.domain.error;

/**
 * 音频供应商错误（对齐 TS AudioProviderError，new-api-audio-provider.ts）。
 * <p>
 * 按 code 落 error JSON；processClaimedJob catch 读取 code 归入 failClaimed。
 */
public class AudioProviderError extends RuntimeException {

    private final String code;

    public AudioProviderError(String code, String message) {
        super(message);
        this.code = code;
    }

    public AudioProviderError(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
