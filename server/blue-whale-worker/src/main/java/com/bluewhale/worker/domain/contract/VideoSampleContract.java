package com.bluewhale.worker.domain.contract;

public final class VideoSampleContract {

    public static final String INPUT_SAMPLE_MODE = "sample_mode";

    public static final String VIDEO_FINAL_RESOLUTION = "1080p";

    public static final long FINALIZE_WINDOW_DAYS = 7;

    public static final long FINALIZE_SAFETY_MARGIN_MS = 60L * 60 * 1000;

    private VideoSampleContract() {}

    public static long finalizeDeadlineMs(long upstreamCreatedAtMs) {
        return upstreamCreatedAtMs
                + FINALIZE_WINDOW_DAYS * 24L * 60 * 60 * 1000
                - FINALIZE_SAFETY_MARGIN_MS;
    }
}
