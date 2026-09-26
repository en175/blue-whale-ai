package com.bluewhale.billing.catalog;

import java.util.List;
import java.util.Map;

/**
 * 定价目录 JSON 的 Java 形态（《计费逻辑详细设计》§2.5.1）。
 *
 * <p><b>目录里只剩下与「怎么收钱」有关的两件全局配置</b>：元 → 积分的换算率
 * （{@link #creditsPerYuan}）与折扣叠加策略（{@link #discountPolicy}）。
 *
 * <p>⚠️ <b>计价规则不在目录里</b>。它按模型归属，住在模型能力行
 * （backend 的 {@code generation_model_capability.pricing}），由属主在 Hold / Quote 时
 * 作为**规则快照**随请求送来（形态见 {@link TaskRule}），预扣时冻进预留行、结算按它复现——
 * 所以目录不再需要按 (model, task) 索引任何东西，见 {@link CatalogCompiler}。
 *
 * <p>**这是 wire/存储形态，不是领域形态**——规则要编译成 {@code CompiledRule} 后才进引擎。
 * 分成两层是因为：JSON 要容忍运营写得不规范（大小写、额外字段），
 * 而领域对象必须严格（构造即校验）。
 *
 * <p>用 record + Jackson 直接反序列化；未知字段由 {@code FAIL_ON_UNKNOWN_PROPERTIES=false}
 * 容忍——所以**老目录行里那个 {@code models} 段会被直接忽略，不需要数据迁移**，
 * 见 {@code CatalogRepository} 的注释。
 */
