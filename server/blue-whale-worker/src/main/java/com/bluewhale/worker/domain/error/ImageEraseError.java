package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.ImageEraseContract;

public class ImageEraseError extends RuntimeException {

    private final String code;

    public ImageEraseError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
