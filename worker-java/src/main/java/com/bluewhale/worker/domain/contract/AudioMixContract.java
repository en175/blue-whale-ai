package com.bluewhale.worker.domain.contract;

import java.util.List;

/** IKI68N: 与 backend/libs/contracts/audio-mix.ts 对齐的跨进程常量。 */
public final class AudioMixContract {
    private AudioMixContract() {}

    public static final String TAG = GenerationMqRouteEnum.AUDIO_MIX.tag();
    public static final String SOURCE = "dock";
    public static final String INPUT_KEY_INPUTS = "inputs";
    public static final String INPUT_KEY_SOURCE_NODE_ID = "source_node_id";
    public static final String INPUT_KEY_OUTPUT_FORMAT = "output_format";
    public static final List<String> SUPPORTED_OUTPUT_FORMATS = List.of("mp3", "m4a", "ogg", "flac", "wav");
    public static final String DEFAULT_OUTPUT_FORMAT = "mp3";
    public static final String SUBMIT_PATH = "/v1/mediakit/mix-audio";
    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";
    public static final String ERROR_AUDIO_MIX_FAILED = "audio_mix_failed";
    /** 任务失败 error.details 的上游 HTTP 状态键（IKIHGQ）：上游非 2xx 时写入，backend 401
     *  换凭证判定读它，文案正则仅兼容旧数据——与 backend/libs/contracts/audio-mix.ts 对齐。 */
    public static final String ERROR_DETAIL_HTTP_STATUS = "http_status";
}
