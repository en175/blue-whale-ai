package com.bluewhale.worker.domain.error;

/**
 * 图片供应商错误（对齐 TS ImageProviderError，image-provider.ts:41-49）。
 * <p>
 * 按 code 落 error JSON；processClaimedJob catch 读取 code 归入 failClaimed 或瞬态重试。
 */
public class ImageProviderError extends RuntimeException {

    private final String code;

    public ImageProviderError(String code, String message) {
        super(message);
        this.code = code;
    }

    public ImageProviderError(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
