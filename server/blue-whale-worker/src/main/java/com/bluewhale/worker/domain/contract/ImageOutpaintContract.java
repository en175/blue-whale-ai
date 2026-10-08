package com.bluewhale.worker.domain.contract;

/**
 * 智能扩图（image_outpaint）跨进程任务契约常量（IKGOQR，契约先行红线）。
 * <p>
 * 变化轴：跨进程字段（TS 侧权威 = backend/libs/contracts/image-outpaint.ts；防漂移断言 =
 * backend/libs/contracts/image-outpaint.test.ts 直接读本文件源码文本对账，两处任一侧改动即红）。
 * 后续票（创建入口 / 消费者、处理器、领取 SQL、终态收口 / 前端）一律引用本类，禁止另行发明字面量。
 * 权威规格 = docs/specs/2026-09-18-image-outpaint-mediakit.md；关键取舍见 ADR-0093。
 * <p>
 * 结果回填约定（同高清放大 §14.5）：成功 = 下载结果图（火山 URL 仅 24h 有效，响应后立即转存）→ 落 TOS
 * 公开读 → 建 Asset（type=image / source='generated' / generation_job_id）→ 终态 succeeded，
 * 前端按 input.target_node_id 回填扩图结果卡（源卡不动）；失败 = 终态 failed + 既有错误码投影
 * （兜底 image_outpaint_failed），无自动重试，用户在结果卡手动重试并沿用冻结 input。
 * 网关同步路由 POST /v1/mediakit/sync/expand-image-canvas（对客模型名 mediakit-expand-image-canvas），
 * 入参 image_url + 四个 expand 比例（queue_id 不传，用默认队列）。
 */
public final class ImageOutpaintContract {

    private ImageOutpaintContract() {
    }

    /** MQ tag（= generation_jobs.type = JobType.IMAGE_OUTPAINT；复用 topic generation-video）。 */
    public static final String TAG = "image_outpaint";

    /** 任务来源值：唯一创建入口是画布图片卡工具条「高清 ▾」菜单，claim SQL 的 source 白名单仅含本值
     *（连线为纯视觉来源线，不参与参考推导与 @ 编号）。 */
    public static final String SOURCE = "image_outpaint";

    // ========== input 冻结键名（六键恒在、创建时定死；重试原样沿用） ==========

    /** 源素材身份（被扩图的图片 Asset id）。 */
    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    /** 目标节点身份（画布扩图结果卡 node id，前端回填结果定位用；worker 不消费画布拓扑）。 */
    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    /** 上方扩展比例（与火山 API 参数 expand_top 同名同值，相对原图短边，出站原样透传）。 */
    public static final String INPUT_KEY_EXPAND_TOP = "expand_top";

    /** 下方扩展比例（与火山 API 参数 expand_bottom 同名同值，相对原图短边，出站原样透传）。 */
    public static final String INPUT_KEY_EXPAND_BOTTOM = "expand_bottom";

    /** 左侧扩展比例（与火山 API 参数 expand_left 同名同值，相对原图短边，出站原样透传）。 */
    public static final String INPUT_KEY_EXPAND_LEFT = "expand_left";

    /** 右侧扩展比例（与火山 API 参数 expand_right 同名同值，相对原图短边，出站原样透传）。 */
    public static final String INPUT_KEY_EXPAND_RIGHT = "expand_right";

    // ========== 单方向扩展比例值域（相对原图短边；四键中至少一项大于 0，创建入口 refine 拦截零扩展） ==========

    /** 扩展比例下限（含）：0 表示该方向不扩；产品总是显式传值，不依赖火山官方默认 0.1。 */
    public static final double EXPAND_RATIO_MIN = 0.0d;

    /** 扩展比例上限（含）：0.4（原图短边的 40%，前端拖框同口径钳制）。 */
    public static final double EXPAND_RATIO_MAX = 0.4d;

    // ========== 错误码（数值 1041 见 error-codes.ts ERROR_IMAGE_OUTPAINT_FAILED；1040 已由 IKGOT3 擦除占用） ==========

    /** 执行兜底失败码：调用失败 / 超时 / 供应商错误统一归并，无 worker 级自动重试。 */
    public static final String ERROR_IMAGE_OUTPAINT_FAILED = "image_outpaint_failed";
}
