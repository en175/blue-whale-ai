package com.bluewhale.worker.domain.contract;

import java.util.Map;

public final class VideoSubtitleEraseContract {

    private VideoSubtitleEraseContract() {
    }

    public static final String TAG = GenerationMqRouteEnum.VIDEO_SUBTITLE_ERASE.tag();

    public static final String SOURCE = "video_subtitle_erase";


    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    public static final String INPUT_KEY_DETECT_MODE = "detect_mode";

    public static final String INPUT_KEY_ERASE_BOXES = "erase_boxes";


    public static final String BOX_KEY_TOP_LEFT_X = "top_left_x";

    public static final String BOX_KEY_TOP_LEFT_Y = "top_left_y";

    public static final String BOX_KEY_BOTTOM_RIGHT_X = "bottom_right_x";

    public static final String BOX_KEY_BOTTOM_RIGHT_Y = "bottom_right_y";


    public static final String DETECT_MODE_SUBTITLE_SMART = "subtitle_smart";

    public static final String DETECT_MODE_TEXT_FULL = "text_full";

    public static final Map<String, String> MODE = Map.of(
            DETECT_MODE_SUBTITLE_SMART, "Subtitle",
            DETECT_MODE_TEXT_FULL, "Text");

    public static final int MAX_BOXES = 20;


    public static final String MODEL_VERSION = "v5";

    public static final String OUTPUT_ENCODE_MODE = "Quality";


    public static final int MAX_INPUT_SHORT_SIDE_PX = 1440;

    public static final int MAX_INPUT_LONG_SIDE_PX = 2560;

    public static final long MAX_INPUT_DURATION_MS = 10L * 60 * 1000;



    public static final String ERROR_VIDEO_SUBTITLE_ERASE_FAILED = "video_subtitle_erase_failed";
}
