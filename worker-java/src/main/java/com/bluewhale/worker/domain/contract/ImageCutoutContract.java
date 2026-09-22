package com.bluewhale.worker.domain.contract;

import java.util.List;

/**
 * 图片抠图（image_cutout）跨进程任务契约常量（契约章节 docs/specs/2026-09-18-image-cutout-mediakit.md / IKGXLS）。
 * <p>
 * 变化轴：跨进程字段（TS 侧权威 = backend/libs/contracts/image-cutout.ts；防漂移断言 =
 * backend/libs/contracts/image-cutout.test.ts 直接读本文件源码文本对账，两处任一侧改动即红）。
 * <p>
 * MQ tag 的字面量已上移到 {@link GenerationMqRouteEnum}（本类的 {@link #TAG} 只做转发）：
 * 防漂移断言若要继续按源码文本对账 tag，须改读该枚举文件。
 * 契约先行红线：字段名在本类定死后 IKGXM1（创建入口）/ IKGXM2（消费者、处理器、领取 SQL、
 * 终态收口）一律引用本类，禁止另行发明字面量。
 * <p>
 * 供应商接口 = 火山引擎 AI MediaKit「提交图像背景移除任务 API」（同步），本仓经 new-api 网关
 * 调用（对客模型名 mediakit-remove-image-background；参数名以官方 PDF 为准，出处逐条标注在常量注释）。
 * <p>
 * 组装规则（规格故事 29）：通用场景（general）不携带描边与裁剪参数——官方在该场景会忽略
 * need_contour / contour_color / contour_size / need_crop_background 四参，出站请求体不得携带
 * 接口会忽略的字段；human / product 场景四键恒随请求携带。
 * <p>
 * 结果回填约定（同 ImageEraseContract §15.5 模式）：成功 = 同步响应后立即下载结果图（火山 URL
 * 仅 24h 有效，响应后立即转存）→ 落 TOS 公开读 → 建 Asset（type=image / source='generated' /
 * generation_job_id）→ 终态 succeeded，前端按 input.target_node_id 回填抠图结果卡；失败 = 终态
 * failed + 既有错误码投影（兜底 image_cutout_failed），无自动重试，用户在结果卡手动重试并沿用冻结 input。
 */
public final class ImageCutoutContract {

    private ImageCutoutContract() {
    }

    /** MQ tag（= generation_jobs.type = JobType.IMAGE_CUTOUT）；值单处定义在 {@link GenerationMqRouteEnum#IMAGE_CUTOUT}。 */
    public static final String TAG = GenerationMqRouteEnum.IMAGE_CUTOUT.tag();

    /** 任务来源值：唯一创建入口是画布图片卡工具条「高清 ▾ → 抠图」，claim SQL 的 source 白名单仅含本值。 */
    public static final String SOURCE = "image_cutout";

    // ========== input 冻结键名（业务键按场景三键/七键恒在、值恒为合法枚举；重试原样沿用） ==========
    // provider_credential 是业务键之上的基础设施键（创建侧冻结落库，同 ImageEraseContract 口径）。

    /** 源素材身份（被抠图的图片 Asset id）。 */
    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    /** 目标节点身份（画布抠图结果卡 node id；抠图是发送时才建卡，node id 由前端生成传入；
     *  worker 不消费画布拓扑）。 */
    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    /** 抠图场景（取值与火山 API 参数 scene 同名同值）。 */
    public static final String INPUT_KEY_CUTOUT_SCENE = "cutout_scene";

    /** 主体描边开关（仅 human/product 场景携带；官方在 general 场景忽略描边与裁剪参数）。 */
    public static final String INPUT_KEY_NEED_CONTOUR = "need_contour";

    /** 描边颜色（仅 human/product 携带；固定白色，取色器为范围外）。 */
    public static final String INPUT_KEY_CONTOUR_COLOR = "contour_color";

    /** 描边宽度 px（仅 human/product 携带；[1,100] 默认 10）。 */
    public static final String INPUT_KEY_CONTOUR_SIZE = "contour_size";

    /** 透明背景裁剪开关（仅 human/product 场景携带）。 */
    public static final String INPUT_KEY_NEED_CROP_BACKGROUND = "need_crop_background";

    // ========== 抠图场景枚举（本期三值；与火山 API scene 取值同名同值） ==========

    /** 通用场景：自动识别并保留图像主体（期望抠出主体但不确定分类时用）。 */
    public static final String SCENE_GENERAL = "general";

    /** 人像抠图：仅保留图像中的人像主体。 */
    public static final String SCENE_HUMAN = "human";

    /** 商品抠图：仅保留图像中的商品主体。 */
    public static final String SCENE_PRODUCT = "product";

    // ========== 出站固定参数（单处定义，出站请求处引用） ==========

    /** 输出格式固定 png（官方默认即 png、支持透明；jpeg 透明填黑 / webp 下游不兼容被规格否决）。
     *  官方另有 queue_id 可选参（按队列分账），本功能不传——走系统默认队列。 */
    public static final String OUTPUT_FORMAT = "png";

    /** 描边颜色固定 #FFFFFF（官方默认值；产品口径颜色不可选，取色器为范围外）。 */
    public static final String CONTOUR_COLOR = "#FFFFFF";

    /** 描边宽度官方取值范围下限（px）。产品对客滑杆 1~50 属前端展示口径，出站钳制在 web 侧做。 */
    public static final int CONTOUR_SIZE_MIN = 1;

    /** 描边宽度官方取值范围上限（px）。 */
    public static final int CONTOUR_SIZE_MAX = 100;

    /** 描边宽度默认值（px；官方默认 10）。 */
    public static final int CONTOUR_SIZE_DEFAULT = 10;

    // ========== 输入限制（官方 PDF image_url 参数节；backend 复核 + web 预检同源） ==========

    /** 文件大小上限：单张图片不得超过 30 MB。 */
    public static final long MAX_INPUT_FILE_BYTES = 30L * 1024 * 1024;

    /** 支持格式白名单：.png / .jpg / .jpeg / .heic（不含 webp / gif）。 */
    public static final List<String> SUPPORTED_INPUT_FORMATS = List.of("png", "jpg", "jpeg", "heic");

    // ========== 分辨率上限（按场景两档；官方无分辨率下限） ==========

    /** general 档：长边不得超过 10240px（菜单预检亦用本档）。 */
    public static final int MAX_GENERAL_INPUT_LONG_SIDE_PX = 10240;

    /** general 档：短边不得超过 6000px。 */
    public static final int MAX_GENERAL_INPUT_SHORT_SIDE_PX = 6000;

    /** general 档：总像素（长边×短边）不得超过 40MP（官方仅本档给出总像素上限）。 */
    public static final long MAX_GENERAL_INPUT_TOTAL_PIXELS = 40_000_000L;

    /** human/product 档：长边不得超过 7680px（官方未给该档总像素上限）。 */
    public static final int MAX_SUBJECT_INPUT_LONG_SIDE_PX = 7680;

    /** human/product 档：短边不得超过 4320px。 */
    public static final int MAX_SUBJECT_INPUT_SHORT_SIDE_PX = 4320;

    // ========== 错误码（数值 1042 见 error-codes.ts ERROR_IMAGE_CUTOUT_FAILED；1041 已由扩图 !737 占用） ==========

    /** 执行兜底失败码：调用失败 / 超时 / 供应商错误统一归并，无 worker 级自动重试。 */
    public static final String ERROR_IMAGE_CUTOUT_FAILED = "image_cutout_failed";
}
