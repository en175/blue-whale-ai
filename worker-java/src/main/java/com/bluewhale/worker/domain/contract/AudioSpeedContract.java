package com.bluewhale.worker.domain.contract;

/**
 * 音频调速（audio_speed，画布音频卡「调速」，火山 MediaKit adjust-audio-speed）跨进程任务
 * 契约常量（IKHW5A，父单 IKHVYO；交互与参数口径 = ADR-0113）。
 * <p>
 * 变化轴：跨进程字段（TS 侧权威 = backend/libs/contracts/audio-speed.ts；防漂移断言 =
 * backend/libs/contracts/audio-speed.test.ts 直接读本文件源码文本对账，两处任一侧改动即红）。
 * 契约先行红线：字段名在本类定死后消费方接线票（IKHW59 / IKHW5C / IKHW5S）一律引用本类，
 * 禁止另行发明字面量。
 * <p>
 * MQ tag 的字面量已上移到 {@link GenerationMqRouteEnum}（本类的 {@link #TAG} 只做转发，
 * video_enhance / audio_trim 先例）：TS 侧生产端 queue.constants.ts 的 AUDIO_SPEED_TAG 与
 * 两侧枚举注册由接线票落地，mq-route-parity.test.ts 对枚举表与 TS tag 做一一对应断言，
 * audio-speed.test.ts 的 tag 防漂移断言读该枚举。
 * <p>
 * 供应商接口 = 火山引擎 AI MediaKit「提交音频调速任务」（**异步任务**：提交返 task_id，
 * 轮询查询取 result.audio_url（24h 临时链接）/ result.duration（秒）），火山上游
 * POST /api/v1/tools/adjust-audio-speed；本仓经 new-api 网关调用，网关**对客**路径单源在下方
 * SUBMIT_PATH / POLL_PATH_PREFIX（参数名以官方 CLI 参考文档为准，出处逐条标注在常量注释，
 * 禁止引用二手信息）。
 */
public final class AudioSpeedContract {

    private AudioSpeedContract() {
    }

    /** MQ tag（= generation_jobs.type = JobType.AUDIO_SPEED）；值单处定义在 {@link GenerationMqRouteEnum#AUDIO_SPEED}。 */
    public static final String TAG = GenerationMqRouteEnum.AUDIO_SPEED.tag();

    // ========== input 冻结键名（创建时定死，重试原样沿用） ==========
    // provider_credential 是业务键之上的基础设施键（创建侧冻结落库，同 audio-trim 口径）。

    /** 源素材身份（被调速的音频 Asset id）。 */
    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    /** 播放倍速（范围 [0.1, 4.0]、最多两位小数；**可选键**——恰为 1.0 原速时省略，走官方
     *  默认 1；出站映射官方 speed 参数，同名同值）。 */
    public static final String INPUT_KEY_SPEED = "speed";

    /** 转存产物格式（文档出处：官方 CLI 参考文档 format 节「输出音频格式……默认值为 m4a」——
     *  本产品不传 format〔父单决策：无格式下拉〕，产物格式跟随官方默认输出 m4a，转存扩展名
     *  与 mime 以本常量为单源〔TosAudioMediaRelay 口径：不从响应 content-type 推〕。与
     *  audio_trim 的 FALLBACK_OUTPUT_FORMAT 同值同因，但调速任务 input 无格式键，本常量
     *  是任务级固定值而非回退值）。 */
    public static final String TRANSFER_OUTPUT_FORMAT = "m4a";

    // ========== 网关对客端点路径（IKH67T：网关路由 ≠ 火山上游路径，混用即 404 Invalid URL；
    //            网关配置由独立拆票上线前置——IKH28Y / IKH8BK 先例，ADR-0113） ==========
    // 常量值与 TS 契约 audio-speed.ts 的 AUDIO_SPEED_SUBMIT_PATH / AUDIO_SPEED_POLL_PATH_PREFIX
    // 同值（家族规律 /v1/mediakit/{与上游同名的工具段}；网关配置票定稿后回填）。

    /** 网关异步提交路由：POST {SUBMIT_PATH}（网关按路径末段决定工具）。火山上游侧对应
     *  POST /api/v1/tools/adjust-audio-speed（官方 CLI 参考文档「提交音频调速任务」节），
     *  由网关内部转发，本仓不直连上游。 */
    public static final String SUBMIT_PATH = "/v1/mediakit/adjust-audio-speed";

    /** 网关异步任务查询路由前缀（拼 taskId）：GET {POLL_PATH_PREFIX}{task_id}。MediaKit
     *  异步工具共用同一条查询路由，路径**不含 async 段**。 */
    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

    // ========== 错误码（数值 1051 见 error-codes.ts ERROR_AUDIO_SPEED_FAILED；
    //            1048 截取 / 1050 抠像已占用） ==========

    /** 执行兜底失败码：网关分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 /
     *  提交超时 provider_timeout 1012）之外的火山任务 failed（含 speed 越界等供应商侧官方
     *  约束拒绝）与结果下载转存失败统一归并本码，无 worker 级自动重试，上游可读原因随
     *  message 透传前端投影，用户手动重试沿用冻结 input（源 + speed）。 */
    public static final String ERROR_AUDIO_SPEED_FAILED = "audio_speed_failed";
}
