package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.VideoEnhanceContract;

public class VideoEnhanceError extends RuntimeException {

    public static final String VIDEO_ENHANCE_FAILED = "video_enhance_failed";

    private final String code;

    public VideoEnhanceError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
