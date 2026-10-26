package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.VideoMattingContract;

public class VideoMattingError extends RuntimeException {

    private final String code;

    public VideoMattingError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
