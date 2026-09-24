package com.bluewhale.worker.domain.contract;

import java.util.List;

/**
 * 视频插帧（video_frame_interpolation，火山 MediaKit video-frame-interpolation）跨进程任务契约常量
 * （IKHLK3，父需求 IKHLES 画布视频插帧；入口形态与帧率三档口径 = ADR-0113）。
 * <p>
 * 变化轴：跨进程字段（TS 侧权威 = backend/libs/contracts/video-frame-interpolation.ts；防漂移断言 =
 * backend/libs/contracts/video-frame-interpolation.test.ts 直接读本文件源码文本对账，两处任一侧改动即红）。
 * <p>
 * MQ tag 的字面量已上移到 {@link GenerationMqRouteEnum}（本类的 {@link #TAG} 只做转发）：
 * 防漂移断言若要继续按源码文本对账 tag，须改读该枚举文件。
 * 契约先行红线：字段名在本类定死后创建入口（IKHLK3）与执行面（消费者、处理器、领取 SQL、
 * 终态收口——由 IKHLKJ 按附录 C 触点注册）一律引用本类，禁止另行发明字面量。
 * <p>
 * 供应商接口 = 火山引擎 AI MediaKit「视频插帧」（**异步任务**：提交返 task_id，轮询查询取
 * result.video_url（24h 临时链接）/ duration / resolution / fps），火山上游
 * POST /api/v1/tools/video-frame-interpolation；本仓经 new-api 网关调用，网关**对客**路径单源在
 * 下方 SUBMIT_PATH / POLL_PATH_PREFIX（参数名以官方参数级 API 参考页为准，出处逐条标注在常量注释，
 * 禁止引用二手信息；资料未明确的字段显式标注「官方未明确」——核对结论落盘
 * docs/specs/2026-09-21-video-frame-interpolation-mediakit.md）。
 */
public final class VideoFrameInterpolationContract {

    private VideoFrameInterpolationContract() {
    }

    /** MQ tag（= generation_jobs.type = JobType.VIDEO_FRAME_INTERPOLATION）；值单处定义在
     *  {@link GenerationMqRouteEnum#VIDEO_FRAME_INTERPOLATION}。 */
    public static final String TAG = GenerationMqRouteEnum.VIDEO_FRAME_INTERPOLATION.tag();

    /** 任务来源值：唯一创建入口是画布视频卡「高清 ▾」下拉第二项「插帧」，claim SQL 的 source
     *  白名单仅含本值。 */
    public static final String SOURCE = "video_frame_interpolation";

    // ========== input 冻结键名（三键恒在、值恒为合法帧率，创建时定死，重试原样沿用） ==========
    // provider_credential 是业务键之上的基础设施键（创建侧冻结落库，同 VideoEnhanceContract 口径）。

    /** 源素材身份（被插帧的视频 Asset id）。 */
    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    /** 目标节点身份（画布插帧卡 node id；插帧是进入即建草稿卡（ADR-0113 建卡口径照抄 HD 高清），
     *  node id 由前端生成传入；worker 不消费画布拓扑）。 */
    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    /** 目标帧率（本仓产品语义键名，出站同名同值透传官方整型 fps 参数）。 */
    public static final String INPUT_KEY_FPS = "fps";

    // ========== 目标帧率三档（文档出处：官方参数级 API 参考页 Body 参数 fps 节——「目标输出帧率，
     //            单位为 fps。取值范围为 [15, 120]」） ==========

    /** 目标帧率三档（**本仓只暴露产品三档 30 / 60 / 120**，ADR-0113：Seedance 24fps 生成视频提到
     *  60 为主场景、30 档留给低帧率上传视频、120 满足高刷；三档是官方 [15,120] 的真子集）。
     *  出站原样透传官方 fps 参数，枚举外值在创建入口明确拒绝。 */
    public static final List<Integer> SUPPORTED_FPS = List.of(30, 60, 120);

    /** 缺省目标帧率 60（ADR-0113「帧率三档 30/60/120，默认 60」；fps 键缺省时创建侧补本值——
     *  与 HD 高清 resolution 必填口径不同）。 */
    public static final int DEFAULT_FPS = 60;

    // ========== 网关对客端点路径（video_enhance 的 IKH67T：网关路由 ≠ 火山上游路径，混用即 404 Invalid URL） ==========

    /** 网关异步提交路由：POST {SUBMIT_PATH}（网关按路径末段决定工具）。火山上游侧对应官方参数级 API
     *  参考页逐字 POST https://mediakit.cn-beijing.volces.com/api/v1/tools/video-frame-interpolation，
     *  由网关内部转发，本仓不直连上游。**本常量为假设值**（按家族规律「/v1/mediakit/ + 与上游同名的
     *  工具段」取名），随网关票 IKHLLB 对齐后定稿——TS 契约是单源，定稿只改 TS 契约常量与本镜像常量两处。 */
    public static final String SUBMIT_PATH = "/v1/mediakit/video-frame-interpolation";

    /** 网关异步任务查询路由前缀（拼 taskId）：GET {POLL_PATH_PREFIX}{task_id}。MediaKit 异步工具
     *  共用同一条查询路由，路径**不含 async 段**（官方查询 API 为统一入口：「支持查询 AI MediaKit
     *  服务下所有类型的异步任务」）。 */
    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

    // ========== 官方 result 字段名（文档出处：官方参数级 API 参考页「异步任务结果」表——video_url
    //            （24h 临时下载链接，须及时转存）/ duration（秒，用于计量计费）/ resolution（输出档位，
    //            插帧不改变分辨率、跟随原片）/ fps（与提交时目标帧率一致）） ==========

    /** 插帧后视频文件地址（转存来源）。 */
    public static final String RESULT_KEY_VIDEO_URL = "video_url";

    /** 输出视频时长（秒）。 */
    public static final String RESULT_KEY_DURATION = "duration";

    /** 输出视频分辨率档位。 */
    public static final String RESULT_KEY_RESOLUTION = "resolution";

    /** 输出帧率。 */
    public static final String RESULT_KEY_FPS = "fps";

    // 时间/文件大小限制面：官方指南与参数级 API 参考页**均未给出时长上限与文件大小上限的数值**
    // （仅错误码页 DownloadFileError 提到「文件大小是否超出限制」而无具体值）——官方未明确，故不设
    // 门槛常量、不做前置拦截，交上游按官方限制拒（口径单源在 TS 契约注释）。

    // ========== 错误码（数值 1049 见 error-codes.ts ERROR_VIDEO_FRAME_INTERPOLATION_FAILED；
    //            1045-1048 已由 HD 高清 / 场景切分 / 人声背景分离 / 音频截取占用） ==========

    /** 执行兜底失败码：网关分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 /
     *  提交超时 provider_timeout 1012）之外的火山任务 failed（含入口未前置判定的官方门槛拒绝：
     *  目标帧率越界、输入规格不符、文件大小或时长超上游限制）与结果下载转存失败统一归并本码，
     *  无 worker 级自动重试，上游可读原因随 message 透传前端投影。入队失败不走本码（落 enqueue_failed）。 */
    public static final String ERROR_VIDEO_FRAME_INTERPOLATION_FAILED = "video_frame_interpolation_failed";
}
