package com.bluewhale.worker.domain.error;

import com.bluewhale.worker.domain.contract.VideoFrameInterpolationContract;

public class VideoFrameInterpolationError extends RuntimeException {

    public static final String VIDEO_FRAME_INTERPOLATION_FAILED = "video_frame_interpolation_failed";

    private final String code;

    public VideoFrameInterpolationError(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
