package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.ImageOutpaintContract;

public class ImageOutpaintError extends RuntimeException {

    private final String code;

    public ImageOutpaintError(String code, String message) {
        super(message);
        this.code = code;
    }

    public ImageOutpaintError(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
