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
 * <h2>为什么公式在代码里、参数在规则里</h2>
 *
 * {@code divisor} / {@code fps} / {@code minimumTokens} / 「输入时长的规格键」都是
 * **运营可能改的数**（火山改口径、调帧率、补上输入时长那一项），所以它们放在规则的
 * {@code tokenEstimate} 里（随规则快照冻进预留行）。本类只固定公式的**形状**，
 * 不含任何具体数值。
 *
 * <p>⚠️ 而**输出宽高不在其中**：那是**模型的像素属性**，住在能力行的
 * {@code features.video_dimensions} 里，由接纳侧按规格解析后冻成
 * {@link #OUTPUT_WIDTH_KEY} / {@link #OUTPUT_HEIGHT_KEY} 两个标量随 Hold 过来。
 * 像素是「这个模型长什么样」，帧率与除数是「我们怎么把它折算成钱」——两者不同类，
 * 所以不放在同一处（对照图片侧：像素在能力行 {@code request_mapping.matrix}，
 * 单价与公式参数在规则里）。
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
 * 等火山给出音频口径，再作为**规则参数**补进来（而不是在代码里加一个魔数）。
 *
 * <p>⚠️ 规格里取不到冻结的输出宽高时返回 {@code null}（＝这次推不出），
 * **不降级为 0、也不兜一个别的尺寸**：按 0 计价只会冻到下限，差额由平台承担且账面无信号；
 * 兜一个别的尺寸是按另一个档位收钱。两者都比如实报告「取不到」更坏。
 *
 * <h2>最低 token 用量（官方明文规则，本类实现）</h2>
 *
 * 火山原文：<i>「对于 Seedance 2.0 系列、Seedance 2.5 模型，<b>当输入包含视频时</b>，
 * 存在最低 token 用量限制：如果估算 token 用量 ＜ 最低 token 用量，
 * 则按最低 token 用量计算视频价格。最低 token 用量与分辨率、宽高比、视频输出时长有关。」</i>
 *
 * <p>所以它是**含视频输入那一档才生效的下限**，且只作用在**估算**上（官方原文用的就是
 * 「估算 token 用量」）——见 {@code minimumTokensFor} 与 {@link #estimateVideoTokens}。
 *
 * <p><b>它是下限，不是单价</b>：不含视频输入（{@code video=0}）的任务**不受它影响**
 * （官方限定语是「当输入包含视频时」）。
 *
 * <p><b>表在规则里、机制在代码里</b>：官方那张「分辨率 × 宽高比 × 输出时长 → 最低用量」
 * 的表没有公开可抄的形态（原页只给了两张飞书表格链接），所以规则的 {@code tokenEstimate}
 * 里留了 {@code minimumTokens} 这个配置位；**没配就不做下限**。
 * 配了之后**半配必拒**：某一格查不到就是「官方会按下限收、我们按估算收」的静默少冻，
 * 与输出宽高取不到同一立场（见 {@link #estimateVideoTokens}）。
 */
public final class TokenEstimator {

    /** 一个「档位 + 比例」对应的输出宽高（像素）。 */
    public record Dimensions(long width, long height) {

        public Dimensions {
            if (width <= 0 || height <= 0) {
                throw new IllegalArgumentException("宽高必须为正：" + width + "x" + height);
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

    /**
     * 输出宽 / 高：接纳侧按能力行的像素表解析后冻结进快照的**标量**规格键。
     *
     * <p>与 {@link #VIDEO_TIER_KEY} 同性质——**跨进程的规格契约**（TS 侧冻结、Java 侧读），
     * 不是运营可调的数；能调的是那张「档位 + 比例 → 宽高」的表本身，它住在模型的
     * {@code features.video_dimensions} 里。
     */
    static final String OUTPUT_WIDTH_KEY = "output_width";

    /** 输出高，见 {@link #OUTPUT_WIDTH_KEY}。 */
    static final String OUTPUT_HEIGHT_KEY = "output_height";

    private final long divisor;
    private final long fps;
    /**
     * 输入视频时长（秒）在规格里的键；{@code null} = 公式**不含**输入时长那一项。
     */
    private final String inputSecondsKey;
    /**
     * 已规范化的「分辨率 + 宽高比 + 输出时长」键 → **最低 token 用量**（含视频输入时的下限）。
     * 空表 = 本规则不做下限（官方表没有公开可抄的形态，见类注释）。
     */
    private final Map<String, Long> minimumTokens;

    public TokenEstimator(long divisor, long fps, String inputSecondsKey,
                          Map<String, Long> minimumTokens) {
        if (divisor <= 0) {
            throw new IllegalArgumentException("divisor 必须为正：" + divisor);
        }
        if (fps <= 0) {
            throw new IllegalArgumentException("fps 必须为正：" + fps);
        }
        this.divisor = divisor;
        this.fps = fps;
        this.inputSecondsKey =
                inputSecondsKey == null || inputSecondsKey.isBlank() ? null : inputSecondsKey.trim();
        this.minimumTokens = minimumTokens == null ? Map.of() : Map.copyOf(minimumTokens);
        for (var entry : this.minimumTokens.entrySet()) {
            // 0 或负的「最低用量」不是下限，是**配错**：0 等于没有下限（却看起来配了），
            // 负数会让 max() 恒取估算值 —— 两种都会让这条官方规则静默失效。
            if (entry.getValue() == null || entry.getValue() <= 0) {
                throw new IllegalArgumentException(
                        "最低 token 用量必须为正：" + entry.getKey() + " → " + entry.getValue());
            }
        }
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

    /** 规则里声明的最低 token 用量表（键已规范化）；供测试查看，不参与计价。 */
    public Map<String, Long> minimumTokens() {
        return minimumTokens;
    }

    /** 本规则配了最低 token 用量表没有。没配 = 不做下限（见类注释）。 */
    public boolean hasMinimumTokens() {
        return !minimumTokens.isEmpty();
    }

    /**
     * 本次规格对应的**最低 token 用量**（含视频输入时官方规定的下限）。
     *
     * <p>键的语法与 {@code basePrice.table} 完全同一套
     * （如 {@code resolution=480p|aspect_ratio=16:9|duration=5}），查表走
     * {@link PricingKeys#normalizeSubset}「只按本表声明过的轴匹配」。
     *
     * @return 下限；{@code null} = **这次取不到**——没配表（＝不做下限），
     *         或配了表但这一格没有（＝漏配，调用方按「推不出」处置，不当作 0 / 不当作无下限）
     */
    public Long minimumTokensFor(Map<String, String> specs) {
        if (minimumTokens.isEmpty()) {
            return null;
        }
        return minimumTokens.get(PricingKeys.normalizeSubset(specs, minimumTokens.keySet()));
    }

    /**
     * 估算一次产出的 token 数。
     *
     * @param specs         本次规格（含 {@code output_width} / {@code output_height} 等）
     * @param outputSeconds 产出时长（秒）；{@code null} / 非正 = 时长未知
     *                      （{@code duration=-1} 的自动时长就是这种），返回 {@code null}
     * @param segments      片段数（产出槽数）；{@code <= 0} 视为 1
     * @return 估算 token；时长未知、**规格里取不到冻结的输出宽高**、
     *         **含视频输入却拿不到输入时长**、或**配了最低用量表而这一格查不到**
     *         → {@code null}（＝这次推不出）
     *
     * <p>⚠️ <b>输出宽高只从规格里取，没有第二条来源</b>：它是模型的像素属性
     * （能力行的 {@code features.video_dimensions}），由接纳侧按规格解析后冻成
     * {@code output_width} / {@code output_height} 随 Hold 过来。取不到就是**推不出**，
     * 返回 {@code null} 让调用方按「契约量取不到」处置（走上限冻结或拒绝），
     * **不按 0 估、也不兜一个别的尺寸**——两者都会算出一个像那么回事的错数，而它是钱。
     *
     * <p>⚠️ <b>含视频输入时，输入时长取不到就如实返回「取不到」，不按 0 估</b>：
     * 这次任务的单价档白纸黑字写着「含视频输入」（{@code video=1}），
     * 那么按 0 计输入时长就是**明知故犯地少估**——少冻的那一截正好落进
     * 「结算实际 &gt; 预扣」那条路，由平台垫付且账面无异常。按 0 估比拒绝更坏
     * （与 {@code BasePriceResolver} 查不到规格、{@code Usage.contractFrom} 取不到契约量同一个立场）。
     *
     * <p>输入时长本身**不由本类计算**：它由规格提取侧折算成 {@link #inputSecondsKey()}
     * 指定的标量键冻结进快照（参考视频的时长在建任务时就写进 job input），
     * 本类只负责把它加进公式——公式的形状在代码里，参数（含「要不要加这一项」）在规则里。
     *
     * <p>⚠️ <b>最低 token 用量（官方明文规则）在这里生效</b>：含视频输入（{@code video=1}）
     * 且规则配了 {@code minimumTokens} 时，**逐段**取 {@code max(估算, 下限)} 再乘片段数
     * ——下限是「一条视频」的口径（官方：与分辨率、宽高比、**输出时长**有关），
     * 而片段数是并行的多条视频，按下限整体封一次会让「3 段各 5 秒」只按一条的下限兜底。
     *
     * <p>配了表而这一格查不到 → 返回 {@code null}（＝推不出），**不当作没有下限**：
     * 官方在这档会按下限收、我们按估算收，少冻的那一截同样由平台垫且账面无信号。
     * 与价格表查不到键同一个立场（漏配要吵，不要静默少收）。
     */
    public Long estimateVideoTokens(Map<String, String> specs, Long outputSeconds, long segments) {
        if (outputSeconds == null || outputSeconds <= 0) {
            return null;
        }
        Dimensions dims = dimensionsFromSpecs(specs);
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
        long perVideo = dims.width() * dims.height() * fps * (outputSeconds + inputSeconds) / divisor;
        if (hasMinimumTokens() && isVideoInput(specs)) {
            Long floor = minimumTokensFor(specs);
            if (floor == null) {
                return null;
            }
            perVideo = Math.max(perVideo, floor);
        }
        long count = segments <= 0 ? 1L : segments;
        return perVideo * count;
    }

    /**
     * 从规格里取冻结的输出宽高；两个都取不到 / 有任何一个非法 → {@code null}（＝这次推不出）。
     *
     * <p>值由接纳侧按能力行的 {@code features.video_dimensions} 解析后冻进快照，
     * 经 {@code extractSpecs} 变成字符串规格键过来（数字被 {@code String(value)} 串化）。
     *
     * <p>⚠️ <b>一个取到一个取不到时返回 null，不「凑」一个尺寸</b>：那种状态只在快照损坏
     * 或版本不匹配时出现，随便取一个（比如复用另一个值）会算出一个看起来合理的错 token 数。
     */
    private static Dimensions dimensionsFromSpecs(Map<String, String> specs) {
        Long width = positiveLongOf(specs.get(OUTPUT_WIDTH_KEY));
        Long height = positiveLongOf(specs.get(OUTPUT_HEIGHT_KEY));
        if (width == null || height == null) {
            return null;
        }
        return new Dimensions(width, height);
    }

    /** 正整数解析；非数字 / 小数 / 非正 → {@code null}。 */
    private static Long positiveLongOf(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            long value = new java.math.BigDecimal(raw.trim()).longValueExact();
            return value <= 0 ? null : value;
        } catch (NumberFormatException | ArithmeticException e) {
            return null;
        }
    }

    /** 本次是否含视频输入（规格契约键，见 {@link #VIDEO_TIER_KEY}）。 */
    private static boolean isVideoInput(Map<String, String> specs) {        return VIDEO_TIER_WITH.equalsIgnoreCase(specs.get(VIDEO_TIER_KEY));
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
     * 编译期构造：把规则里的参数规范化成运行时形态。
     *
     * <p>目前只规范化最低用量表的键（{@link PricingKeys#normalizeKey} 重拼，与
     * {@code basePrice.table} 完全同一套写法——运营不必记两套键语法，运行时也只做等值查找），
     * 并查出等价键。
     *
     * @param inputSecondsKey  输入视频时长的规格键；{@code null} / 空白 = 公式不含输入时长项
     *                         （此时含视频输入的任务预扣偏低，缺口上界 = 输入时长那一项）
     * @param rawMinimumTokens 「分辨率 + 宽高比 + 输出时长 → 最低 token 用量」的原始键值表；
     *                         {@code null} / 空 = 本规则不做下限（官方表没有公开可抄的形态）
     * @throws IllegalArgumentException 最低用量表的键不规范、出现等价键、或值不是正整数
     */
    public static TokenEstimator from(
            long divisor, long fps, String inputSecondsKey,
            Map<String, Long> rawMinimumTokens) {
        Map<String, Long> floors = new LinkedHashMap<>();
        Map<String, String> floorOriginals = new LinkedHashMap<>();
        if (rawMinimumTokens != null) {
            for (var entry : rawMinimumTokens.entrySet()) {
                String canonical = PricingKeys.normalizeKey(entry.getKey());
                String previous = floorOriginals.putIfAbsent(canonical, entry.getKey());
                if (previous != null) {
                    throw new IllegalArgumentException("最低 token 用量表存在等价键："
                            + previous + " 与 " + entry.getKey()
                            + " 规范化后都是 " + canonical + " —— 请删掉一个");
                }
                floors.put(canonical, entry.getValue());
            }
        }
        return new TokenEstimator(divisor, fps, inputSecondsKey, floors);
    }
}
