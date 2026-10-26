package com.bluewhale.worker.domain.error;

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
