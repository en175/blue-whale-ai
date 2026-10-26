package com.bluewhale.worker.domain.contract;

import java.util.List;
import java.util.Map;

public final class VideoSceneSplitContract {

    private VideoSceneSplitContract() {
    }

    public static final String TAG = GenerationMqRouteEnum.VIDEO_SCENE_SPLIT.tag();

    public static final String SOURCE = "video_scene_split";


    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    public static final String INPUT_KEY_GRANULARITY = "granularity";


    public static final List<String> SUPPORTED_GRANULARITIES = List.of("fine", "standard", "coarse");

    public static final String DEFAULT_GRANULARITY = "standard";

    public static final Map<String, Integer> SEGMENT_THRESHOLD = Map.of(
            "fine", 5,
            "standard", 10,
            "coarse", 20);


    public static final String SUBMIT_PATH = "/v1/mediakit/segment-scenes";

    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";


    public static final String MODEL_NAME = "mediakit-segment-scenes";


    public static final String RESULT_KEY_DURATION = "duration";

    public static final String RESULT_KEY_SEGMENTS = "segments";

    public static final String SEGMENT_KEY_INDEX = "segment_index";

    public static final String SEGMENT_KEY_START_TIME = "start_time";

    public static final String SEGMENT_KEY_END_TIME = "end_time";

    public static final String SEGMENT_KEY_ASSET_ID = "segment_asset_id";


    public static final long MAX_INPUT_DURATION_MS = 2L * 60 * 60 * 1000;



    public static final String ERROR_VIDEO_SCENE_SPLIT_FAILED = "video_scene_split_failed";
}
