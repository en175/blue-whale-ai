package com.bluewhale.worker.domain.error;

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
