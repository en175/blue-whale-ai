package com.bluewhale.worker.domain.contract;

import java.util.List;

public final class VideoFrameInterpolationContract {

    private VideoFrameInterpolationContract() {
    }

    public static final String TAG = GenerationMqRouteEnum.VIDEO_FRAME_INTERPOLATION.tag();

    public static final String SOURCE = "video_frame_interpolation";


    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    public static final String INPUT_KEY_FPS = "fps";


    public static final List<Integer> SUPPORTED_FPS = List.of(30, 60, 120);

    public static final int DEFAULT_FPS = 60;


    public static final String SUBMIT_PATH = "/v1/mediakit/video-frame-interpolation";

    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";


    public static final String RESULT_KEY_VIDEO_URL = "video_url";

    public static final String RESULT_KEY_DURATION = "duration";

    public static final String RESULT_KEY_RESOLUTION = "resolution";

    public static final String RESULT_KEY_FPS = "fps";



    public static final String ERROR_VIDEO_FRAME_INTERPOLATION_FAILED = "video_frame_interpolation_failed";
}
