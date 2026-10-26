package com.bluewhale.worker.domain.error;

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
