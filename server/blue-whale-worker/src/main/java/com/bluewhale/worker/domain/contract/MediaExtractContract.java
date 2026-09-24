package com.bluewhale.worker.domain.contract;

import java.util.List;

/**
 * 音视频分离（media_extract，原「提取音频」）跨进程任务契约常量（迁移契约 §18 / IKH28T）。
 * <p>
 * 变化轴：跨进程字段（TS 侧权威 = backend/libs/contracts/media-extract.ts；防漂移断言 =
 * backend/libs/contracts/media-extract.test.ts 直接读本文件源码文本对账，两处任一侧改动即红）。
 * <p>
 * 任务类型沿用 media_extract、input 字段结构不变是既定决策（ADR-0103：本地 ffmpeg 链路
 * 代码全保留，双执行路径并存），本契约只扩 output_format 枚举面与火山执行路径错误码面。
 * 契约先行红线：字段名在本类定死后 IKH28V（创建入口行为切换）/ IKH28W（worker 执行面
 * 切换）一律引用本类，禁止另行发明字面量。
 * <p>
 * 供应商接口 = 火山引擎 AI MediaKit「提交音频提取任务 API」（**异步任务**：提交返 task_id，
 * 轮询查询取 result.audio_url / result.duration），火山上游 POST /api/v1/tools/extract-audio；
 * 本仓经 new-api 网关调用，网关**对客**路径单源在下方 SUBMIT_PATH / POLL_PATH_PREFIX
 * （参数名以官方 PDF 为准，出处逐条标注在常量注释，禁止引用二手信息）。
 */
public final class MediaExtractContract {

    private MediaExtractContract() {
    }

    /** MQ tag（= generation_jobs.type = JobType.MEDIA_EXTRACT）；值单处定义在 {@link GenerationMqRouteEnum#MEDIA_EXTRACT}。 */
    public static final String TAG = GenerationMqRouteEnum.MEDIA_EXTRACT.tag();

    /** 任务来源值：沿用既有唯一创建入口（画布视频卡工具条）的既有落库值 dock——media_extract
     *  不套 claim source 白名单（契约 §2/§7），值不变。 */
    public static final String SOURCE = "dock";

    // ========== input 冻结键名（两键恒在、值恒为合法枚举，创建时定死，重试原样沿用；结构不变 ADR-0103） ==========

    /** 源素材身份（被分离音轨的视频 Asset id）。 */
    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    /** 输出音频格式（见 SUPPORTED_OUTPUT_FORMATS；出站映射官方 format 参数，同名同值）。 */
    public static final String INPUT_KEY_OUTPUT_FORMAT = "output_format";

    // ========== 输出格式枚举（文档出处：官方 PDF Body 参数 format 节——「支持 mp3、m4a、ogg、flac、wav」） ==========

    /** 输出音频格式五值（与火山 API 参数取值同名同值，出站原样透传）。 */
    public static final List<String> SUPPORTED_OUTPUT_FORMATS =
            List.of("m4a", "mp3", "ogg", "flac", "wav");

    /** 缺省输出格式 m4a（文档出处：官方 PDF format 节描述文字「默认值为 m4a」——表格示例值列
     *  写 mp3，以描述文字为准）。创建入口未传时落本值；非法值明确拒绝，不静默回退。 */
    public static final String DEFAULT_OUTPUT_FORMAT = "m4a";

    // ========== 网关对客端点路径（IKH67T：网关路由 ≠ 火山上游路径，混用即 404 Invalid URL） ==========

    /** 网关异步提交路由：POST {SUBMIT_PATH}（网关按路径末段决定工具）。火山上游侧对应
     *  POST /api/v1/tools/extract-audio（官方 PDF「1. 提交音频提取任务 API」节逐字），
     *  由网关内部转发，本仓不直连上游。 */
    public static final String SUBMIT_PATH = "/v1/mediakit/extract-audio";

    /** 网关异步任务查询路由前缀（拼 taskId）：GET {POLL_PATH_PREFIX}{task_id}。三个 MediaKit
     *  异步工具（去字幕 / 视频 HD / 音视频分离）共用同一条查询路由，路径**不含 async 段**。 */
    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

    // ========== 错误码（火山执行路径兜底码数值 1044 见 error-codes.ts
    //            ERROR_MEDIA_EXTRACT_PROVIDER_FAILED；映射口径全文 = 迁移契约 §18.x） ==========

    /** 火山执行路径兜底失败码：网关分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed
     *  1011 / 提交超时 provider_timeout 1012）之外的火山任务失败与转存失败统一归并本码；
     *  与本地 ffmpeg 链路兜底 media_extract_failed(1020) 区分（双执行路径并存 ADR-0103）。 */
    public static final String ERROR_MEDIA_EXTRACT_PROVIDER_FAILED = "media_extract_provider_failed";
}
