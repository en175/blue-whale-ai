package com.bluewhale.worker.domain.contract;

import java.util.List;

public final class ImageCutoutContract {

    private ImageCutoutContract() {
    }

    public static final String TAG = GenerationMqRouteEnum.IMAGE_CUTOUT.tag();

    public static final String SOURCE = "image_cutout";


    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    public static final String INPUT_KEY_CUTOUT_SCENE = "cutout_scene";

    public static final String INPUT_KEY_NEED_CONTOUR = "need_contour";

    public static final String INPUT_KEY_CONTOUR_COLOR = "contour_color";

    public static final String INPUT_KEY_CONTOUR_SIZE = "contour_size";

    public static final String INPUT_KEY_NEED_CROP_BACKGROUND = "need_crop_background";


    public static final String SCENE_GENERAL = "general";

    public static final String SCENE_HUMAN = "human";

    public static final String SCENE_PRODUCT = "product";


    public static final String OUTPUT_FORMAT = "png";

    public static final String CONTOUR_COLOR = "#FFFFFF";

    public static final int CONTOUR_SIZE_MIN = 1;

    public static final int CONTOUR_SIZE_MAX = 100;

    public static final int CONTOUR_SIZE_DEFAULT = 10;


    public static final long MAX_INPUT_FILE_BYTES = 30L * 1024 * 1024;

    public static final List<String> SUPPORTED_INPUT_FORMATS = List.of("png", "jpg", "jpeg", "heic");


    public static final int MAX_GENERAL_INPUT_LONG_SIDE_PX = 10240;

    public static final int MAX_GENERAL_INPUT_SHORT_SIDE_PX = 6000;

    public static final long MAX_GENERAL_INPUT_TOTAL_PIXELS = 40_000_000L;

    public static final int MAX_SUBJECT_INPUT_LONG_SIDE_PX = 7680;

    public static final int MAX_SUBJECT_INPUT_SHORT_SIDE_PX = 4320;


    public static final String ERROR_IMAGE_CUTOUT_FAILED = "image_cutout_failed";
}
