package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.ImageCutoutContract;

public class ImageCutoutError extends RuntimeException {

    private final String code;

    public ImageCutoutError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
