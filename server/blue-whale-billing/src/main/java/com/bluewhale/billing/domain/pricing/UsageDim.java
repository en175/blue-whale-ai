package com.bluewhale.billing.domain.pricing;

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
 *
 * <h2>契约量从哪来</h2>
 *
 * <p>提交时刻还没有真实用量，但**契约用量是已知的**（这次任务最多会产出多少）。
 * 「这个维度的契约量从哪来」也在本枚举里登记（{@link #contractSource()}）——
 * 它和维度键一样是「三方一致」的一部分：配了某个维度做基准，就必须有对应的契约量来源，
 * 否则预扣算不出上限（{@code null} = 该维度在提交时刻**结构性**地没有来源）。
 * 这一列是这个不变式的登记处。
 */
public enum UsageDim {

    /** 恒为 1：按次计费（mediakit / 抠图 / Suno）。 */
    CONSTANT_ONE("constant:1", null),

    /** 成功的输出槽数：图片多张 / 视频多段。**按 slot 计费的基数**。 */
    SUCCEEDED_SLOTS("usage.succeededSlots", new ContractSource.SpecKey("expected_output_count")),

    /** 时长（秒）：视频 / 音频。 */
    SECONDS("usage.seconds", new ContractSource.SpecKey("duration")),

    /**
     * 字符数：TTS。
     *
     * <p>⚠️ 没有契约量来源：文本是模型**生成**出来的，提交时刻还不知道会有多少字。
     */
    CHARACTERS("usage.characters", null),

    /**
     * 参考素材数。通常出现在 multipliers（整单倍率）而非 dims。
     *
     * <p>契约量来自 {@code reference_count}：参考素材在 job 的规格快照里是**数组**
     * （{@code references}），数组进不了 specs，所以 {@code billing-specs.ts} 在提取规格时
     * 把它的**长度**写成一个标量键——Hold 与 Quote 共用那一份归一，两边取到同一个数。
     *
     * <p>⚠️ **取哪个数组按媒介**（口径三处逐条相同：{@code billing-specs.ts} 的
     * {@code referenceList}、{@code SettlementUsageLines.referenceList}、这里）：
     * <ul>
     *   <li><b>图片</b>：{@code input.input_asset_ids}（{@code imageStrategy.composeInput}
     *       把参考图统一落这个键，图片**从不写** {@code references}）</li>
     *   <li><b>视频 / 音频</b>：{@code input.references}。走旧分字段路径
     *       （{@code reference_asset_ids} / {@code reference_materials} / 首尾帧字段）时
     *       那个数组整键缺失 ⇒ 本维度为 0 —— 这是**刻意**的，放开会把老客户端的单子
     *       突然算上参考费</li>
     * </ul>
     * 改造前只认 {@code references}，于是**图片单的本维度恒为 0** —— 而 Seedream 5.0 Pro
     * 的参考图按张收费，那个 0 会让加价永远不生效。
     */
    REFERENCE_COUNT("usage.referenceCount", new ContractSource.SpecKey("reference_count")),

    // ── 以下为文本 / 多模态维度，**文本模型仍不纳入计费**，
    //    但契约与注册表先登记：启用时只需配 catalog，不改引擎。
    //    它们的契约量来源一概为 null：token 数由上游返回，提交时刻无从得知。

    /** 输入 token。 */
    PROMPT_TOKENS("usage.p", null),
    /**
     * 输出 token。
     *
     * <p>⚠️ **视频生成按它计价**（2026-09-25 起）：上游返回的
     * {@code usage.total_tokens}（不可用时回退 {@code usage.completion_tokens}）就是模型的
     * 输出 token 数——它与文本的 completion token 是同一个量纲、同一个语义「模型产出的 token」，
     * 所以共用本维度，而不是为视频另开一个键（{@code usage.proto} 已冻结，不动）。
     *
     * <p>契约量来源是 {@link ContractSource.Estimated}：提交时刻 specs 里**没有** token 键，
     * 只能按规则里登记的官方公式估一个上限（{@link TokenEstimator}）。
     * 结算仍用 worker 上报的上游真值——**估算只服务预扣**。
     */
    COMPLETION_TOKENS("usage.c", new ContractSource.Estimated()),
    /** 缓存读 token。 */
    CACHE_READ_TOKENS("usage.cr", null),
    /** 缓存写 token（5 分钟档）。 */
    CACHE_WRITE_5M_TOKENS("usage.cc5m", null),
    /** 缓存写 token（1 小时档）。 */
    CACHE_WRITE_1H_TOKENS("usage.cc1h", null),
    /** 思考 / 推理 token。 */
    REASONING_TOKENS("usage.reasoning", null),
    /** 图片输入 token。 */
    IMAGE_INPUT_TOKENS("usage.imgIn", null),
    /** 音频输入 token。 */
    AUDIO_INPUT_TOKENS("usage.audioIn", null),
    /** 总输入长度：**仅供 tiers 条件用**，不作为计费项。 */
    TOTAL_INPUT_LENGTH("usage.len", null);

    private final String key;
    private final ContractSource contractSource;

    UsageDim(String key, ContractSource contractSource) {
        this.key = key;
        this.contractSource = contractSource;
    }

    /** catalog / proto 里使用的字面键。 */
    public String key() {
        return key;
    }

    /**
     * 提交时刻本维度**契约量**的来源；{@code null} = 提交时刻结构性取不到。
     *
     * <p>两种来源（直读规格键 / 按规则参数估算）见 {@link ContractSource}。
     * ⚠️ 与 {@code null} 的区别不是「有没有值」，而是「有没有来源」——
     * 直读可能这次的值不在 specs 里（{@code duration=-1} 的自动时长），
     * 估算也可能这次推不出来（档位 + 比例没配）。这两种都**有**来源，
     * 因而允许走「按规则上限冻结」的兜底；{@code null} 则直接拒绝。
     */
    public ContractSource contractSource() {
        return contractSource;
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
