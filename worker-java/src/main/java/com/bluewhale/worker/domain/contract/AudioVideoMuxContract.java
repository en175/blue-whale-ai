package com.bluewhale.worker.domain.contract;

import java.util.List;

/** IKIHPJ（父规格 IKIHMX）: 与 backend/libs/contracts/audio-video-mux.ts 对齐的跨进程常量（迁移契约 §20）。
 * 冻结快照对象内 camel（assetId/nodeId），顶层 is_audio_reserve/sync；网关出站键另按供应商
 * snake_case（video_url/audio_url/...），两套命名不混。 */
public final class AudioVideoMuxContract {
    private AudioVideoMuxContract() {}

    public static final String TAG = GenerationMqRouteEnum.AUDIO_VIDEO_MUX.tag();
    public static final String SOURCE = "dock";
    public static final String INPUT_KEY_AUDIO = "audio";
    public static final String INPUT_KEY_VIDEO = "video";
    public static final String INPUT_KEY_IS_AUDIO_RESERVE = "is_audio_reserve";
    public static final String INPUT_KEY_SYNC = "sync";
    public static final String INPUT_KEY_SUBMIT_ATTEMPT = "submit_attempt";
    public static final String INPUT_FIELD_ASSET_ID = "assetId";
    public static final String INPUT_FIELD_NODE_ID = "nodeId";
    public static final String INPUT_FIELD_URL = "url";
    /** sync 三档（none=保持原长 / video=裁到视频长 / audio=裁到音频长，全为裁剪语义）。 */
    public static final List<String> SYNC_VALUES = List.of("none", "video", "audio");
    public static final String SUBMIT_PATH = "/v1/mediakit/mux-audio-video";
    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";
    public static final String ERROR_AUDIO_VIDEO_MUX_FAILED = "audio_video_mux_failed";
    /** 成品转存上限：10 GiB，对齐 IKI696 音频侧先例（TosAudioMediaRelay.MAX_RELAY_BYTES）；
     *  VideoMattingContract 的 1 GiB 是私有旧口径不复用。只作转存判据不是创建上限。 */
    public static final long MAX_RESULT_BYTES = 10L << 30;
    /** 供应商层幂等键前缀：client_token = 前缀 + jobId + "-" + submit_attempt（≤64 可打印 ASCII）。
     *  崩溃重提同 token 被供应商去重；业务重试递增 submit_attempt 换新 token 不被去重。 */
    public static final String CLIENT_TOKEN_PREFIX = "bwmux-";

    /** 供应商 client_token 确定性派生（与 TS audioVideoMuxClientToken 同式）。 */
    public static String clientToken(String jobId, long submitAttempt) {
        return CLIENT_TOKEN_PREFIX + jobId + "-" + submitAttempt;
    }
}
