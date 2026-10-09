package com.bluewhale.worker.domain.contract;

import java.util.List;

public final class ImageEraseContract {

    private ImageEraseContract() {
    }

    public static final String TAG = GenerationMqRouteEnum.IMAGE_ERASE.tag();

    public static final String SOURCE = "image_erase";


    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    public static final String INPUT_KEY_ERASE_SCENE = "erase_scene";

    public static final String INPUT_KEY_MASK_ASSET_ID = "mask_asset_id";


    public static final String SCENE_FULL_SCREEN_TEXT_ERASE = "full_screen_text_erase";

    public static final String SCENE_SELECTED_AREA_ERASE = "selected_area_erase";


    public static final String TOOL_VERSION = "standard";

    public static final String OUTPUT_FORMAT = "png";


    public static final int MAX_INPUT_LONG_SIDE_PX = 2560;

    public static final int MAX_INPUT_SHORT_SIDE_PX = 1440;

    public static final int MIN_INPUT_SIDE_PX = 10;

    public static final long MAX_INPUT_FILE_BYTES = 10L * 1024 * 1024;

    public static final List<String> SUPPORTED_INPUT_FORMATS = List.of("png", "jpg", "jpeg", "heic");


    public static final String ERROR_IMAGE_ERASE_FAILED = "image_erase_failed";
}
