package com.bluewhale.worker.domain.contract;

import java.util.List;

/**
 * 视频 HD 高清（video_enhance，火山 MediaKit 画质增强大模型版）跨进程任务契约常量
 * （IKH3VE，父规格 IKH3VB；面板极简骨架与参数裁剪口径 = ADR-0105）。
 * <p>
 * 变化轴：跨进程字段（TS 侧权威 = backend/libs/contracts/video-enhance.ts；防漂移断言 =
 * backend/libs/contracts/video-enhance.test.ts 直接读本文件源码文本对账，两处任一侧改动即红）。
 * <p>
 * MQ tag 的字面量已上移到 {@link GenerationMqRouteEnum}（本类的 {@link #TAG} 只做转发）：
 * 防漂移断言若要继续按源码文本对账 tag，须改读该枚举文件。
 * 契约先行红线：字段名在本类定死后创建入口（IKH3VE）与执行面（消费者、处理器、领取 SQL、
 * 终态收口——worker 票按附录 C 触点注册）一律引用本类，禁止另行发明字面量。
 * <p>
 * 供应商接口 = 火山引擎 AI MediaKit「提交画质增强（大模型版）任务 API」（**异步任务**：
 * 提交返 task_id，轮询查询取 result.video_url（24h 临时链接）/ duration / resolution / fps），
 * 火山上游 POST /api/v1/tools/enhance-video-generative；本仓经 new-api 网关调用，网关
 * **对客**路径单源在下方 SUBMIT_PATH / POLL_PATH_PREFIX（参数名以官方 PDF
 * 为准，出处逐条标注在常量注释，禁止引用二手信息）。⚠️ 官方文档内部矛盾：失败示例报错
 * 文案写 resolution 仅 [720p,1080p]，以 Body 参数表（720p 默认 / 1080p / 2k / 4k）与附录
 * 码率参考表（含 2K/4K 行）为准。
 */
public final class VideoEnhanceContract {

    private VideoEnhanceContract() {
    }

    /** MQ tag（= generation_jobs.type = JobType.VIDEO_ENHANCE）；值单处定义在 {@link GenerationMqRouteEnum#VIDEO_ENHANCE}。 */
    public static final String TAG = GenerationMqRouteEnum.VIDEO_ENHANCE.tag();

    /** 任务来源值：唯一创建入口是画布视频卡工具条「HD」单按钮，claim SQL 的 source 白名单仅含本值。 */
    public static final String SOURCE = "video_enhance";

    // ========== input 冻结键名（三键恒在、值恒为合法枚举，创建时定死，重试原样沿用） ==========
    // provider_credential 是业务键之上的基础设施键（创建侧冻结落库，同 VideoSubtitleEraseContract 口径）。

    /** 源素材身份（被增强的视频 Asset id）。 */
    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    /** 目标节点身份（画布 HD 高清卡 node id；HD 高清是进入即建草稿卡（ADR-0105 建卡口径照抄
     *  图片高清放大），node id 由前端生成传入；worker 不消费画布拓扑）。 */
    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    /** 目标分辨率（本仓产品语义键名，出站同名同值透传官方 resolution 参数）。 */
    public static final String INPUT_KEY_RESOLUTION = "resolution";

    // ========== 目标分辨率枚举（文档出处：官方 PDF Body 参数 resolution 节——可选值
    //            720p（默认值）/ 1080p / 2k / 4k） ==========

    /** 目标分辨率三值（API 原生值；**本仓暴露 1080p / 2k / 4k 三档，720p 被产品裁掉不暴露**
     *  ——ADR-0105：产品语义为「高清」，默认 720P 名不副实；出站原样透传，非法值（含 720p）
     *  在创建入口明确拒绝）。 */
    public static final List<String> SUPPORTED_RESOLUTIONS = List.of("1080p", "2k", "4k");

    /** 缺省目标分辨率 1080p（产品口径 ADR-0105「默认 1080P」——**不是官方默认 720p**）。 */
    public static final String DEFAULT_RESOLUTION = "1080p";

