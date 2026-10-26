package com.bluewhale.worker.domain.contract;

public final class AudioSpeedContract {

    private AudioSpeedContract() {
    }

    public static final String TAG = GenerationMqRouteEnum.AUDIO_SPEED.tag();


    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    public static final String INPUT_KEY_SPEED = "speed";

    public static final String TRANSFER_OUTPUT_FORMAT = "m4a";


    public static final String SUBMIT_PATH = "/v1/mediakit/adjust-audio-speed";

    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";


    public static final String ERROR_AUDIO_SPEED_FAILED = "audio_speed_failed";
}
