package com.bluewhale.worker.domain.contract;

import java.util.List;
import java.util.Map;

/**
 * 视频场景切分（video_scene_split，火山 MediaKit segment-scenes）跨进程任务契约常量
 * （IKH8BH，父规格 IKH86V；一对多逐段扇出，设计定案 ADR-0108）。
 * <p>
 * 变化轴：跨进程字段（TS 侧权威 = backend/libs/contracts/video-scene-split.ts；防漂移断言 =
 * backend/libs/contracts/video-scene-split.test.ts 直接读本文件源码文本对账，两处任一侧改动即红）。
 * <p>
 * MQ tag 的字面量已上移到 {@link GenerationMqRouteEnum}（本类的 {@link #TAG} 只做转发）：
 * 防漂移断言若要继续按源码文本对账 tag，须改读该枚举文件。
 * 契约先行红线：字段名在本类定死后创建入口与执行面（消费者、处理器、领取 SQL、终态收口
 * ——worker 票按附录 C 触点注册）一律引用本类，禁止另行发明字面量。
 * <p>
 * 供应商接口 = 火山引擎 AI MediaKit「提交场景切分任务 API」（**异步任务**：提交返 task_id，
 * 轮询查询取 result.duration + result.segments[]〔start_time / end_time / segment_video_url，
 * 切片链接仅 24h 有效〕），火山上游 POST /api/v1/tools/segment-scenes；本仓经 new-api 网关
 * 调用（对客模型名候选 mediakit-segment-scenes，常量单源在下方 {@link #MODEL_NAME}；
 * 参数名以官方 PDF 为准，出处逐条标注在常量注释，禁止引用二手信息）。
 * <p>
 * 结果回填约定：成功 = 轮询至 completed 后逐段下载切片（火山 URL 仅 24h 有效）→ 落 TOS
 * 公开读 → 每段建 Asset（type='video' / source='generated' / generation_job_id）→ 终态
 * succeeded，段序 / 起止秒 / 段资产引用 / 总时长按 {@link #RESULT_KEY_DURATION} 一节的
 * result 契约跨进程回传，前端完成事件驱动移除任务占位卡、按段扇出 N 张段卡（1 段不特判）；
 * 失败 = 终态 failed + 既有错误码投影（兜底 {@link #ERROR_VIDEO_SCENE_SPLIT_FAILED}），
 * 无自动重试，用户在任务占位卡手动重试并沿用冻结 input。
 */
public final class VideoSceneSplitContract {

    private VideoSceneSplitContract() {
    }

    /** MQ tag（= generation_jobs.type = JobType.VIDEO_SCENE_SPLIT）；值单处定义在 {@link GenerationMqRouteEnum#VIDEO_SCENE_SPLIT}。 */
    public static final String TAG = GenerationMqRouteEnum.VIDEO_SCENE_SPLIT.tag();

    /** 任务来源值：唯一创建入口是画布视频卡工具条「场景切分」单按钮，claim SQL 的 source 白名单仅含本值。 */
    public static final String SOURCE = "video_scene_split";

    // ========== input 冻结键名（三键恒在、粒度恒为合法枚举，创建时定死，重试原样沿用）==========
    // provider_credential（请求头冻结）与 client_token（提交幂等键，消费方是 command_idempotency
    // 表）是业务键之上的基础设施键，创建侧处理，不进 input（同 VideoEnhanceContract 口径）。

    /** 源素材身份（被切分的视频 Asset id）。 */
    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    /** 画布任务占位卡节点绑定（IKH8BO 扩展；前端本地建占位卡后随请求传入，前端按本键把
     *  job 映射到占位卡——画布单写入方架构下后端不写 nodes_json，绑定随任务 input 落库）。 */
    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    /** 切分粒度档（本仓产品语义值，出站经 SEGMENT_THRESHOLD 映射官方 segment_threshold 数值）。 */
    public static final String INPUT_KEY_GRANULARITY = "granularity";

    // ========== 切分粒度枚举（本仓产品语义命名，非官方参数值——官方只有数值 segment_threshold，
    //            无档位概念；三档是产品对 threshold 的收敛） ==========

    /** 粒度三值（细 / 标准 / 粗；面板三档分段恒有选中值，创建入口两键必填）。 */
    public static final List<String> SUPPORTED_GRANULARITIES = List.of("fine", "standard", "coarse");

    /** 缺省粒度档 standard（产品口径「默认标准」= 官方推荐经验值 10；粒度不跨会话记忆，
     *  每次进入编辑态重置为本值——前端面板默认档与本同源）。 */
    public static final String DEFAULT_GRANULARITY = "standard";

