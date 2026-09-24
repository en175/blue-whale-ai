package com.bluewhale.worker.domain.contract;

import java.util.List;
import java.util.Map;

/**
 * 智能抠像（video_matting，火山 MediaKit 双端点人像/绿幕抠像）跨进程任务契约常量
 * （IKHK7F，父规格 IKHJRC；一对一对一产物，设计定案 ADR-0112）。
 * <p>
 * 变化轴：跨进程字段（TS 侧权威 = backend/libs/contracts/video-matting.ts；防漂移断言 =
 * backend/libs/contracts/video-matting.test.ts 直接读本文件源码文本对账，两处任一侧改动即红）。
 * <p>
 * MQ tag 的字面量已上移到 {@link GenerationMqRouteEnum}（本类的 {@link #TAG} 只做转发）：
 * 防漂移断言若要继续按源码文本对账 tag，须改读该枚举文件。
 * 契约先行红线：字段名在本类定死后创建入口与执行面（消费者、处理器、领取 SQL、终态收口
 * ——worker 票按附录 C 触点注册）一律引用本类，禁止另行发明字面量。
 * <p>
 * 供应商接口 = 火山引擎 AI MediaKit「智能处理·视频抠图」官方开发指南 PDF（提交人像
 * POST /api/v1/tools/matte-portrait-video、提交绿幕 POST /api/v1/tools/matte-greenscreen-video，
 * 两工具 API 独立、任务流程完全相同、共用同一个 tasks 查询——**异步任务**：提交返
 * task_id，轮询查询取 result.video_url + result.resolution + result.duration〔产物链接仅
 * 24h 有效〕）；本仓经 new-api 网关调用（对客模型名候选见 {@link #MODEL_NAMES}；
 * 参数名以官方文档为准，出处逐条标注在常量注释，禁止引用二手信息）。
 * <p>
 * 结果回填约定：成功 = 轮询至 completed 后下载产物（火山 URL 仅 24h 有效）→ 落 TOS
 * 公开读 → 建产物 Asset → 终态 succeeded，video_url / resolution / duration 按
 * {@link #RESULT_KEY_VIDEO_URL} 一节的 result 契约跨进程回传，前端完成事件驱动移除任务
 * 占位卡、就地回填普通成品视频卡；失败 = 终态 failed + 既有错误码投影（兜底
 * {@link #ERROR_VIDEO_MATTING_FAILED}），无自动重试，用户在任务占位卡手动重试并沿用冻结 input。
 */
public final class VideoMattingContract {

    private VideoMattingContract() {
    }

    /** MQ tag（= generation_jobs.type = JobType.VIDEO_MATTING）；值单处定义在 {@link GenerationMqRouteEnum#VIDEO_MATTING}。 */
    public static final String TAG = GenerationMqRouteEnum.VIDEO_MATTING.tag();

    /** 任务来源值：唯一创建入口是画布视频卡工具条「智能抠像 ▾」下拉（人像/绿幕两项直选），
     *  claim SQL 的 source 白名单仅含本值。 */
    public static final String SOURCE = "video_matting";

    // ========== input 冻结键名（IKHK99 worker 执行面按家族先例扩展——键名跨进程单源在
    //            本类，创建入口（IKHK98）与 worker 解析一律引用本组常量，禁止另行发明字面量；
    //            业务键恒在、值恒为合法枚举，创建时定死，重试原样沿用。provider_credential
    //            是业务键之上的基础设施键（创建侧冻结落库，同 VideoSubtitleEraseContract 口径）。

    /** 源素材身份（被抠像的视频 Asset id）。 */
    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    /** 目标节点身份（画布任务占位卡 node id，前端生成传入；worker 不消费画布拓扑）。 */
    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    /** 抠像模式（portrait / greenscreen；**不进出站提交参数**——选择端点即选择模式，
     *  worker 按它经 {@link #SUBMIT_PATHS} / {@link #MODEL_NAMES} 分流，值域见
     *  {@link #SUPPORTED_MODES}）。 */
    public static final String INPUT_KEY_MODE = "mode";

    /** 输出格式（WEBM / MP4，值域见 {@link #SUPPORTED_FORMATS}；创建侧补缺省后冻结，
     *  出站同名同值透传官方 format 参数）。 */
    public static final String INPUT_KEY_FORMAT = "format";

