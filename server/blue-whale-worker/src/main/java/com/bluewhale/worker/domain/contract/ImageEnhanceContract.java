package com.bluewhale.worker.domain.contract;

import java.util.List;
import java.util.Map;
import java.util.Set;

public final class ImageEnhanceContract {

    private ImageEnhanceContract() {
    }

    public static final String TAG = GenerationMqRouteEnum.IMAGE_ENHANCE.tag();

    public static final String SOURCE = "image_enhance";


    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    public static final String INPUT_KEY_VERSION_TIER = "version_tier";

    public static final String INPUT_KEY_MULTIPLE = "multiple";

    public static final String INPUT_KEY_GENERATIVE_ENHANCE_MODE = "generative_enhance_mode";

    public static final String INPUT_KEY_ENABLE_CORRECT_COLOR = "enable_correct_color";


    public static final String TIER_LITE = "lite";

    public static final String TIER_PRO = "pro";

    public static final String TIER_MAX = "max";

    public static final Map<String, String> TIER_TO_TOOL_VERSION = Map.of(
            TIER_LITE, "standard",
            TIER_PRO, "professional",
            TIER_MAX, "max");

    public static final List<Integer> MULTIPLES = List.of(2, 4, 6);


    public static final String MODE_FIDELITY_FIRST = "fidelity_first";

    public static final String MODE_GENERATIVE_FIRST = "generative_first";


    public static final Set<String> TIERS_WITH_ENHANCE_MODE = Set.of(TIER_PRO, TIER_MAX);

    public static final Set<String> TIERS_WITH_CORRECT_COLOR = Set.of(TIER_MAX);


    public static final String DEFAULT_VERSION_TIER = TIER_PRO;

    public static final int DEFAULT_MULTIPLE = 2;

    public static final String DEFAULT_MODE = MODE_GENERATIVE_FIRST;

    public static final boolean DEFAULT_ENABLE_CORRECT_COLOR = true;


    public static final String ERROR_IMAGE_ENHANCE_FAILED = "image_enhance_failed";
}
