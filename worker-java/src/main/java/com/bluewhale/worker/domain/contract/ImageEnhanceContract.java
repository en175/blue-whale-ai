package com.bluewhale.worker.domain.contract;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 高清放大（image_enhance）跨进程任务契约常量（契约 §14 / IKGM8U）。
 * <p>
 * 变化轴：跨进程字段（TS 侧权威 = backend/libs/contracts/image-enhance.ts；防漂移断言 =
 * backend/libs/contracts/image-enhance.test.ts 直接读本文件源码文本对账，两处任一侧改动即红）。
 * <p>
 * MQ tag 的字面量已上移到 {@link GenerationMqRouteEnum}（本类的 {@link #TAG} 只做转发）：
 * 防漂移断言若要继续按源码文本对账 tag，须改读该枚举文件。
 * 契约先行红线：字段名在本类定死后 IKGM99（创建入口）/ IKGM9D（消费者、处理器、领取 SQL、
 * 终态收口）一律引用本类，禁止另行发明字面量。
 * <p>
 * 结果回填约定（§14.5）：成功 = 下载结果图（火山 URL 仅 24h 有效，响应后立即转存）→ 落 TOS
 * 公开读 → 建 Asset（type=image / source='generated' / generation_job_id）→ 终态 succeeded，
 * 前端按 input.target_node_id 回填目标高清卡；失败 = 终态 failed + 既有错误码投影
 * （兜底 image_enhance_failed），无自动重试，用户在原卡手动重试并沿用冻结 input。
 */
public final class ImageEnhanceContract {

    private ImageEnhanceContract() {
    }

    /** MQ tag（= generation_jobs.type = JobType.IMAGE_ENHANCE）；值单处定义在 {@link GenerationMqRouteEnum#IMAGE_ENHANCE}。 */
    public static final String TAG = GenerationMqRouteEnum.IMAGE_ENHANCE.tag();

    /** 任务来源值：唯一创建入口是画布图片卡工具条，claim SQL 的 source 白名单仅含本值。 */
    public static final String SOURCE = "image_enhance";

    // ========== input 冻结键名（六键恒在、值恒为合法枚举；重试原样沿用） ==========

    /** 源素材身份（被放大的图片 Asset id）。 */
    public static final String INPUT_KEY_SOURCE_ASSET_ID = "source_asset_id";

    /** 目标节点身份（画布高清卡 node id，前端回填结果定位用；worker 不消费画布拓扑）。 */
    public static final String INPUT_KEY_TARGET_NODE_ID = "target_node_id";

    /** 版本档（lite / pro / max，前端展示名 Lite/Pro/Max 只在 UI）。 */
    public static final String INPUT_KEY_VERSION_TIER = "version_tier";

    /** 放大倍数（与火山 API 参数 multiple 同名同值，出站原样透传）。 */
    public static final String INPUT_KEY_MULTIPLE = "multiple";

    /** 增强策略（与火山 API 参数 generative_enhance_mode 同名同值，出站原样透传）。 */
    public static final String INPUT_KEY_GENERATIVE_ENHANCE_MODE = "generative_enhance_mode";

    /** 色彩校正开关（与火山 API 参数 enable_correct_color 同名同值，出站原样透传）。 */
    public static final String INPUT_KEY_ENABLE_CORRECT_COLOR = "enable_correct_color";

    // ========== 版本档枚举值与 tool_version 映射（单处定义，出站请求处换算） ==========

    /** 版本档：Lite（映射 tool_version=standard）。 */
    public static final String TIER_LITE = "lite";

    /** 版本档：Pro（映射 tool_version=professional；默认档）。 */
    public static final String TIER_PRO = "pro";

    /** 版本档：Max（映射 tool_version=max）。 */
    public static final String TIER_MAX = "max";

    /** 火山 AI MediaKit tool_version：lite→standard、pro→professional、max→max。 */
    public static final Map<String, String> TIER_TO_TOOL_VERSION = Map.of(
            TIER_LITE, "standard",
            TIER_PRO, "professional",
            TIER_MAX, "max");

    /** 放大倍数合法值（规格限 2/4/6，不开放任意倍率）。 */
    public static final List<Integer> MULTIPLES = List.of(2, 4, 6);

    // ========== 增强策略枚举值（fidelity_first=保真度优先 / generative_first=生成度优先） ==========

    public static final String MODE_FIDELITY_FIRST = "fidelity_first";

    public static final String MODE_GENERATIVE_FIRST = "generative_first";

    // ========== 版本档能力矩阵（火山三版本差异；出站时按此裁剪不支持的键） ==========

    /** 支持增强策略（generative_enhance_mode）的版本档：仅 pro / max。 */
    public static final Set<String> TIERS_WITH_ENHANCE_MODE = Set.of(TIER_PRO, TIER_MAX);

    /** 支持色彩校正（enable_correct_color）的版本档：仅 max。 */
    public static final Set<String> TIERS_WITH_CORRECT_COLOR = Set.of(TIER_MAX);

    // ========== 默认值（面板初始态；与火山官方默认一致，见契约 §14.4） ==========

    /** 默认版本档：pro。 */
    public static final String DEFAULT_VERSION_TIER = TIER_PRO;

    /** 默认放大倍数：2。 */
    public static final int DEFAULT_MULTIPLE = 2;

    /** 默认增强策略：生成度优先。 */
    public static final String DEFAULT_MODE = MODE_GENERATIVE_FIRST;

    /** 默认色彩校正：开。 */
    public static final boolean DEFAULT_ENABLE_CORRECT_COLOR = true;

    // ========== 错误码（契约 §14.1；数值 1039 见 error-codes.ts ERROR_IMAGE_ENHANCE_FAILED） ==========

    /** 执行兜底失败码：调用失败 / 超时 / 供应商错误统一归并，无 worker 级自动重试（§14.5）。 */
    public static final String ERROR_IMAGE_ENHANCE_FAILED = "image_enhance_failed";
}
