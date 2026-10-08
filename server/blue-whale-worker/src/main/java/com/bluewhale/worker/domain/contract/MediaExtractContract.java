package com.bluewhale.worker.domain.contract;

import java.util.List;

public final class MediaExtractContract {

    private MediaExtractContract() {
    }

    public static final String TAG = GenerationMqRouteEnum.MEDIA_EXTRACT.tag();

    public static final String SOURCE = "dock";


    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    public static final String INPUT_KEY_OUTPUT_FORMAT = "output_format";


    public static final List<String> SUPPORTED_OUTPUT_FORMATS =
            List.of("m4a", "mp3", "ogg", "flac", "wav");

    public static final String DEFAULT_OUTPUT_FORMAT = "m4a";


    public static final String SUBMIT_PATH = "/v1/mediakit/extract-audio";

    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";


    public static final String ERROR_MEDIA_EXTRACT_PROVIDER_FAILED = "media_extract_provider_failed";
}
