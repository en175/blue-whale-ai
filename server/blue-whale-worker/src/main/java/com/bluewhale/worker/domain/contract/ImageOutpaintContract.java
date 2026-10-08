package com.bluewhale.worker.domain.contract;

public final class ImageOutpaintContract {

    private ImageOutpaintContract() {
    }

    public static final String TAG = "image_outpaint";

    public static final String SOURCE = "image_outpaint";


    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    public static final String INPUT_KEY_EXPAND_TOP = "expand_top";

    public static final String INPUT_KEY_EXPAND_BOTTOM = "expand_bottom";

    public static final String INPUT_KEY_EXPAND_LEFT = "expand_left";

    public static final String INPUT_KEY_EXPAND_RIGHT = "expand_right";


    public static final double EXPAND_RATIO_MIN = 0.0d;

    public static final double EXPAND_RATIO_MAX = 0.4d;


    public static final String ERROR_IMAGE_OUTPAINT_FAILED = "image_outpaint_failed";
}
