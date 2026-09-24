package com.bluewhale.worker.domain.contract;

import java.util.List;
import java.util.Map;

/**
 * 人声背景分离（vocal_split）跨进程任务契约常量（IKHA2C）。
 * <p>
 * 变化轴：跨进程字段（TS 侧权威 = backend/libs/contracts/vocal-split.ts；防漂移断言 =
 * backend/libs/contracts/vocal-split.test.ts 直接读本文件源码文本对账，两处任一侧改动即红）。
 * 契约先行红线：字段名在本类定死后 IKHA2J（消费者、处理器、领取 SQL、终态收口）一律
 * 引用本类，禁止另行发明字面量。
 * <p>
 * 供应商接口 = 火山引擎 AI MediaKit「人声背景音分离」官方 PDF（**异步任务**：提交返
 * task_id，轮询查询按 scene 取 result 的 2/3 个音轨 URL 与 duration——24 小时时效，
 * 完成后须立即转存自家 TOS），火山上游 POST /api/v1/tools/separate-voice；本仓经
 * new-api 网关调用，网关**对客**路径单源在下方 SUBMIT_PATH / POLL_PATH_PREFIX
 * （参数名以官方 PDF 为准，出处逐条标注在常量注释，禁止引用二手信息）。
 * 与 media_extract 是两个独立契约（不共用常量）：输出格式枚举不同（本工具有 aac 无
 * ogg、默认 aac）、scene 参数分叉多轨结果。
 */
public final class VocalSplitContract {

    private VocalSplitContract() {
    }

    /** MQ tag（= generation_jobs.type = JobType.VOCAL_SPLIT）；值单处定义在 {@link GenerationMqRouteEnum#VOCAL_SPLIT}。 */
    public static final String TAG = GenerationMqRouteEnum.VOCAL_SPLIT.tag();

    /** 任务来源值：人声分离只有画布媒体卡工具条一个创建入口，claim SQL 的 source 白名单
     *  仅含本值（video_subtitle_erase / video_enhance 的「专属来源值」同款模式）。 */
    public static final String SOURCE = "vocal_split";

    // ========== input 冻结键名（三键恒在、值恒为合法枚举，创建时定死，重试原样沿用） ==========

    /** 源素材身份（被分离音轨的视频/音频 Asset id）。 */
    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    /** 分离场景（见 SUPPORTED_SCENES；本仓小写产品键，出站映射官方首字母大写枚举，见 SCENE_UPSTREAM_MAP）。 */
    public static final String INPUT_KEY_SCENE = "scene";

    /** 输出音频格式（见 SUPPORTED_OUTPUT_FORMATS；出站映射官方 output_format 参数，同名同值）。 */
    public static final String INPUT_KEY_OUTPUT_FORMAT = "output_format";

    // ========== 分离场景枚举（文档出处：官方 PDF「进阶使用：选择分离场景」节 scene 取值表） ==========

    /** 场景四档（本仓小写产品键；官方取值 Audio/Music/Drama/Narrate）。 */
    public static final List<String> SUPPORTED_SCENES =
            List.of("audio", "music", "drama", "narrate");

    /** 缺省场景 audio（文档出处：官方 PDF scene 节「Audio（默认）」）。创建入口未传时补本值；
     *  非法值明确拒绝，不静默回退。 */
    public static final String DEFAULT_SCENE = "audio";

    /** scene 出站映射：本仓小写产品键 → 官方枚举（首字母大写），worker 出站请求处引用本表换算。 */
    public static final Map<String, String> SCENE_UPSTREAM_MAP =
            Map.of(
                    "audio", "Audio",
                    "music", "Music",
                    "drama", "Drama",
                    "narrate", "Narrate");

    // ========== 输出格式枚举（文档出处：官方 PDF「使用限制」节——aac/mp3/wav/m4a/flac，默认 aac） ==========

    /** 输出音频格式五值（与火山 API 参数取值同名同值，出站原样透传；**与 extract-audio 枚举面
     *  不同**：有 aac 无 ogg）。 */
    public static final List<String> SUPPORTED_OUTPUT_FORMATS =
            List.of("aac", "mp3", "wav", "m4a", "flac");

    /** 缺省输出格式 aac（文档出处：官方 PDF「使用限制」节「默认值为 aac」——注意与
     *  extract-audio 默认 m4a 不同）。创建入口未传时补本值；非法值明确拒绝，不静默回退。 */
    public static final String DEFAULT_OUTPUT_FORMAT = "aac";

    // ========== 多轨结果结构（文档出处：官方 PDF scene 取值表「输出音轨」列；跨进程新面，本契约定死） ==========

    /** 轨类型四值（官方 URL 键 voice_audio_url / background_audio_url / music_audio_url /
     *  sfx_audio_url 的轨语义；本仓轨结果以轨类型键 track_type 承载）。 */
    public static final List<String> TRACK_TYPES =
            List.of("voice", "background", "music", "sfx");

    /** scene → 轨序（二分法通用/音乐两轨〔voice+background〕，三分法短剧/口播三轨
     *  〔voice+music+sfx〕；voice 恒首轨，轨序即结果数组顺序。expected_output_count
     *  建单时按本表长度落 2 或 3）。 */
    public static final Map<String, List<String>> SCENE_TRACKS =
            Map.of(
                    "audio", List.of("voice", "background"),
                    "music", List.of("voice", "background"),
                    "drama", List.of("voice", "music", "sfx"),
                    "narrate", List.of("voice", "music", "sfx"));

    // ========== 网关对客端点路径（IKH67T：网关路由 ≠ 火山上游路径，混用即 404 Invalid URL） ==========

    /** 网关异步提交路由：POST {SUBMIT_PATH}（网关按路径末段决定工具）。火山上游侧对应
     *  POST /api/v1/tools/separate-voice（官方 PDF「第 1 步：提交任务」节逐字），由网关
     *  内部转发，本仓不直连上游。**本值按家族惯例预占位，网关票定稿后回填。** */
    public static final String SUBMIT_PATH = "/v1/mediakit/separate-voice";

    /** 网关异步任务查询路由前缀（拼 taskId）：GET {POLL_PATH_PREFIX}{task_id}。MediaKit
     *  异步工具（去字幕 / 视频 HD / 音视频分离）共用同一条查询路由，路径**不含 async 段**。 */
    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

    // ========== 错误码（兜底码数值 1047 见 error-codes.ts ERROR_VOCAL_SPLIT_FAILED；
    //            归并口径全文 = backend/libs/contracts/vocal-split.ts 尾注） ==========

    /** 执行兜底失败码：网关分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed
     *  1011 / 提交超时 provider_timeout 1012）之外的火山任务失败（轮询 status=failed）与
     *  转存失败（result 各轨 URL 24h 临时链接 → 自家 TOS）统一归并本码，无 worker 级重试。 */
    public static final String ERROR_VOCAL_SPLIT_FAILED = "vocal_split_failed";
}
