package com.bluewhale.worker.domain.contract;

import java.util.List;

public final class AudioVideoMuxContract {
    private AudioVideoMuxContract() {}

    public static final String TAG = GenerationMqRouteEnum.AUDIO_VIDEO_MUX.tag();
    public static final String SOURCE = "dock";
    public static final String INPUT_KEY_AUDIO = "audio";
    public static final String INPUT_KEY_VIDEO = "video";
    public static final String INPUT_KEY_IS_AUDIO_RESERVE = "is_audio_reserve";
    public static final String INPUT_KEY_SYNC = "sync";
    public static final String INPUT_KEY_SUBMIT_ATTEMPT = "submit_attempt";
    public static final String INPUT_FIELD_ASSET_ID = "assetId";
    public static final String INPUT_FIELD_NODE_ID = "nodeId";
    public static final String INPUT_FIELD_URL = "url";
    public static final List<String> SYNC_VALUES = List.of("none", "video", "audio");
    public static final String SUBMIT_PATH = "/v1/mediakit/mux-audio-video";
    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";
    public static final String ERROR_AUDIO_VIDEO_MUX_FAILED = "audio_video_mux_failed";
    public static final long MAX_RESULT_BYTES = 10L << 30;
    public static final String CLIENT_TOKEN_PREFIX = "bwmux-";

    public static String clientToken(String jobId, long submitAttempt) {
        return CLIENT_TOKEN_PREFIX + jobId + "-" + submitAttempt;
    }
}