    /** MP4 纯色背景色（white / black / green，值域见 {@link #SUPPORTED_BACKGROUND_COLORS}；
     *  仅 format=MP4 时在冻结 input 中（创建侧补缺省 white 后冻结），出站仅此时显式携带。 */
    public static final String INPUT_KEY_BACKGROUND_COLOR = "background_color";

    // ========== 抠像模式枚举（本仓产品语义命名，双模式与官方两个工具端点一一对应） ==========
    // 模式不进提交参数（选择端点即选择模式）；模式选择前置在入口下拉直选，不跨会话记忆（ADR-0112）。

    /** 模式两值（portrait 人像 / greenscreen 绿幕）。 */
    public static final List<String> SUPPORTED_MODES = List.of("portrait", "greenscreen");

    // ========== 网关对客端点路径（IKH67T：网关路由 ≠ 火山上游路径，混用即 404 Invalid URL；
    //            双端点提交路径集中此一处——最终以网关配置票 IKHK9O 定稿回填） ==========

    /** 模式 → 网关异步提交路由映射（出站按模式取值）：portrait → POST {path}
     *  火山上游对应 POST /api/v1/tools/matte-portrait-video，greenscreen → POST {path}
     *  对应 POST /api/v1/tools/matte-greenscreen-video（官方文档逐字），由网关内部转发，
     *  本仓不直连上游；候选值按家族 segment-scenes → /v1/mediakit/{tool} 规律推导。 */
    public static final Map<String, String> SUBMIT_PATHS = Map.of(
            "portrait", "/v1/mediakit/matte-portrait-video",
            "greenscreen", "/v1/mediakit/matte-greenscreen-video");

    /** 网关异步任务查询路由前缀（拼 taskId）：GET {POLL_PATH_PREFIX}{task_id}。MediaKit
     *  异步工具家族共用同一条查询路由，路径**不含 async 段**；status 枚举 running /
     *  completed / failed，查询窗口 30 天（client 按 toLowerCase 归一容错解析）。 */
    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

    // ========== 对客模型名（网关按模型名路由 MediaKit 渠道并计次计费，抠像双端点网关配零价
    //            为上线前置；候选值，最终以网关配置票 IKHK9O 为准，有出入只改本映射与对账测试） ==========

    /** 模式 → 对客模型名映射（与 TS 契约 VIDEO_MATTING_MODEL_NAMES 同值；创建入口与
     *  出站统一引用，禁止另行发明字面量；双端点各自命名，是否合一由网关定）。 */
    public static final Map<String, String> MODEL_NAMES = Map.of(
            "portrait", "mediakit-matte-portrait-video",
            "greenscreen", "mediakit-matte-greenscreen-video");

    // ========== 输出格式与背景色（文档出处：官方 PDF「进阶使用·选择输出格式与背景颜色」节） ==========

    /** 格式两值 WEBM（透明背景，默认）/ MP4（纯色背景）。官方另有 MOV（透明 ProRes 4444）
     *  但本仓不暴露——Chrome 无法预览（ADR-0112 否决项），面向 AE/PR 诉求出现后随时可加档。 */
    public static final List<String> SUPPORTED_FORMATS = List.of("WEBM", "MP4");
    /** 缺省格式 WEBM（产品口径「默认透明」= 官方 format 默认值；创建请求体未传时补本值后冻结）。 */
    public static final String DEFAULT_FORMAT = "WEBM";

    /** MP4 纯色档（值域同 SUPPORTED_FORMATS）：背景色出站的唯一条件判断按本常量取，
     *  客户端禁散落 "MP4" 字面量（契约单源口径）。 */
    public static final String FORMAT_MP4 = "MP4";

    /** MP4 纯色背景色三值（官方 background_color 参数）。 */
    public static final List<String> SUPPORTED_BACKGROUND_COLORS = List.of("white", "black", "green");

    /** 缺省背景色 white（不采用官方两工具各异的默认——绿幕 black / 人像 green 为绿幕合成
     *  场景口径，与电商白底主流诉求相悖〔ADR-0112〕；出站显式传防歧义。仅 format=MP4 时
     *  有意义，WEBM 透明不接受背景色——创建入口按此校验）。 */
    public static final String DEFAULT_BACKGROUND_COLOR = "white";

