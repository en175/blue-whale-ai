package com.bluewhale.worker.domain.contract;

import java.util.List;

/**
 * 音频截取（audio_trim，画布音频卡「截取」，火山 MediaKit trim-audio）跨进程任务契约常量
 * （IKHB6F，父单 IKHB08；交互与参数口径 = ADR-0111）。
 * <p>
 * 变化轴：跨进程字段（TS 侧权威 = backend/libs/contracts/audio-trim.ts；防漂移断言 =
 * backend/libs/contracts/audio-trim.test.ts 直接读本文件源码文本对账，两处任一侧改动即红）。
 * 契约先行红线：字段名在本类定死后消费方接线票（IKHB6N / IKHB6Y / IKHB7A）一律引用本类，
 * 禁止另行发明字面量。
 * <p>
 * MQ tag 的字面量已上移到 {@link GenerationMqRouteEnum}（本类的 {@link #TAG} 只做转发，
 * video_enhance 先例）：TS 侧生产端 queue.constants.ts 的 AUDIO_TRIM_TAG 与两侧枚举注册
 * 已随接线票（IKHB6S）落地，mq-route-parity.test.ts 对枚举表与 TS tag 做一一对应断言，
 * audio-trim.test.ts 的 tag 防漂移断言读该枚举。
 * <p>
 * 供应商接口 = 火山引擎 AI MediaKit「提交音频裁剪任务 API」（**异步任务**：提交返 task_id，
 * 轮询查询取 result.audio_url（24h 临时链接）/ result.duration），火山上游
 * POST /api/v1/tools/trim-audio；本仓经 new-api 网关调用，网关**对客**路径单源在下方
 * SUBMIT_PATH / POLL_PATH_PREFIX（参数名以官方 PDF 为准，出处逐条标注在常量注释，
 * 禁止引用二手信息）。
 */
public final class AudioTrimContract {

    private AudioTrimContract() {
    }

    /** MQ tag（= generation_jobs.type = JobType.AUDIO_TRIM）；值单处定义在 {@link GenerationMqRouteEnum#AUDIO_TRIM}。 */
    public static final String TAG = GenerationMqRouteEnum.AUDIO_TRIM.tag();

    // ========== input 冻结键名（创建时定死，重试原样沿用） ==========
    // provider_credential 是业务键之上的基础设施键（创建侧冻结落库，同 MediaExtractContract 口径）。

    /** 源素材身份（被截取的音频 Asset id）。 */
    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    /** 截取开始时间（秒，最多两位小数；**可选键**——选区左缘贴 0 时省略，走官方默认「从音频
     *  开头开始」=0；出站映射官方 start_time 参数，同名同值）。 */
    public static final String INPUT_KEY_START_TIME = "start_time";

    /** 截取结束时间（秒，最多两位小数；**可选键**——选区右缘贴源全长时省略，走官方默认
     *  「裁剪到输入音频末尾」，规避上传时长整秒精度的超界风险（ADR-0111）；出站映射官方
     *  end_time 参数，同名同值）。 */
    public static final String INPUT_KEY_END_TIME = "end_time";

    /** 输出音频格式（见 SUPPORTED_OUTPUT_FORMATS；出站换算官方 format 参数，同名同值）。 */
    public static final String INPUT_KEY_OUTPUT_FORMAT = "output_format";

    // ========== 输出音频格式枚举（文档出处：官方 PDF Body 参数 format 节——「输出音频格式，
    //            支持 mp3、m4a、ogg、flac、wav。默认值为 m4a」，列举顺序照官方文档） ==========

    /** 输出音频格式五值（与火山 API 参数取值同名同值，出站原样透传）。独立于 media-extract
     *  的同形枚举，两家族契约各自单源。 */
    public static final List<String> SUPPORTED_OUTPUT_FORMATS =
            List.of("mp3", "m4a", "ogg", "flac", "wav");

    /** 回退输出格式 m4a（官方 format 默认值；产品口径 ADR-0111「默认跟随源音频格式，源格式
     *  不在枚举（如 aac）回退 m4a」）。默认推导纯函数单源在 TS 侧
     *  {@code defaultAudioTrimOutputFormat}（web 面板默认选中与 backend 缺省补值共用），
     *  Java 侧不镜像函数——worker 只消费创建时已冻结的合法枚举值，解析兜底校验用上方枚举。 */
    public static final String FALLBACK_OUTPUT_FORMAT = "m4a";

    // ========== 网关对客端点路径（IKH67T：网关路由 ≠ 火山上游路径，混用即 404 Invalid URL；
    //            网关配置由独立拆票上线前置——IKH28Y / IKH8BK 先例，ADR-0111） ==========

    /** 网关异步提交路由：POST {SUBMIT_PATH}（网关按路径末段决定工具）。火山上游侧对应
     *  POST /api/v1/tools/trim-audio（官方 PDF「1. 提交音频裁剪任务 API」节逐字），
     *  由网关内部转发，本仓不直连上游。 */
    public static final String SUBMIT_PATH = "/v1/mediakit/trim-audio";

    /** 网关异步任务查询路由前缀（拼 taskId）：GET {POLL_PATH_PREFIX}{task_id}。MediaKit
     *  异步工具共用同一条查询路由，路径**不含 async 段**。 */
    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

    // ========== 错误码（数值 1047 见 error-codes.ts ERROR_AUDIO_TRIM_FAILED；
    //            1045 已由视频 HD 高清占用） ==========

    /** 执行兜底失败码：网关分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 /
     *  提交超时 provider_timeout 1012）之外的火山任务 failed（含 end_time 超真实片尾等
     *  供应商侧官方约束拒绝）与结果下载转存失败统一归并本码，无 worker 级自动重试，
     *  上游可读原因随 message 透传前端投影。 */
    public static final String ERROR_AUDIO_TRIM_FAILED = "audio_trim_failed";
}
