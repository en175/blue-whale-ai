package com.bluewhale.worker.domain.contract;

import java.util.List;

public final class VideoEnhanceContract {

    private VideoEnhanceContract() {
    }

    public static final String TAG = GenerationMqRouteEnum.VIDEO_ENHANCE.tag();

    public static final String SOURCE = "video_enhance";


    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    public static final String INPUT_KEY_RESOLUTION = "resolution";


    public static final List<String> SUPPORTED_RESOLUTIONS = List.of("1080p", "2k", "4k");

    public static final String DEFAULT_RESOLUTION = "1080p";


    public static final String SUBMIT_PATH = "/v1/mediakit/enhance-video-generative";

    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";


    public static final String BITRATE_LEVEL = "medium";

    public static final java.util.Map<String, Integer> RESOLUTION_SHORT_SIDE_PX = java.util.Map.of(
            "1080p", 1080,
            "2k", 1440,
            "4k", 2160);


    public static final int MIN_INPUT_SHORT_SIDE_PX = 360;

    public static final int MAX_INPUT_SHORT_SIDE_PX = 1080;

    public static final int MIN_INPUT_LONG_SIDE_PX = 360;

    public static final int MAX_INPUT_LONG_SIDE_PX = 1920;



    public static final String ERROR_VIDEO_ENHANCE_FAILED = "video_enhance_failed";
}