    // ========== 网关对客端点路径（IKH67T：网关路由 ≠ 火山上游路径，混用即 404 Invalid URL） ==========

    /** 网关异步提交路由：POST {SUBMIT_PATH}（网关按路径末段决定工具）。火山上游侧对应
     *  POST /api/v1/tools/enhance-video-generative（官方 PDF「1. 提交画质增强（大模型版）
     *  任务 API」节逐字），由网关内部转发，本仓不直连上游。 */
    public static final String SUBMIT_PATH = "/v1/mediakit/enhance-video-generative";

    /** 网关异步任务查询路由前缀（拼 taskId）：GET {POLL_PATH_PREFIX}{task_id}。三个 MediaKit
     *  异步工具共用同一条查询路由，路径**不含 async 段**。 */
    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

    // ========== 出站固定参数（单处定义，出站请求处引用；服务端常量不从前端传入——ADR-0105） ==========

    /** 码率档位固定 medium（文档出处：官方 PDF Body 参数 bitrate_level 节——low / medium（推荐）/
     *  high，默认 medium）。fps 同口径**不传**（官方：未指定时输出保持与原始片源一致的帧率）——
     *  无键即无值，故 fps 不设常量。 */
    public static final String BITRATE_LEVEL = "medium";

    /** 目标分辨率档位 → 输出短边像素（文档出处：官方 PDF 附录「码率参考表」分辨率档位行——
     *  1080p / 2K / 4K 行按行业口径短边 1080 / 1440 / 2160）。官方 result 只返回 resolution
     *  档位字符串、不返回输出宽高像素——worker 按档位短边 + 源宽高比推导输出宽高入库
     *  （assets 无 fps / resolution 列，帧率与档位字符串落 generation_job_logs payload）；
     *  推导值同时支撑前端链式 HD 置灰判断（输出 2K/4K 卡短边超 1080 输入上限即置灰，
     *  ADR-0105）。仅 worker 消费，不进 TS 契约（无跨进程字段）。 */
    public static final java.util.Map<String, Integer> RESOLUTION_SHORT_SIDE_PX = java.util.Map.of(
            "1080p", 1080,
            "2k", 1440,
            "4k", 2160);

    // ========== 输入限制（文档出处：官方 PDF video_url 参数「输入视频限制」节——「最高支持
    //            1080p。具体规格要求：短边范围 [360,1080]、长边范围 [360,1920]」；backend 复核
    //            + web 预检同源；宽高缺失的存量放行，交供应商按官方门槛拒；仅 SDR 无前置元数据，
    //            由任务失败口径兜底） ==========

    /** 短边下限（px；取宽高较小者为短边）。 */
    public static final int MIN_INPUT_SHORT_SIDE_PX = 360;

    /** 短边上限（px）。 */
    public static final int MAX_INPUT_SHORT_SIDE_PX = 1080;

    /** 长边下限（px；短边下限已蕴含，常量仅承载官方口径完整性）。 */
    public static final int MIN_INPUT_LONG_SIDE_PX = 360;

    /** 长边上限（px；取宽高较大者为长边，竖屏 1080x1920 合法）。 */
    public static final int MAX_INPUT_LONG_SIDE_PX = 1920;

    // 格式面：官方支持 mp4 / flv / ts / avi / mov / wmv / mkv 等主流视频格式（开放式列举），
    // 不做格式预检白名单（我方上传面 video/* 全部在官方支持面内）——口径单源在 TS 契约注释。

    // ========== 错误码（数值 1045 见 error-codes.ts ERROR_VIDEO_ENHANCE_FAILED；
    //            1044 已由音视频分离占用） ==========

    /** 执行兜底失败码：网关分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 /
     *  提交超时 provider_timeout 1012）之外的火山任务 failed（含 SDR 限制、短边/长边超限等
     *  供应商侧官方门槛拒绝）与结果下载转存失败统一归并本码，无 worker 级自动重试，
     *  上游可读原因随 message 透传前端投影。 */
    public static final String ERROR_VIDEO_ENHANCE_FAILED = "video_enhance_failed";
}
