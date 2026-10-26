package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.VideoSubtitleEraseContract;

public class VideoSubtitleEraseError extends RuntimeException {

    private final String code;

    public VideoSubtitleEraseError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
