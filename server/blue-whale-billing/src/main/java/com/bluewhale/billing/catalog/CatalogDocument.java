package com.bluewhale.billing.catalog;

import java.util.List;
import java.util.Map;

/**
 * 定价目录 JSON 的 Java 形态（《计费逻辑详细设计》§2.5.1）。
 *
 * <p>**这是 wire/存储形态，不是领域形态**——编译成 {@code CompiledRule} 后才进引擎。
 * 分成两层是因为：JSON 要容忍运营写得不规范（大小写、额外字段），
 * 而领域对象必须严格（构造即校验）。
 *
 * <p>用 record + Jackson 直接反序列化；未知字段由 {@code FAIL_ON_UNKNOWN_PROPERTIES=false}
 * 容忍（向前兼容：运营端先加字段、服务端后升级）。
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
        /** modelId → taskType → 规则 */
        Map<String, Map<String, TaskRule>> models,
        DiscountPolicy discountPolicy
) {

    public static final int SUPPORTED_SCHEMA_VERSION = 1;

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

    public CatalogDocument {
        models = models == null ? Map.of() : Map.copyOf(models);
    }

    /**
     * 单个 (model, taskType) 的计价规则。
     *
     * @param usageSemantic   仅文本/多模态用：{@code openai} | {@code claude}。本期不启用
     * @param baseUnit        ★ 基准维度键，如 {@code usage.seconds}
     * @param basePrice       ★ 基准单价：常数或按轴查表
     * @param dims            按数量加权的其他维度 → **万分比**（10000 = 1 倍，4000 = 0.4 倍）
     * @param multipliers     整单连乘的倍率 → **万分比**（12000 = 1.2 倍）
     * @param unitDenominator 「每多少个单位多少钱」：1000000 = 每百万 token，1 = 每秒/每张/每次
     * @param minCredits      下限（整数积分）
     * @param maxCredits      上限，null = 不封顶
     * @param rounding        {@code halfUp}（默认）| {@code ceil} | {@code floor}
     * @param tokenEstimate   视频按 token 计价的**预扣估算参数**；不配 = 该规则不做估算
     *                        （按 {@code usage.c} 计价就必须配，否则提交时算不出契约量）
     */
    public record TaskRule(
            String usageSemantic,
            String baseUnit,
            BasePrice basePrice,
            Map<String, Integer> dims,
            Map<String, Integer> multipliers,
            Long unitDenominator,
            Long minCredits,
            Long maxCredits,
            String rounding,
            TokenEstimate tokenEstimate
    ) {}

    /**
     * token 估算参数（火山方舟官方 token 计费公式的系数）。
     *
     * <p>为什么它必须在目录里而不是代码里：{@code divisor}、{@code fps}、
     * 「档位 + 比例 → 宽高」与「输入时长的规格键」都是**运营可能改的数**——火山改口径、
     * 开新档位、某档位换帧率、补上输入时长那一项，都只该是一次目录发布，而不是改代码发版。
     * 代码只固定公式的形状（见 {@code TokenEstimator}）。
     *
     * <p>⚠️ 它**只服务预扣**。结算按 worker 上报的**上游真实 token** 计价。
     *
     * <p>⚠️ <b>为什么同一个公式要有两条规则（2.0 与 2.5）而不是一条</b>：单价不同，
     * 而单价是 {@code basePrice} —— 它是规则自己的字段。所以「计费方式相同、单价不同」
     * 在目录里天然就是两条规则，无需另造机制；2.5 的单价火山尚未给出时，
     * 它的 {@code basePrice.kind} 写 {@code unset}（空位），提交即拒绝，**不按 0 免费**。
     *
     * @param divisor    除数字：token ≈ 宽 × 高 × 帧率 × (输出时长 + 输入时长) ÷ divisor（官方 1024）
     * @param fps        帧率（官方对照表是 24；生成任务的参数里没有帧率这个轴，
     *                   上游返回的 {@code framespersecond} 也是 24，故取官方默认）
     * @param dimensions 档位 + 比例 → 输出宽高，值写成 {@code "1248x704"}；
     *                   键的语法与 {@link BasePrice#table} 完全一致
     *                   （如 {@code "resolution=720p|aspect_ratio=16:9"}），
     *                   因而**同一套键语法、同一个管理端编辑器**——运营不必记两套写法
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
     */
    public record TokenEstimate(
            Integer divisor,
            Integer fps,
            Map<String, String> dimensions,
            String inputSecondsKey
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
     * 单位分母）都配好了，只差运营填单价。它编译得过（目录能发布），但计价必拒——
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
