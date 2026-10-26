package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.ImageEnhanceContract;

public class ImageEnhanceError extends RuntimeException {

    private final String code;

    public ImageEnhanceError(String code, String message) {
        super(message);
        this.code = code;
    }

    public ImageEnhanceError(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
