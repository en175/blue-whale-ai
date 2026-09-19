package com.bluewhale.worker.domain.entity;

import java.util.Map;

/**
 * 视频智能去字幕（video_subtitle_erase）跨进程任务契约常量（迁移契约 §17 / IKGZ7Z）。
 * <p>
 * 变化轴：跨进程字段（TS 侧权威 = backend/libs/contracts/video-subtitle-erase.ts；防漂移断言 =
 * backend/libs/contracts/video-subtitle-erase.test.ts 直接读本文件源码文本对账，两处任一侧改动即红）。
 * <p>
 * MQ tag 的字面量已上移到 {@link GenerationMqRoute}（本类的 {@link #TAG} 只做转发）：
 * 防漂移断言若要继续按源码文本对账 tag，须改读该枚举文件。
 * 契约先行红线：字段名在本类定死后 Z80（创建入口）/ Z81（消费者、处理器、领取 SQL、
 * 终态收口）一律引用本类，禁止另行发明字面量。
 * <p>
 * 供应商接口 = 火山引擎 AI MediaKit「提交字幕擦除（精细化版）任务 API」（**异步任务**：
 * 提交返 task_id，轮询查询取结果——家族内首个异步工具，区别于高清/擦除/抠图的同步路由），
 * POST /api/v1/tools/erase-video-subtitle-pro；本仓经 new-api 网关调用（对客模型名
 * mediakit-erase-video-subtitle-pro；参数名以官方 PDF 为准，出处逐条标注在常量注释）。
 * <p>
 * 结果回填约定（§17.5）：成功 = 轮询至 completed 后立即下载结果视频（火山 URL 仅 24h 有效）
 * → 落 TOS 公开读 → 建 Asset（type=video / source='generated' / generation_job_id）→ 终态
 * succeeded，前端按 input.target_node_id 回填去字幕结果卡（源卡不动，结果卡可再次去字幕）；
 * 失败 = 终态 failed + 既有错误码投影（兜底 video_subtitle_erase_failed），无自动重试，
 * 用户在结果卡手动重试并沿用冻结 input。
 */
public final class VideoSubtitleEraseContract {

    private VideoSubtitleEraseContract() {
    }

    /** MQ tag（= generation_jobs.type = JobType.VIDEO_SUBTITLE_ERASE）；值单处定义在 {@link GenerationMqRoute#VIDEO_SUBTITLE_ERASE}。 */
    public static final String TAG = GenerationMqRoute.VIDEO_SUBTITLE_ERASE.tag();

    /** 任务来源值：唯一创建入口是画布视频卡工具条「智能去字幕」，claim SQL 的 source 白名单仅含本值。 */
    public static final String SOURCE = "video_subtitle_erase";

    // ========== input 冻结键名（四键恒在、值恒为合法枚举；重试原样沿用） ==========
    // provider_credential 是业务键之上的基础设施键（创建侧冻结落库，同 ImageEraseContract 口径）。

    /** 源素材身份（被去字幕的视频 Asset id）。 */
    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    /** 目标节点身份（画布去字幕结果卡 node id；去字幕是发送时才建卡，node id 由前端生成传入；
     *  worker 不消费画布拓扑）。 */
    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    /** 检测模式（本仓产品语义值，出站经 MODE 映射官方 mode 参数）。 */
    public static final String INPUT_KEY_DETECT_MODE = "detect_mode";

    /** 归一化框列表（空数组 = 不拉框走智能默认，出站不传 erase_ratio_location 键；
     *  非空出站映射官方 erase_ratio_location 数组）。 */
    public static final String INPUT_KEY_ERASE_BOXES = "erase_boxes";

    // ========== 擦除框 Location 对象键名（官方 PDF「Location 对象」节；归一化坐标系，
    //            画面左上角为原点 (0,0)、右下角为 (1,1)，左上/右下两顶点确定矩形，出站原样透传） ==========