    /** 粒度档 → 官方 segment_threshold 数值映射（单处定义，出站请求处换算；文档出处：官方 PDF
     *  「调整切分粒度」节 segment_threshold——场景切分敏感度阈值，范围 [0, 100)，推荐经验值 10，
     *  值越低切得越细碎、越高越粗略）。三档数值为**契约初值**：后续按真实切分效果微调时只改
     *  本映射与映射测试（父规格定案）。出站口径：只传 segment_threshold——min_duration（默认
     *  3s）/ max_duration（默认 30s）/ enable_clip_fade（默认 false）/ return_segment_videos
     *  （默认 true）一律不传，走服务端默认（规格 Implementation Decisions「高级参数不暴露」）。 */
    public static final Map<String, Integer> SEGMENT_THRESHOLD = Map.of(
            "fine", 5,
            "standard", 10,
            "coarse", 20);

    // ========== 网关对客端点路径（IKH67T：网关路由 ≠ 火山上游路径，混用即 404 Invalid URL） ==========

    /** 网关异步提交路由：POST {SUBMIT_PATH}（网关按路径末段决定工具）。火山上游侧对应
     *  POST /api/v1/tools/segment-scenes（官方 PDF「第 1 步：提交任务」节逐字），由网关
     *  内部转发，本仓不直连上游。 */
    public static final String SUBMIT_PATH = "/v1/mediakit/segment-scenes";

    /** 网关异步任务查询路由前缀（拼 taskId）：GET {POLL_PATH_PREFIX}{task_id}。四个 MediaKit
     *  异步工具共用同一条查询路由，路径**不含 async 段**；status 枚举 running / completed /
     *  failed，查询窗口 30 天。 */
    public static final String POLL_PATH_PREFIX = "/v1/mediakit/tasks/";

    // ========== 对客模型名（网关按模型名路由 MediaKit 渠道并计次计费，场景切分网关配零价
    //            为上线前置；候选值，最终以网关配置票为准，有出入只改本常量与对账测试） ==========

    /** 对客模型名（与 TS 契约 VIDEO_SCENE_SPLIT_MODEL_NAME 同值；创建入口与出站统一引用，
     *  禁止另行发明字面量）。 */
    public static final String MODEL_NAME = "mediakit-segment-scenes";

    // ========== result 冻结键名（跨进程结果契约——worker 写入、前端扇出消费；官方
    //            result.duration / result.segments[] 的本仓跨进程形态：官方 segment_video_url
    //            是 24h 临时链接不进契约，段资产以自有存储 Asset id 引用） ==========

    /** 视频总时长秒（官方 result.duration，同名同值透传）。 */
    public static final String RESULT_KEY_DURATION = "duration";

    /** 场景段列表（按官方 segments[] 返回顺序排列；恒为数组，1 段与 N 段同构不特判）。 */
    public static final String RESULT_KEY_SEGMENTS = "segments";

    /** 段序（1 起正整数，按官方 segments[] 返回顺序编号；与前端段卡标注「第 N 段」同源）。 */
    public static final String SEGMENT_KEY_INDEX = "segment_index";

    /** 段起始秒（官方 start_time，同名同值透传）。 */
    public static final String SEGMENT_KEY_START_TIME = "start_time";

    /** 段结束秒（官方 end_time，同名同值透传）。 */
    public static final String SEGMENT_KEY_END_TIME = "end_time";

    /** 段资产引用（自有存储段视频 Asset id——worker 逐段下载官方切片转存后建的 Asset；
     *  段卡素材地址指向自有存储，不得直连火山 24h 临时链接，规格故事 23）。 */
    public static final String SEGMENT_KEY_ASSET_ID = "segment_asset_id";

    // ========== 输入限制（文档出处：官方 PDF「参考信息·使用限制与性能」表——「视频时长：
    //            单个视频时长不超过 2 小时」；backend 复核 + web 预检同源；时长数据缺失放行，
    //            由后端按权威数据复核，超限由创建入口拒绝或任务失败口径兜底） ==========

    /** 视频时长上限（ms；官方单视频 2 小时上限）。 */
    public static final long MAX_INPUT_DURATION_MS = 2L * 60 * 60 * 1000;

    // 格式面：官方支持 mp4 / flv / ts / avi / mov / wmv / mkv 等主流视频格式（开放式列举），
    // 不做格式预检白名单（我方上传面 video/* 全部在官方支持面内）——口径单源在 TS 契约注释。

    // ========== 错误码（数值 1046 见 error-codes.ts ERROR_VIDEO_SCENE_SPLIT_FAILED；
    //            1045 已由视频 HD 高清占用） ==========

    /** 执行兜底失败码：网关分类链（额度 1001 / 内容 1018 / 版权 1038 / provider_failed 1011 /
     *  提交超时 provider_timeout 1012）之外的火山任务 failed（error 对象 code / message /
     *  param / type——TaskError / ApiError）与逐段转存失败（任一段失败即整体失败）统一归并
     *  本码，无 worker 级自动重试，上游可读原因随 message 透传前端投影。 */
    public static final String ERROR_VIDEO_SCENE_SPLIT_FAILED = "video_scene_split_failed";
}
