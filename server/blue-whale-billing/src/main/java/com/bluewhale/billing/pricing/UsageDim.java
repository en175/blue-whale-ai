package com.bluewhale.billing.pricing;

import java.util.Arrays;
import java.util.Map;

/**
 * 用量维度的**封闭枚举 + 注册表**（《计费逻辑详细设计》§4.6.4）。
 *
 * <p><b>key 与 {@code contracts/proto/billing/v1/usage.proto} 的 quantities 枚举、
 * catalog 的 baseUnit / dims / multipliers 三方一致</b>。这是「配了某个维度但没人上报」
 * 的结构性防线——不是靠人检查。
 *
 * <p>取舍：用**枚举值**而不是「一个维度一个类」。为一个字符串键写 13 个
 * {@code PromptTokenQuantitySource} 是自嗨；但纯字符串注册表又失去编译期保护。
 * 枚举 + 注册表两头都要。
 *
 * <p>新增维度 = 这里加一行 + proto 注释加一行 + catalog 文档加一行。
 * **不需要动引擎**（见 §4.6.6 的 🔵 档）。
 */
public enum UsageDim {

    /** 恒为 1：按次计费（mediakit / 抠图 / Suno）。 */
    CONSTANT_ONE("constant:1"),

    /** 成功的输出槽数：图片多张 / 视频多段。**按 slot 计费的基数**。 */
    SUCCEEDED_SLOTS("usage.succeededSlots"),

    /** 时长（秒）：视频 / 音频。 */
    SECONDS("usage.seconds"),

    /** 字符数：TTS。 */
    CHARACTERS("usage.characters"),

    /** 参考素材数。通常出现在 multipliers（整单倍率）而非 dims。 */
    REFERENCE_COUNT("usage.referenceCount"),

    // ── 以下为文本 / 多模态维度，**本期不启用**（文本模型不纳入计费），
    //    但契约与注册表先登记：启用时只需配 catalog，不改引擎。

    /** 输入 token。 */
    PROMPT_TOKENS("usage.p"),
    /** 输出 token。 */
    COMPLETION_TOKENS("usage.c"),
    /** 缓存读 token。 */
    CACHE_READ_TOKENS("usage.cr"),
    /** 缓存写 token（5 分钟档）。 */
    CACHE_WRITE_5M_TOKENS("usage.cc5m"),
    /** 缓存写 token（1 小时档）。 */
    CACHE_WRITE_1H_TOKENS("usage.cc1h"),
    /** 思考 / 推理 token。 */
    REASONING_TOKENS("usage.reasoning"),
    /** 图片输入 token。 */
    IMAGE_INPUT_TOKENS("usage.imgIn"),
    /** 音频输入 token。 */
    AUDIO_INPUT_TOKENS("usage.audioIn"),
    /** 总输入长度：**仅供 tiers 条件用**，不作为计费项。 */
    TOTAL_INPUT_LENGTH("usage.len");

    private final String key;

    UsageDim(String key) {
        this.key = key;
    }

    /** catalog / proto 里使用的字面键。 */
    public String key() {
        return key;
    }

    private static final Map<String, UsageDim> BY_KEY =
            Arrays.stream(values()).collect(java.util.stream.Collectors.toUnmodifiableMap(UsageDim::key, d -> d));

    /**
     * 从字面键解析。
     *
     * @throws UnknownUsageDimException 键不在枚举里——**目录加载期就该拒绝**，
     *         不能等到计价时才发现（那时已经扣错了）
     */
    public static UsageDim of(String key) {
        UsageDim dim = key == null ? null : BY_KEY.get(key.trim());
        if (dim == null) {
            throw new UnknownUsageDimException(key);
        }
        return dim;
    }

    /**
     * 从 usage 里取该维度的数量。
     *
     * <p><b>取不到 = 0，不是报错</b>：worker 可能没上报某个维度（例如无参考素材时
     * 不上报 referenceCount）。这是正常的，0 参与加权和即可。
     *
     * <p><b>例外：{@link #CONSTANT_ONE} 恒为 1</b>——它表达的是「这次调用算一次」，
     * 语义上不依赖 worker 上报任何东西。按次计费的模型没有它就会算成 0 → 落到下限。
     */
    public long quantityOf(Map<UsageDim, Long> quantities) {
        if (this == CONSTANT_ONE) {
            return 1L;
        }
        Long value = quantities.get(this);
        return value == null ? 0L : value;
    }

    /** 维度键拼写错误——配置错误，加载期拒绝。 */
    public static class UnknownUsageDimException extends RuntimeException {
        public UnknownUsageDimException(String key) {
            super("未知的用量维度键：" + key + "（合法值见 UsageDim 枚举）");
        }
    }
}
