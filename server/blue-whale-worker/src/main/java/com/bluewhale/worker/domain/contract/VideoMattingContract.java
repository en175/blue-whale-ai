package com.bluewhale.worker.domain.contract;

import java.util.List;
import java.util.Map;

public final class VideoMattingContract {

    private VideoMattingContract() {
    }

    public static final String TAG = GenerationMqRouteEnum.VIDEO_MATTING.tag();

    public static final String SOURCE = "video_matting";


    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    public static final String INPUT_KEY_MODE = "mode";

    public static final String INPUT_KEY_FORMAT = "format";

    public static final String INPUT_KEY_BACKGROUND_COLOR = "background_color";


    public static final List<String> SUPPORTED_MODES = List.of("portrait", "greenscreen");


    public static final Map<String, String> SUBMIT_PATHS = Map.of(
            "portrait", "/v1/mediakit/matte-portrait-video",
            "greenscreen", "/v1/mediakit/matte-greenscreen-video");

    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";


    public static final Map<String, String> MODEL_NAMES = Map.of(
            "portrait", "mediakit-matte-portrait-video",
            "greenscreen", "mediakit-matte-greenscreen-video");


    public static final List<String> SUPPORTED_FORMATS = List.of("WEBM", "MP4");
    public static final String DEFAULT_FORMAT = "WEBM";

    public static final String FORMAT_MP4 = "MP4";

    public static final List<String> SUPPORTED_BACKGROUND_COLORS = List.of("white", "black", "green");

    public static final String DEFAULT_BACKGROUND_COLOR = "white";


    public static final String SUBMIT_KEY_VIDEO_URL = "video_url";

    public static final String SUBMIT_KEY_FORMAT = "format";

    public static final String SUBMIT_KEY_BACKGROUND_COLOR = "background_color";


    public static final String RESULT_KEY_VIDEO_URL = "video_url";

    public static final String RESULT_KEY_RESOLUTION = "resolution";

    public static final String RESULT_KEY_DURATION = "duration";


    public static final long MAX_RESULT_BYTES = 1024L * 1024 * 1024;


    public static final String ERROR_VIDEO_MATTING_FAILED = "video_matting_failed";
}