    /** 框选区域左上角 X 偏移比例，[0,1]。 */
    public static final String BOX_KEY_TOP_LEFT_X = "top_left_x";

    /** 框选区域左上角 Y 偏移比例，[0,1]。 */
    public static final String BOX_KEY_TOP_LEFT_Y = "top_left_y";

    /** 框选区域右下角 X 偏移比例，[0,1]。 */
    public static final String BOX_KEY_BOTTOM_RIGHT_X = "bottom_right_x";

    /** 框选区域右下角 Y 偏移比例，[0,1]。 */
    public static final String BOX_KEY_BOTTOM_RIGHT_Y = "bottom_right_y";

    // ========== 检测模式枚举（本仓产品语义命名，非官方参数值；本期两值） ==========

    /** 智能字幕模式：OCR 检测为字幕的文本，默认仅处理画面下半部分（下方 50%）；配置擦除框后
     *  实际生效区域 = 框与下半区域的交集。 */
    public static final String DETECT_MODE_SUBTITLE_SMART = "subtitle_smart";

    /** 全画面文字模式：擦除 OCR 检测为字幕及其他类型文本（如人名、地名），不含场景文字
     *  （如牌匾），对整个画面做文本检测——擦顶部字幕的途径；配置擦除框后仅在框内执行。 */
    public static final String DETECT_MODE_TEXT_FULL = "text_full";

    /** 检测模式 → 官方 mode 参数映射（单处定义，出站请求处换算；文档出处：官方 PDF Body 参数
     *  mode 节——Subtitle 为默认值、Text 为全画面文本检测）。 */
    public static final Map<String, String> MODE = Map.of(
            DETECT_MODE_SUBTITLE_SMART, "Subtitle",
            DETECT_MODE_TEXT_FULL, "Text");

    /** 擦除框数量上限（官方 PDF erase_ratio_location 参数节「最多支持 20 个擦除框」）。 */
    public static final int MAX_BOXES = 20;

    // ========== 出站固定参数（单处定义，出站请求处引用；服务端常量不从前端传入） ==========

    /** 擦除算法版本固定 v5（官方默认 v4；v5 优化 AIGC 视频擦除后闪烁、带阴影字幕、误擦与速度）。 */
    public static final String MODEL_VERSION = "v5";

    /** 输出编码模式固定 Quality（官方默认；画质优先较高码率，Size 大小优先为范围外）。 */
    public static final String OUTPUT_ENCODE_MODE = "Quality";

    // ========== 输入限制（官方 PDF video_url 参数节 + 产品口径；backend 复核 + web 预检同源；
    //            宽高/时长缺失的存量放行，交供应商按官方门槛拒） ==========

    /** 短边上限（px；官方仅「最高支持 2K」无像素值，按图片系 IKGOSZ 修正后口径取 2K 档）。 */
    public static final int MAX_INPUT_SHORT_SIDE_PX = 1440;

    /** 长边上限（px；取宽高较大者为长边，竖屏合法）。 */
    public static final int MAX_INPUT_LONG_SIDE_PX = 2560;

    /** 时长上限（ms；10 分钟**产品上限**——官方 API 无视频时长上限）。 */
    public static final long MAX_INPUT_DURATION_MS = 10L * 60 * 1000;

    // 格式面：官方支持 mp4 / flv / ts / avi / mov / wmv / mkv 等主流格式（开放式列举），
    // 不做格式预检白名单（我方上传面 video/* 全部在官方支持面内）——口径单源在 TS 契约注释。

    // ========== 错误码（数值 1043 见 error-codes.ts ERROR_VIDEO_SUBTITLE_ERASE_FAILED；
    //            1039-1042 已由高清/擦除/扩图/抠图占用） ==========

    /** 执行兜底失败码：调用失败 / 超时 / 供应商错误统一归并（异步任务轮询失败终态），无 worker 级自动重试。 */
    public static final String ERROR_VIDEO_SUBTITLE_ERASE_FAILED = "video_subtitle_erase_failed";
}