    // ========== 提交参数键名（两模式共用同一组官方 body 参数；画布创建入口的 input 冻结形态
    //            〔source_asset_id / target_node_id / mode / format / background_color〕已由
    //            IKHK98 创建入口落到 INPUT_KEY_* 常量，与本组同源） ==========

    /** 待处理视频的公网可访问 URL（worker 出站前由源 Asset url 解析，Asset url 落库即 public-read）。 */
    public static final String SUBMIT_KEY_VIDEO_URL = "video_url";

    /** 输出格式（WEBM / MP4；缺省由创建侧补 DEFAULT_FORMAT 后冻结）。 */
    public static final String SUBMIT_KEY_FORMAT = "format";

    /** MP4 纯色背景色（white / black / green；仅 format=MP4 时出站，显式传防两工具默认底色歧义）。 */
    public static final String SUBMIT_KEY_BACKGROUND_COLOR = "background_color";

    // ========== result 冻结键名（跨进程结果契约——worker 写入、前端成品卡回填消费；官方
    //            查询 result 的本仓跨进程形态：video_url 为转存自有存储后的公开读地址，
    //            官方 24h 临时链接不跨进程落库，即收即转存 TOS） ==========

    /** 抠像结果产物地址（自有存储公开读 URL；worker 下载官方产物转存后回填）。 */
    public static final String RESULT_KEY_VIDEO_URL = "video_url";

    /** 分辨率档位（官方 result.resolution，字符串如 "1080p"，同名同值透传）。 */
    public static final String RESULT_KEY_RESOLUTION = "resolution";

    /** 视频时长秒（官方 result.duration，同名同值透传）。 */
    public static final String RESULT_KEY_DURATION = "duration";

    // ========== 使用限制口径（文档出处：官方 PDF「参考信息」表——支持 mp4 / flv / ts / avi /
    //            mov / mkv 等主流格式〔开放式列举〕，建议单输入 ≤10 GB，处理耗时通常为视频
    //            时长 1~3 倍）：不做格式预检白名单与大小预检（家族口径），口径单源在 TS 契约注释；
    //            时长门槛 10 分钟已定值于 TS 契约 VIDEO_MATTING_MAX_DURATION_MS（IKHK98 服务端
    //            复核同源），轮询窗口上限 720 次由执行票 IKHK99 定值 ==========

    /**
     * 成品转存上限 1 GiB（IKHJRC 审查修复 P2）。
     * <p>
     * 为什么不能吃家族的 200MB 常量（{@code TosVideoMediaRelay.MAX_VIDEO_BYTES}）：那是**结果
     * 整段进堆**的字节数组路径上限，与堆绑死；本工具成品是 10 分钟档重编码视频（WEBM 透明还能
     * 因 alpha 通道大于源），而创建入口的源素材上限本身就是 200MB（{@code MAX_BYTES.video}，
     * 上传口与自家生成产物同值）——成品超过同值的概率不低，撞上即本地转存失败、原参数重试
     * 也救不回来，是能力缺口而非产品限制。
     * <p>
     * 取值口径：输入上限 200MB ⇒ 10 分钟档源码率 ≤2.7Mbps，成品按主流编码 1080p ≤8Mbps 估
     * ≈600MB，1 GiB 给 ≈1.7 倍余量；同时该值只作转存判据（**不是创建门槛**，前端与创建入口
     * 均不做大小预检——协议常量不因此改变），超限归 1050 兜底失败、错误信息带 MB 值。
     * 消费方 = {@code TosVideoMediaRelay.persistStreaming}（流式，与堆解绑）。
     */
    public static final long MAX_RESULT_BYTES = 1024L * 1024 * 1024;

    // ========== 错误码（数值 1050 见 error-codes.ts ERROR_VIDEO_MATTING_FAILED；
    //            1048 已由音频截取占用） ==========

    /** 执行兜底失败码：网关分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 /
     *  提交超时 provider_timeout 1012）之外的火山任务 failed（error 对象 code / message /
     *  param / type——TaskError / ApiError）与转存失败（官方 24h 临时链接 → 自家 TOS）统一
     *  归并本码（双模式共享一码、错误信息透传区分——segment-scenes 单码家族口径），无 worker
     *  级自动重试，上游可读原因随 message 透传前端投影。 */
    public static final String ERROR_VIDEO_MATTING_FAILED = "video_matting_failed";
}
