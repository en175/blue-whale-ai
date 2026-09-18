package com.bluewhale.worker.domain.entity;

import java.util.List;

/**
 * 图片擦除（image_erase）跨进程任务契约常量（契约 §15 / IKGOT3）。
 * <p>
 * 变化轴：跨进程字段（TS 侧权威 = backend/libs/contracts/image-erase.ts；防漂移断言 =
 * backend/libs/contracts/image-erase.test.ts 直接读本文件源码文本对账，两处任一侧改动即红）。
 * <p>
 * MQ tag 的字面量已上移到 {@link GenerationMqRoute}（本类的 {@link #TAG} 只做转发）：
 * 防漂移断言若要继续按源码文本对账 tag，须改读该枚举文件。
 * 契约先行红线：字段名在本类定死后 IKGOT4（创建入口）/ IKGOT6（消费者、处理器、领取 SQL、
 * 终态收口）一律引用本类，禁止另行发明字面量。
 * <p>
 * 供应商接口 = 火山引擎 AI MediaKit「提交图像擦除修复任务 API」（同步），本仓经 new-api 网关
 * 调用（对客模型名 mediakit-erase-image；参数名以官方 PDF 为准，出处逐条标注在常量注释）。
 * <p>
 * 结果回填约定（§15.5）：成功 = 下载结果图（火山 URL 仅 24h 有效，响应后立即转存）→ 落 TOS
 * 公开读 → 建 Asset（type=image / source='generated' / generation_job_id）→ 终态 succeeded，
 * 前端按 input.target_node_id 回填擦除结果卡；失败 = 终态 failed + 既有错误码投影
 * （兜底 image_erase_failed），无自动重试，用户在结果卡手动重试并沿用冻结 input。
 */
public final class ImageEraseContract {

    private ImageEraseContract() {
    }

    /** MQ tag（= generation_jobs.type = JobType.IMAGE_ERASE）；值单处定义在 {@link GenerationMqRoute#IMAGE_ERASE}。 */
    public static final String TAG = GenerationMqRoute.IMAGE_ERASE.tag();

    /** 任务来源值：唯一创建入口是画布图片卡工具条「擦除」，claim SQL 的 source 白名单仅含本值。 */
    public static final String SOURCE = "image_erase";

    // ========== input 冻结键名（业务键按场景三/四键恒在、值恒为合法枚举；重试原样沿用） ==========
    // provider_credential 是业务键之上的基础设施键（创建侧冻结落库，同 ImageEnhanceContract 口径）。

    /** 源素材身份（被擦除的图片 Asset id）。 */
    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    /** 目标节点身份（画布擦除结果卡 node id；擦除是发送时才建卡，node id 由前端生成传入；
     *  worker 不消费画布拓扑）。 */
    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    /** 擦除场景（取值与火山 API 参数 standard_scene 同名同值）。 */
    public static final String INPUT_KEY_ERASE_SCENE = "erase_scene";

    /** 遮罩素材身份（黑白遮罩 Asset id；selected_area_erase 必填、full_screen_text_erase 禁填）。 */
    public static final String INPUT_KEY_MASK_ASSET_ID = "mask_asset_id";

    // ========== 擦除场景枚举（本期两值；与火山 API standard_scene 取值同名同值） ==========
    // full_screen_icon_erase / standard_erase_text 为范围外，枚举可扩展、不预写值。

    /** 全屏文字擦除（官方默认场景）：不传遮罩与指定文字，擦所有文字。 */
    public static final String SCENE_FULL_SCREEN_TEXT_ERASE = "full_screen_text_erase";

    /** 指定区域擦除：只传 mask_url（统一遮罩路径），不传 selected_area 矩形。 */
    public static final String SCENE_SELECTED_AREA_ERASE = "selected_area_erase";

    // ========== 出站固定参数（单处定义，出站请求处引用） ==========

    /** 火山 AI MediaKit tool_version：官方文档明示当前仅支持 standard（标准版）。 */
    public static final String TOOL_VERSION = "standard";

    /** 输出格式固定 png（官方默认 webp；取 png 保证结果卡可二次擦除/扩图/高清放大）。 */
    public static final String OUTPUT_FORMAT = "png";

    // ========== 输入限制（官方 PDF image_url 参数节；backend 复核 + web 预检同源） ==========

    /** 分辨率上限：长边不得超过 2560px（短边/长边语义，竖图 1440x2560 合法）。 */
    public static final int MAX_INPUT_LONG_SIDE_PX = 2560;

    /** 分辨率上限：短边不得超过 1440px。 */
    public static final int MAX_INPUT_SHORT_SIDE_PX = 1440;

    /** 分辨率下限：宽高均不得小于 10px。 */
    public static final int MIN_INPUT_SIDE_PX = 10;

    /** 文件大小上限：单张图片不得超过 10 MB。 */
    public static final long MAX_INPUT_FILE_BYTES = 10L * 1024 * 1024;

    /** 支持格式白名单：.png / .jpg / .jpeg / .heic（不含 webp / gif）。 */
    public static final List<String> SUPPORTED_INPUT_FORMATS = List.of("png", "jpg", "jpeg", "heic");

    // ========== 错误码（契约 §15.1；数值 1040 见 error-codes.ts ERROR_IMAGE_ERASE_FAILED） ==========

    /** 执行兜底失败码：调用失败 / 超时 / 供应商错误统一归并，无 worker 级自动重试（§15.5）。 */
    public static final String ERROR_IMAGE_ERASE_FAILED = "image_erase_failed";
}