public record CatalogDocument(
        int schemaVersion,
        String currency,
        /** ★ 1 元 = 多少积分（元 → 积分的换算率）。**这是目录的配置项，不是硬编码常量**：
         *  与目录一起版本化，所以口径的每一次变化都能追溯到「哪个版本改的」，也随时可整体回滚。
         *
         *  <p>⚠️ 它只作用于**充值**（到账积分 = 原价 × 本值，且在下单时刻冻结进订单）。
         *  生成任务的计价与它无关（单价本身就是 mc），所以改它不影响任何已提交的任务 ——
         *  详见 {@code CatalogCompiler#compileCreditsPerYuan} 的注释。
         *
         *  合法区间见 {@link #MIN_CREDITS_PER_YUAN} ~ {@link #MAX_CREDITS_PER_YUAN}，编译期校验。 */
        int creditsPerYuan,
        DiscountPolicy discountPolicy
) {

    public static final int SUPPORTED_SCHEMA_VERSION = 1;

    /**
     * 本服务能编译的**规则快照**格式版本（{@link TaskRule#schemaVersion}）。
     *
     * <p>与 {@link #SUPPORTED_SCHEMA_VERSION} 分开：那个管整份目录，这个只管一条规则的形状。
     *
     * <p>⚠️ **改规则语义时必须 +1**（例如把 {@code dims} 的万分比换成绝对值）。
     * 不加的后果是：老快照会被按新语义**静默重算**出一个价 —— 账平、无告警、钱错。
     * +1 之后老快照会变成一次明确的拒单，有人看得见。
     *
     * <p>{@code null}（老快照没这个字段）按本值处理 —— 加字段那一次必须是兼容的，
     * 否则线上所有在途预留同时结不掉。
     */
    public static final int SUPPORTED_RULE_SCHEMA_VERSION = 1;

    /**
     * {@link #creditsPerYuan} 的合法区间（含端点）。
     *
     * <p>下界 1：0 或负数意味着「多少元都换不到积分」，整份目录失去换算意义。
     * 上界 100000：不是算不出来，而是「1 元 = 10 万积分」这种量级几乎必定是运营多敲了几个 0——
     * 换算率写错的代价是**用户看到的余额与实际扣费对不上**，且会随冻结版本一直复现，
     * 所以宁可发布时拒绝，也不要放进去之后再靠人发现。
     */
    public static final int MIN_CREDITS_PER_YUAN = 1;
    public static final int MAX_CREDITS_PER_YUAN = 100_000;

    /**
     * 单个 (model, taskType) 的计价规则 —— **这是一条规则本身，不是目录里的一段**。
     *
     * <p>它的唯一来路是：属主（backend）把能力行的 {@code pricing} 列序列化成这一形态，
     * 随 Hold / Quote 作为**规则快照**送来（{@code HoldCommand#ruleSnapshot}），
     * 预扣时冻进预留行、结算按它复现。billing 读不到那个库（ADR-0114 不共享库），
     * 所以这条规则永远以一段 JSON 文本的形式到达，本 record 就是那段文本的形态。
     *
     * @param usageSemantic   仅文本/多模态用：{@code openai} | {@code claude}。本期不启用
     * @param baseUnit        ★ 基准维度键，如 {@code usage.seconds}
     * @param basePrice       ★ 基准单价：常数或按轴查表
     * @param dims            按数量加权的其他维度 → **万分比**（10000 = 1 倍，4000 = 0.4 倍）
     * @param multipliers     整单连乘的倍率 → **万分比**（12000 = 1.2 倍）
     * @param dimPrices       ★ 按维度的**绝对**加价（见 {@link DimPrice}）；与 dims 的区别是
     *                        它**不乘 basePrice** —— 所以同一个「每张 0.02 元」在 basePrice
     *                        有两个档的规则里也是同一个数
     * @param unitDenominator 「每多少个单位多少钱」：1000000 = 每百万 token，1 = 每秒/每张/每次
     * @param minCredits      下限（整数积分）
     * @param maxCredits      上限，null = 不封顶
     * @param rounding        {@code halfUp}（默认）| {@code ceil} | {@code floor}
     * @param tokenEstimate   视频按 token 计价的**预扣估算参数**；不配 = 该规则不做估算
     *                        （按 {@code usage.c} 计价就必须配，否则提交时算不出契约量）
     * @param schemaVersion   快照的**格式版本**，见下面 `@param` 后的说明
     */
    public record TaskRule(
            String usageSemantic,
            String baseUnit,
            BasePrice basePrice,
            Map<String, Integer> dims,
            Map<String, Integer> multipliers,
            Map<String, DimPrice> dimPrices,
            Long unitDenominator,
            Long minCredits,
            Long maxCredits,
            String rounding,
            TokenEstimate tokenEstimate,
            /**
             * 快照的**格式版本**。{@code null} = 加这个字段之前冻下的老快照，按
             * {@link CatalogDocument#SUPPORTED_RULE_SCHEMA_VERSION} 处理。
             *
             * <h2>为什么必须有它</h2>
             *
             * <p>规则快照是**冻结的文本**，而结算时用**当前代码**去编译它
             * （{@link CatalogCompiler#compileRuleSnapshot}）。在此之前那份文本没有任何版本标记，
             * 于是「改了规则 schema 的语义」只能靠人记得 —— 而两种改动都会静默出事：
             * <ul>
             *   <li><b>收紧校验</b>（例如给 {@code dims} 加一条「值不能为负」）：老快照编不过 ⇒
             *       那条预留**永远结不掉**，MQ 重投到死信，钱一直冻着。</li>
             *   <li><b>改语义</b>（例如把 {@code dims} 的万分比换成绝对值）：**不报错**，
             *       直接按新语义给老单重算一个价 —— 比编译失败更坏，因为没有任何信号。</li>
             * </ul>
             *
             * <p>有了它，第二种情况就能被挡住：编译时只接受自己认识的版本，
             * 改语义时把 {@code SUPPORTED_RULE_SCHEMA_VERSION} 一加，老快照当场变成
             * 一次**明确的拒单**（有人看得见），而不是一笔算错的账。
             *
             * <p>⚠️ 与目录文档的 {@code schemaVersion} 是**两个东西**：那个管整份目录
             * （换算率 + 折扣策略），这个只管一条规则的形状。分开是因为演进节奏不同 ——
             * 换折扣策略不该逼着所有规则快照升版本。
             */
            Integer schemaVersion
    ) {}

    /**
     * 按维度的**绝对**加价 —— 每个计费单位固定多少钱，**与 {@link #basePrice} 无关**。
     *
     * <h2>为什么必须有它（dims 做不到）</h2>
     *
     * {@code dims} 是**相对**的：{@code units += 数量 × 万分比}，然后 {@code mc = units × basePrice}。
     * 于是「每个单位多少钱」= {@code 万分比 × basePrice} —— **它随 basePrice 变**。
     * 对单价分档的规则（例如 Seedream 5.0 Pro 的输出图按像素分 0.3 / 0.6 两档），
     * 同一个「参考图每张 0.02 元」在 0.3 档要 667 万分比、在 0.6 档要 333 万分比 ——
     * **一个字段表达不了**。绝对加价就绕开了这个耦合：{@code 0.02 元 = 300 mc}，两档都是它。
     *
     * <p>火山官方对 Seedream 5.0 Pro 的计费正是这个形状：
     * <i>「输出图按像素档计费 + 输入参考图首张免费、第 2 张起 0.02 元/张」</i>。
     *
     * <h2>与另外三个字段的分工</h2>
     * <ul>
     *   <li>{@code baseUnit + basePrice} —— 主价：单位数 × 单价</li>
     *   <li>{@code dims} —— **相对**加量：把别的维度折算成基准单位数</li>
     *   <li>{@code multipliers} —— **相对**整单倍率</li>
     *   <li>{@code dimPrices} —— **绝对**加价：计费单位数 × unitMc</li>
     * </ul>
     *
     * <p>它加在基准价之后、上限之前、折扣之前（见
     * {@code AbstractPricingCalculator#computeDetailed}）——所以它**在封顶之内、受折扣作用**。
     *
     * @param unitMc    每个计费单位多少 mc（与 {@code basePrice.value} 同一单位：1 积分 = 1000 mc）
     * @param firstFree 首单位免费（{@code true} ⇒ 计费单位数取 {@code max(0, n - 1)}）——
     *                  对应用官方的「首张参考图免费」。{@code null} / 缺省 = 不免费
     */
    public record DimPrice(Long unitMc, Boolean firstFree) {}

    /**
     * token 估算参数（火山方舟官方 token 计费公式的系数）。
     *
     * <p>为什么它必须在规则里而不是代码里：{@code divisor}、{@code fps}、
     * {@code minimumTokens} 与「输入时长的规格键」都是**运营可能改的数**——火山改口径、
     * 某档位换帧率、补上输入时长那一项，都只该改一条规则的配置，而不是改代码发版。
     * 代码只固定公式的形状（见 {@code TokenEstimator}）。
     *
     * <p>⚠️ 它**只服务预扣**。结算按 worker 上报的**上游真实 token** 计价。
     *
     * <p>⚠️ <b>为什么同一个公式要有两条规则（2.0 与 2.5）而不是一条</b>：单价不同，
     * 而单价是 {@code basePrice} —— 它是规则自己的字段。所以「计费方式相同、单价不同」
     * 在配置里天然就是两条规则，无需另造机制；2.5 的单价火山尚未给出时，
     * 它的 {@code basePrice.kind} 写 {@code unset}（空位），提交即拒绝，**不按 0 免费**。
     *
     * @param divisor    除数字：token ≈ 宽 × 高 × 帧率 × (输出时长 + 输入时长) ÷ divisor（官方 1024）
     * @param fps        帧率（官方对照表是 24；生成任务的参数里没有帧率这个轴，
     *                   上游返回的 {@code framespersecond} 也是 24，故取官方默认）
     * @param inputSecondsKey 输入视频**时长（秒）**在规格快照里的键，默认
     *                   {@code video_input_seconds}。配了它，公式就含「输入时长」那一项
     *                   （火山官方：含视频输入时 {@code (输入时长 + 输出时长) × 宽 × 高 × 帧率 ÷ 1024}）；
     *                   不配 = 不含那一项（含视频输入的任务预扣偏低，缺口上界 = 输入时长那一项）。
     *
     *                   <p>⚠️ 它的值是**规格提取侧**折算出来的：参考素材的时长在建任务时
     *                   冻结进 job input 的 {@code references} 里，再由 {@code billing-specs.ts}
     *                   （预扣侧）与 {@code SettlementUsageLines}（结算侧）折算成这一个标量键。
     *                   所以「某个模型的参考视频能不能算进预扣」是**这条规则的一个开关**，
     *                   而「时长从哪来」是接纳侧的事——两者分开，改一边不动另一边。
     *
     *                   <p>⚠️ 配了它之后，{@code video=1}（含视频输入）而该键取不到时估算**返回取不到**
     *                   （走上限冻结或拒绝），不按 0 估——见 {@code TokenEstimator} 的说明。
     * @param minimumTokens **最低 token 用量表**（官方明文规则，可选的配置位）：
     *                   「分辨率 + 宽高比 + 输出时长」→ 最低 token 用量，
     *                   键的语法与 {@link BasePrice#table} 完全一致
     *                   （如 {@code "resolution=480p|aspect_ratio=16:9|duration=5"}）。
     *
     *                   <p>火山原文：<i>「对于 Seedance 2.0 系列、Seedance 2.5 模型，
     *                   当输入包含视频时，存在最低 token 用量限制：如果估算 token 用量 ＜
     *                   最低 token 用量，则按最低 token 用量计算视频价格。」</i>
     *
     *                   <p>所以它①**只在 {@code video=1} 时生效**（官方限定语），
     *                   ②只作用在**估算**上（官方原文用的就是「估算 token 用量」），
     *                   ③是**逐段**的下限（一条视频的下限 × 片段数）。
     *
     *                   <p>⚠️ 官方原页只给了两张「最低 token 用量表格」的飞书链接
     *                   （分辨率 × 宽高比 × 输出时长 → 最低用量），**没有公开可抄的形态**——
     *                   所以这里是个**配置位**：不配 = 本规则不做下限；
     *                   配了就必须配全，某格查不到时估算取不到（漏配要吵，不静默少冻）。
     *
     *                   <p>⚠️ <b>宽高不在这里</b>：「档位 + 比例 → 输出宽高」是**模型的属性**
     *                   （像素），住在能力行的 {@code features.video_dimensions} 里，
     *                   由接纳侧按规格解析后冻成 {@code output_width} / {@code output_height}
     *                   两个标量随 Hold 过来（见 {@code TokenEstimator}）。
     *                   本类只装**公式参数**（定价口径），不装像素。
     */
    public record TokenEstimate(
            Integer divisor,
            Integer fps,
            String inputSecondsKey,
            Map<String, Long> minimumTokens
    ) {}

    /**
     * 基准单价的三种形态。
     *
     * @param kind  {@code const} | {@code table} | {@code unset}
     * @param value {@code const} 时的单价（mc）
     * @param by    {@code table} / {@code unset} 时声明的定价轴（仅供校验与文档，查表靠 table 的键）
     * @param table {@code table} 时的价格表：规格键 → 单价（mc）
     *
     * <p>⚠️ {@code unset} = **单价待配的空位**：规则其余部分（基准维度、token 估算参数、
     * 单位分母）都配好了，只差运营填单价。它编译得过（能力行能保存），但计价必拒——
     * 「还没定价」不能等价于「免费」，见 {@code BasePriceResolver.Unset}。
     */
    public record BasePrice(
            String kind,
            Long value,
            List<String> by,
            Map<String, Long> table
    ) {}

    /**
     * 折扣策略（折扣规则本身在两张独立 live 表，不在这里）。
     *
     * @param stackMode    {@code multiply}（默认，会员再享活动）| {@code best}（两者取优）
     * @param floorFactorBp 底线，10000 = 不打折。最低不低于它，防配错亏本
     */
    public record DiscountPolicy(String stackMode, Integer floorFactorBp) {

        public static final String MULTIPLY = "multiply";
        public static final String BEST = "best";

        public String stackModeOrDefault() {
            return stackMode == null || stackMode.isBlank() ? MULTIPLY : stackMode;
        }

        public int floorFactorBpOrDefault() {
            return floorFactorBp == null ? 3_000 : floorFactorBp;
        }
    }
}
