package com.bluewhale.billing.pricing;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 视频 token 估算器 —— 火山（方舟）官方 token 计费公式的运行时形态。
 *
 * <h2>公式</h2>
 *
 * <pre>
 *   估算 token ≈ 输出宽 × 输出高 × 输出帧率 × (输出时长 + 输入时长) ÷ divisor   （× 片段数）
 * </pre>
 *
 * <p>无视频输入 / 参考时输入时长按 0（官方口径：无视频输入时输入时长按 0 计）。
 * 含视频输入时官方要加「输入时长」那一项——本类的输入时长来自
 * {@link #inputSecondsKey()} 指的那个**规格键**（规格提取侧折算出来的参考视频时长之和），
 * <b>不是</b>本类自己算的，见 {@code estimateVideoTokens} 的 ⚠️。
 *
 * <h2>为什么它只服务预扣</h2>
 *
 * token 数的**权威来源是上游返回**（{@code usage.total_tokens}，不可用时回退
 * {@code usage.completion_tokens}），worker 在终态事件里上报它，结算按它计价。
 * 本估算**只**用于提交时刻冻一个上限——两者混起来就是「预扣用什么、结算也用什么」，
 * 等于把估算误差变成真实收费误差（《计费逻辑详细设计》§4.5 计费准确四规则）。
 *
 * <h2>为什么公式在代码里、参数在目录里</h2>
 *
 * {@code divisor} / {@code fps} / 「档位 + 比例 → 宽高」三样都是**运营可能改的数**
 * （火山改口径、开新档位、调帧率），所以它们放在定价目录的 {@code tokenEstimate} 里，
 * 与目录一起版本化、一起回滚。本类只固定公式的**形状**，不含任何具体数值。
 *
 * <h2>⚠️ 已知偏差：带音频的任务会低估（**刻意接受，不补系数**）</h2>
 *
 * 实测（job 1925，seedance-2.0 / 480p 16:9 / 输出 5s + 参考视频 5s）：
 * 公式估 97,200，上游真值 <b>100,858</b>（+3.8%）。差异主要来自**原生音频**——
 * Seedance 生成音频时 token 会多一些。
 *
 * <p><b>不补音频项的理由</b>：火山的计费文档里，2.0 / 2.5 **没有**给出音频的独立口径
 * （只有 1.5-pro 是按「有声 / 无声」分**单价**的，那是另一套模型）；三次实测的偏移比例也
 * 不一致（720p 16:9 10s +0.4%、480p 16:9 5s +4.2%、480p 16:9 5s+输入 5s +3.8%），
 * 任何单一系数都是编的。**编一个系数比不补更坏**：
 * 它与官方口径无关，却会被当成「已经算准了」，日后口径公布时也没人知道要改它。
 *
 * <p><b>代价落在哪</b>：低估 ⇒ 预扣冻得比实际少 ⇒ 少冻的那一截走「结算实际 &gt; 预扣」，
 * 由平台先垫（账上记借应收，见 {@code CreditService.settle}）。**用户不会被多收**
 * ——结算按上游真值计价，多冻的退回、少冻的补收。这是「预扣估算、结算真实」这套分工
 * 本来就允许的偏差，而不是一个待修的 bug。要收窄它只有一个正路：
 * 等火山给出音频口径，再作为**目录参数**补进来（而不是在代码里加一个魔数）。
 *
 * <p>⚠️ 目录里查不到「档位 + 比例」这一组合时返回 {@code null}（＝这次推不出），
 * **不降级为 0、也不兜一个别的档位**：按 0 计价只会冻到下限，差额由平台承担且账面无信号；
 * 兜一个别的档位是按另一个档位收钱。两者都比如实报告「取不到」更坏。
 */
public final class TokenEstimator {

    /** 一个「档位 + 比例」对应的输出宽高（像素）。 */
    public record Dimensions(long width, long height) {

        public Dimensions {
            if (width <= 0 || height <= 0) {
                throw new IllegalArgumentException("宽高必须为正：" + width + "x" + height);
            }
        }

        /**
         * 解析目录里的字面值，形如 {@code "1248x704"}。
         *
         * @throws IllegalArgumentException 格式不对——**加载期就该拒绝**，
         *         不能等到某次预扣才发现（那时用户已经在等了）
         */
        public static Dimensions parse(String raw) {
            if (raw == null) {
                throw new IllegalArgumentException("宽高不能为空");
            }
            String[] parts = raw.trim().toLowerCase(java.util.Locale.ROOT).split("x");
            if (parts.length != 2) {
                throw new IllegalArgumentException("宽高要写成 宽x高（如 1248x704），实际：" + raw);
            }
            try {
                return new Dimensions(Long.parseLong(parts[0].trim()), Long.parseLong(parts[1].trim()));
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("宽高不是整数：" + raw);
            }
        }
    }

    /**
     * 视频输入档 —— 规格提取侧**恒定产出**的一个标量键
     * （{@code billing-specs.ts} 的 {@code VIDEO_TIER_KEY} 与 worker 的
     * {@code SettlementUsageLines.VIDEO_TIER} 三处逐字一致）。
     *
     * <p>火山把「输入不含视频 / 输入包含视频」这两档写作 {@code video0} / {@code video1}；
     * 本仓的规格键语法是「轴=值」，所以规格里是 {@code video=0} / {@code video=1}。
     *
     * <p>它同时是单价档的定价轴，所以本类读它来判「这次该不该加输入时长那一项」——
     * 与 {@link #inputSecondsKey()} 是两个不同的键：前者是「哪一档」，后者是「有多长」。
     * 名字写死在这里而不是进目录：它是**跨进程的规格契约**（预扣侧 TS、结算侧 Java 都按它产），
     * 不是一个运营可调的定价数；能调的是「要不要用它」——即 {@code inputSecondsKey} 配不配。
     */
    static final String VIDEO_TIER_KEY = "video";

    /** 含视频输入那一档的取值（另一档是 {@code "0"}）。 */
    static final String VIDEO_TIER_WITH = "1";

    private final long divisor;
    private final long fps;
    /** 已规范化的「档位 + 比例」键 → 宽高（规范化见 {@link PricingKeys#normalizeKey}）。 */
    private final Map<String, Dimensions> dimensions;
    /**
     * 输入视频时长（秒）在规格里的键；{@code null} = 公式**不含**输入时长那一项。
     */
    private final String inputSecondsKey;

    public TokenEstimator(long divisor, long fps, Map<String, Dimensions> dimensions) {
        this(divisor, fps, dimensions, null);
    }

    public TokenEstimator(long divisor, long fps, Map<String, Dimensions> dimensions,
                          String inputSecondsKey) {
        if (divisor <= 0) {
            throw new IllegalArgumentException("divisor 必须为正：" + divisor);
        }
        if (fps <= 0) {
            throw new IllegalArgumentException("fps 必须为正：" + fps);
        }
        if (dimensions == null || dimensions.isEmpty()) {
            throw new IllegalArgumentException("tokenEstimate 的尺寸表不能为空");
        }
        this.divisor = divisor;
        this.fps = fps;
        this.dimensions = Map.copyOf(dimensions);
        this.inputSecondsKey =
                inputSecondsKey == null || inputSecondsKey.isBlank() ? null : inputSecondsKey.trim();
    }

    /** 目录里声明的尺寸表（键已规范化）；供管理端与测试查看，不参与计价。 */
    public Map<String, Dimensions> dimensions() {
        return dimensions;
    }

    public long divisor() {
        return divisor;
    }

    public long fps() {
        return fps;
    }

    /** 输入视频时长的规格键；{@code null} = 本估算器不含输入时长那一项。 */
    public String inputSecondsKey() {
        return inputSecondsKey;
    }

    /**
     * 估算一次产出的 token 数。
     *
     * @param specs         本次规格（含 {@code resolution} / {@code aspect_ratio} 等定价轴）
     * @param outputSeconds 产出时长（秒）；{@code null} / 非正 = 时长未知
     *                      （{@code duration=-1} 的自动时长就是这种），返回 {@code null}
     * @param segments      片段数（产出槽数）；{@code <= 0} 视为 1
     * @return 估算 token；档位 + 比例在目录里没配、时长未知、或**含视频输入却拿不到输入时长**
     *         → {@code null}（＝这次推不出）
     *
     * <p>⚠️ <b>含视频输入时，输入时长取不到就如实返回「取不到」，不按 0 估</b>：
     * 这次任务的单价档白纸黑字写着「含视频输入」（{@code video=1}），
     * 那么按 0 计输入时长就是**明知故犯地少估**——少冻的那一截正好落进
     * 「结算实际 &gt; 预扣」那条路，由平台垫付且账面无异常。按 0 估比拒绝更坏
     * （与 {@code BasePriceResolver} 查不到规格、{@code Usage.contractFrom} 取不到契约量同一个立场）。
     *
     * <p>输入时长本身**不由本类计算**：它由规格提取侧折算成 {@link #inputSecondsKey()}
     * 指定的标量键冻结进快照（参考视频的时长在建任务时就写进 job input），
     * 本类只负责把它加进公式——公式的形状在代码里，参数（含「要不要加这一项」）在目录里。
     */
    public Long estimateVideoTokens(Map<String, String> specs, Long outputSeconds, long segments) {
        if (outputSeconds == null || outputSeconds <= 0) {
            return null;
        }
        String key = PricingKeys.normalizeSubset(specs, dimensions.keySet());
        Dimensions dims = dimensions.get(key);
        if (dims == null) {
            return null;
        }
        long inputSeconds = 0L;
        if (inputSecondsKey != null && isVideoInput(specs)) {
            Long parsed = wholeSecondsOf(specs.get(inputSecondsKey));
            if (parsed == null) {
                return null;
            }
            inputSeconds = parsed;
        }
        long count = segments <= 0 ? 1L : segments;
        return dims.width() * dims.height() * fps * (outputSeconds + inputSeconds) / divisor * count;
    }

    /** 本次是否含视频输入（规格契约键，见 {@link #VIDEO_TIER_KEY}）。 */
    private static boolean isVideoInput(Map<String, String> specs) {
        return VIDEO_TIER_WITH.equalsIgnoreCase(specs.get(VIDEO_TIER_KEY));
    }

    /**
     * 规格里的秒数 → 整数秒；取不到 / 不是整数 → {@code null}。
     *
     * <p>与 {@code Usage.contractQuantity} 同口径：{@code "5.0"} 收（就是 5 秒），
     * {@code "5.5"} 拒——**不截断**，截断成 5 就是少估。
     */
    private static Long wholeSecondsOf(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            long value = new java.math.BigDecimal(raw.trim()).longValueExact();
            return value < 0 ? null : value;
        } catch (NumberFormatException | ArithmeticException e) {
            return null;
        }
    }

    /**
     * 编译期构造：把目录里的字面尺寸表（{@code "resolution=480p|aspect_ratio=16:9" → "864x480"}）
     * 规范化并解析成运行时形态。
     *
     * <p>键用 {@link PricingKeys#normalizeKey} 重新拼装，与 {@code basePrice.table} 完全同一套写法
     * ——运营不必记两套键语法，运行时也只做等值查找。
     *
     * @throws IllegalArgumentException 键不规范、值不是宽x高、或两个键规范化后等价
     */
    public static TokenEstimator from(
            long divisor, long fps, Map<String, String> rawDimensions) {
        return from(divisor, fps, rawDimensions, null);
    }

    /**
     * 编译期构造（含输入时长那一项的配置）。
     *
     * @param inputSecondsKey 输入视频时长的规格键；{@code null} / 空白 = 公式不含输入时长项
     *                        （此时含视频输入的任务预扣偏低，缺口上界 = 输入时长那一项）
     */
    public static TokenEstimator from(
            long divisor, long fps, Map<String, String> rawDimensions, String inputSecondsKey) {
        Map<String, Dimensions> normalized = new LinkedHashMap<>();
        Map<String, String> originals = new LinkedHashMap<>();
        for (var entry : rawDimensions.entrySet()) {
            String canonical = PricingKeys.normalizeKey(entry.getKey());
            String previous = originals.putIfAbsent(canonical, entry.getKey());
            if (previous != null) {
                throw new IllegalArgumentException("尺寸表存在等价键：" + previous + " 与 " + entry.getKey()
                        + " 规范化后都是 " + canonical + " —— 请删掉一个");
            }
            normalized.put(canonical, Dimensions.parse(entry.getValue()));
        }
        return new TokenEstimator(divisor, fps, normalized, inputSecondsKey);
    }
}
