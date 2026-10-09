package com.bluewhale.worker.domain.contract;

import java.util.List;
import java.util.Map;

public final class VocalSplitContract {

    private VocalSplitContract() {
    }

    public static final String TAG = GenerationMqRouteEnum.VOCAL_SPLIT.tag();

    public static final String SOURCE = "vocal_split";


    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    public static final String INPUT_KEY_SCENE = "scene";

    public static final String INPUT_KEY_OUTPUT_FORMAT = "output_format";


    public static final List<String> SUPPORTED_SCENES =
            List.of("audio", "music", "drama", "narrate");

    public static final String DEFAULT_SCENE = "audio";

    public static final Map<String, String> SCENE_UPSTREAM_MAP =
            Map.of(
                    "audio", "Audio",
                    "music", "Music",
                    "drama", "Drama",
                    "narrate", "Narrate");


    public static final List<String> SUPPORTED_OUTPUT_FORMATS =
            List.of("aac", "mp3", "wav", "m4a", "flac");

    public static final String DEFAULT_OUTPUT_FORMAT = "aac";


    public static final List<String> TRACK_TYPES =
            List.of("voice", "background", "music", "sfx");

    public static final Map<String, List<String>> SCENE_TRACKS =
            Map.of(
                    "audio", List.of("voice", "background"),
                    "music", List.of("voice", "background"),
                    "drama", List.of("voice", "music", "sfx"),
                    "narrate", List.of("voice", "music", "sfx"));


    public static final String SUBMIT_PATH = "/v1/mediakit/separate-voice";

    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";


    public static final String ERROR_VOCAL_SPLIT_FAILED = "vocal_split_failed";
}
