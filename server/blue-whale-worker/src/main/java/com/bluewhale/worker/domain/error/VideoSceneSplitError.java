package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.VideoSceneSplitContract;

public class VideoSceneSplitError extends RuntimeException {

    private final String code;

    public VideoSceneSplitError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
