package com.bluewhale.worker.domain.contract;

import java.util.List;

public final class AudioTrimContract {

    private AudioTrimContract() {
    }

    public static final String TAG = GenerationMqRouteEnum.AUDIO_TRIM.tag();


    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    public static final String INPUT_KEY_START_TIME = "start_time";

    public static final String INPUT_KEY_END_TIME = "end_time";

    public static final String INPUT_KEY_OUTPUT_FORMAT = "output_format";


    public static final List<String> SUPPORTED_OUTPUT_FORMATS =
            List.of("mp3", "m4a", "ogg", "flac", "wav");

    public static final String FALLBACK_OUTPUT_FORMAT = "m4a";


    public static final String SUBMIT_PATH = "/v1/mediakit/trim-audio";

    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";


    public static final String ERROR_AUDIO_TRIM_FAILED = "audio_trim_failed";
}
