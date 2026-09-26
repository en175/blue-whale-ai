package com.bluewhale.billing.catalog;

import com.bluewhale.billing.pricing.BasePriceResolver;
import com.bluewhale.billing.pricing.CompiledRule;
import com.bluewhale.billing.pricing.PricingKeys;
import com.bluewhale.billing.pricing.RoundingPolicy;
import com.bluewhale.billing.pricing.TokenEstimator;
import com.bluewhale.billing.pricing.UsageDim;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 把规则 JSON 编译成引擎能用的 {@link CompiledRule}，并校验定价目录文档。
 *
 * <p><b>编译期是唯一的校验时机</b>：维度键拼错、价格表空、上下限倒置——全在这里炸。
 * 放到运行时炸的代价是「某个模型第一次被调用时才失败」，而那时用户已经在等了。
 *
 * <p>这也是 §4.5.8「运行时消费」里那句「加载失败 → 拒绝加载，保持旧版本 + 告警」
 * 能够成立的前提：编译要么全过、要么全不过，不存在「加载了一半」。
 *
 * <p>⚠️ <b>规则不在这里按 (model, task) 索引</b>：计价规则住在模型能力行，由属主随
 * Hold / Quote 作为快照送来（{@link #compileRuleSnapshot}）。目录只装换算率与折扣策略，
 * 见 {@link CatalogDocument}。所以本类只剩两件事：校验目录（{@link #validate}）、
 * 编译一条规则（{@link #compileRuleSnapshot}）。
 */
public final class CatalogCompiler {

    /**
     * 读单条规则快照用的解析器。
     *
     * <p>与 {@code CatalogRepository} 那份同口径：**容忍未知字段**。规则快照由属主
     * （backend 的能力行）产生，它可能先我们一步多写一个字段——那是向前兼容，不是脏数据。
     * 方向不能反：服务端认识而 JSON 里缺的必填字段，由 {@link #compileRule} 的构造校验兜住。
     */
    private static final ObjectMapper SNAPSHOT_JSON = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private CatalogCompiler() {}

    /**
     * 校验整份目录 —— 发布与加载两条路上的**同一处**闸门。
     *
     * <p>目录里只剩两项：换算率（{@link #compileCreditsPerYuan} 校验）与折扣策略
     * （它有 {@code orDefault} 兜底，配错不会算出错价，故不做校验）。
     * 校验不通过就抛，**整份拒绝**，不部分生效。
     *
     * @throws CompileException schemaVersion 不认识，或换算率不合法
     */
    public static void validate(CatalogDocument doc) {
        if (doc.schemaVersion() != CatalogDocument.SUPPORTED_SCHEMA_VERSION) {
            throw new CompileException("不支持的 schemaVersion=" + doc.schemaVersion()
                    + "（本服务支持 " + CatalogDocument.SUPPORTED_SCHEMA_VERSION + "）");
        }
        compileCreditsPerYuan(doc.creditsPerYuan());
    }

    /**
     * 编译**单条规则的 JSON 快照** —— 随 Hold / Quote 请求送来的那一份。
     *
     * <p>形态与能力行的 {@code generation_model_capability.pricing} 列**逐字相同**
     * （就是 {@link CatalogDocument.TaskRule} 的 JSON），所以这里走的是
     * {@link #compileRule}，规则在两条来路上被同一套校验——不会出现
     * 「一处发得出来的规则，从另一处却能进来」。
     *
     * <p>它也是**规则唯一的编译入口**：规则不再从目录里按 (model, task) 取，
     * 「哪一版」这个问题由预留行的 {@code catalog_version} / {@code rule_snapshot} 那一列回答。
     *
     * <p>⚠️ 调用方必须把 {@link CompileException} 当作**拒单**（gRPC 的
     * INVALID_ARGUMENT / UNPRICEABLE），**不能静默放过**：写侧闸门（属主保存能力行时校验）
     * 拦的是「脏配置存不进去」，这里拦的是「脏配置已经在库里了」——两者拦的不是同一件事。
     * 放过去等于把「这个模型的规则被改坏了」变成「按另一份价静默成交」。
     *
     * @throws CompileException JSON 读不出来，或规则本身不合规（缺 baseUnit、价表空、上下限倒置…）
     */
    public static CompiledRule compileRuleSnapshot(String ruleJson) {
        CatalogDocument.TaskRule rule;
        try {
            rule = SNAPSHOT_JSON.readValue(ruleJson, CatalogDocument.TaskRule.class);
        } catch (Exception e) {
            // 读不出来 = 送来的东西不是一条规则（不是 JSON、或 JSON 但不是对象）。
            // 与「规则内容写错」不同，但处理方式一样：拒绝。只带解析器的消息，不回显原文
            // —— 快照可能很长，且它是调用方的数据（对账靠预留行里存下来的那一列）
            throw new CompileException("规则快照解析失败（它应当是一条规则的 JSON 对象）："
                    + e.getMessage(), e);
        }
        try {
            return compileRule(rule);
        } catch (CompileException e) {
            // 已经是「哪一条错了」级别的消息，不再包一层
            throw e;
        } catch (RuntimeException e) {
            // UnknownUsageDimException 这类：维度键拼错
            throw new CompileException("规则快照编译失败：" + e.getMessage(), e);
        }
    }

    /**
     * 校验换算率 {@link CatalogDocument#creditsPerYuan()}。
     *
     * <p>它是**元 → 积分的换算率**（这个值意味着「1 元等于多少积分」）。
     *
     * <p>⚠️ 它参与的是**充值**：到账积分 = 档位原价（元）× 本值（backend 的
     * {@code deriveCredits}）。**生成任务的计价不读它** —— 规则里的单价本来就是 mc，
     * 出口按固定的「1 积分 = 1000 mc」换算（{@code RoundingPolicy}），与元无关；
     * 所以改它不会动到任何一次生成的价格，也就不会影响已提交的任务。
     *
     * <p>写错的后果不是「某个模型算错价」，而是**充值口径错**（用户付同样的钱拿到的积分变了），
     * 且已下单的订单按冻结值发、新订单按新值发——所以放在编译期拒绝，
     * 与其它配置错误同一个时机、同一个粒度（整份拒绝，不部分生效）。
     *
     * <p>合法区间 {@link CatalogDocument#MIN_CREDITS_PER_YUAN} ~
     * {@link CatalogDocument#MAX_CREDITS_PER_YUAN}；上界的理由是「大到明显不合理」，
     * 不是算力限制。
     */
    private static void compileCreditsPerYuan(int creditsPerYuan) {
        if (creditsPerYuan < CatalogDocument.MIN_CREDITS_PER_YUAN
                || creditsPerYuan > CatalogDocument.MAX_CREDITS_PER_YUAN) {
            throw new CompileException("creditsPerYuan=" + creditsPerYuan
                    + " 不合法：它表示「1 元等于多少积分」，合法范围 "
                    + CatalogDocument.MIN_CREDITS_PER_YUAN + " ~ "
                    + CatalogDocument.MAX_CREDITS_PER_YUAN
                    + "（超过上界说明多半是多敲了 0）");
        }
    }

    /**
     * 快照的格式版本必须是本服务认识的那一版。
     *
     * <p>⚠️ {@code null} **放行**，按当前版本处理 —— 那是「加 schemaVersion 之前冻下的老快照」。
     * 这一条不是宽容，是**必需**：加字段那一刻，线上所有在途预留的文本里都没有它，
     * 拒掉就等于让那些钱同时结不掉（MQ 重投到死信、钱一直冻着）。
     * 真正的保护在**下一次**改语义时生效 —— 那时把
     * {@code SUPPORTED_RULE_SCHEMA_VERSION} 一加，老快照当场变成一次明确的拒单。
     *
     * @throws CompileException 版本不认识：按当前语义编译它会算出一个**看着合理但不同**的价，
     *         而且没有任何信号 —— 宁可拒，不可静默重算
     */
    private static void requireKnownRuleSchema(Integer schemaVersion) {
        if (schemaVersion == null) {
            return;
        }
        if (schemaVersion != CatalogDocument.SUPPORTED_RULE_SCHEMA_VERSION) {
            throw new CompileException(
                    "不支持的规则快照 schemaVersion=" + schemaVersion
                            + "（本服务支持 " + CatalogDocument.SUPPORTED_RULE_SCHEMA_VERSION
                            + "）。这条规则是按**另一版语义**写下的，按当前语义编译会静默算出另一个价，"
                            + "所以拒绝编译：要么补一个按该版本编译的分支，要么人工确认这条规则该怎么算。");
        }
    }

    static CompiledRule compileRule(CatalogDocument.TaskRule rule) {
        if (rule == null) {
            throw new CompileException("规则为空");
        }
        requireKnownRuleSchema(rule.schemaVersion());

        UsageDim baseUnit = UsageDim.of(requireNonBlank(rule.baseUnit(), "baseUnit"));
        BasePriceResolver basePrice = compileBasePrice(rule.basePrice());

        return new CompiledRule(
                baseUnit,
                basePrice,
                compileDims(rule.dims()),
                compileDims(rule.multipliers()),
                compileDimPrices(rule.dimPrices()),
                rule.unitDenominator() == null ? 1L : rule.unitDenominator(),
                rule.minCredits() == null ? 1L : rule.minCredits(),
                rule.maxCredits(),
                compileRounding(rule.rounding()),
                compileTokenEstimate(rule.tokenEstimate()));
    }

    /**
     * 编译「按维度的绝对加价」（参考图按张收费这类）。
     *
     * <p>缺省（绝大多数规则）返回空 map —— 那是**合法的**，也是这套改动「金额不变」的根据：
     * 空 map 时计价管线里那一行循环一次都不执行，算术与没有这个字段时逐字相同。
     *
     * <p>三条都当场拒绝，理由与 {@link #compileBasePrice} 同：编译期是唯一的校验时机，
     * 放到运行时炸的代价是「某个模型第一次被调用时才失败」，而那时用户已经在等了。
     * <ul>
     *   <li>维度键不认识 → {@link UsageDim#of} 抛（字面键拼错）</li>
     *   <li>{@code unitMc} 缺失或非正 → 拒绝。**不接受 0**：0 等于「这个维度免费」，
     *       而免费应当由「不写这个维度」表达——写一个 0 出来读的人只会当成配漏了</li>
     *   <li>{@code firstFree} 缺失 = false（不免费）。这是**唯一**允许缺省的一项，
     *       因为它有明确且安全的默认语义</li>
     * </ul>
     */
    static Map<UsageDim, CompiledRule.DimPrice> compileDimPrices(Map<String, CatalogDocument.DimPrice> raw) {
        if (raw == null || raw.isEmpty()) {
            return Map.of();
        }
        Map<UsageDim, CompiledRule.DimPrice> compiled = new LinkedHashMap<>();
        for (Map.Entry<String, CatalogDocument.DimPrice> e : raw.entrySet()) {
            UsageDim dim = UsageDim.of(e.getKey());
            CatalogDocument.DimPrice price = e.getValue();
            if (price == null || price.unitMc() == null || price.unitMc() <= 0) {
                throw new CompileException("dimPrices." + e.getKey() + " 的 unitMc 必填且为正："
                        + "它表示「每个计费单位多少 mc」，单位与 basePrice.value 相同（1 积分 = 1000 mc）。"
                        + "要让某个维度不计费，请整个不写这个维度（写 0 会被读成配漏了）");
            }
            compiled.put(dim, new CompiledRule.DimPrice(
                    price.unitMc(), Boolean.TRUE.equals(price.firstFree())));
        }
        return Map.copyOf(compiled);
    }

    /**
     * 编译 token 估算参数。
     *
     * <p>缺省（运营没配）返回 {@code null} —— 那是**合法的**：绝大多数规则不按 token 计价。
     * 配了就必须整块配全：缺 divisor / fps 都当场拒绝，
     * 因为半配的估算会算出一个「像那么回事」的数，而它是钱。
     *
     * <p>{@code inputSecondsKey} 是**可选的**：不配 = 公式不含输入时长那一项。
     * 它不像 divisor / fps 那样「缺了就估不出」——缺了只是对含视频输入的任务估得偏低，
     * 结算按真值兜住。所以这里不强制，但配了就必须是个非空的键名
     * （空白串等于「配了个查不到的键」，那是最坏的一种：看起来配了、实际永远取不到）。
     *
     * <p>{@code minimumTokens}（官方的最低 token 用量）也是**可选的**，理由同
     * {@code CatalogDocument.TokenEstimate#minimumTokens}：官方表没有公开可抄的形态，
     * 规则里留个配置位，不配 = 不做下限。配了就逐格校验（键必须规范、值必须是正整数）——
     * 半配的下限会让「官方按下限收、我们按估算收」的差额静默落进平台账。
     *
     * <p>⚠️ 宽高**不在这里**，也不该在这里：「档位 + 比例 → 输出宽高」是模型的像素属性
     * （能力行的 {@code features.video_dimensions}），由接纳侧解析后冻成
     * {@code output_width} / {@code output_height} 随 Hold 过来。本方法只管公式参数。
     *
     * <p>⚠️ 校验放在编译期（与 {@link #normalizeTable} 同一个立场）：
     * 参数写错一个数，运行时表现是「某个档位算不出 → 预扣推不出 → 拒绝提交」，
     * 那时用户已经在等了；这里拒绝则保存能力行时当场失败。
     */
    private static TokenEstimator compileTokenEstimate(CatalogDocument.TokenEstimate estimate) {
        if (estimate == null) {
            return null;
        }
        if (estimate.divisor() == null) {
            throw new CompileException("tokenEstimate.divisor 必填（官方 1024）");
        }
        if (estimate.fps() == null) {
            throw new CompileException("tokenEstimate.fps 必填（官方对照表是 24）");
        }
        if (estimate.inputSecondsKey() != null && estimate.inputSecondsKey().isBlank()) {
            throw new CompileException("tokenEstimate.inputSecondsKey 不能是空白串"
                    + "（留空等于配了个查不到的键；要「不加输入时长那一项」就整个别写这个字段）");
        }
        try {
            return TokenEstimator.from(estimate.divisor(), estimate.fps(),
                    estimate.inputSecondsKey(), estimate.minimumTokens());
        } catch (IllegalArgumentException e) {
            throw new CompileException("tokenEstimate 不合法：" + e.getMessage(), e);
        }
    }

    private static BasePriceResolver compileBasePrice(CatalogDocument.BasePrice price) {
        if (price == null) {
            throw new CompileException("basePrice 必填");
        }
        String kind = price.kind() == null ? "" : price.kind().trim();
        return switch (kind) {
            case "const" -> {
                if (price.value() == null) {
                    throw new CompileException("basePrice.kind=const 时必须给 value");
                }
                yield new BasePriceResolver.Constant(price.value());
            }
            case "table" -> {
                if (price.table() == null || price.table().isEmpty()) {
                    throw new CompileException("basePrice.kind=table 时必须给非空 table"
                            + "（「单价还没定」请显式写 kind=unset，见 CatalogDocument.BasePrice 的说明）");
                }
                yield new BasePriceResolver.Table(normalizeTable(price.table()));
            }
            // 单价待配：规则里显式留的空位。**编译期合法**（能力行存得进去），
            // 但计价时拒绝——见 BasePriceResolver.Unset 的注释（按 0 等于免费，比拒绝更坏）。
            case "unset" -> new BasePriceResolver.Unset();
            default -> throw new CompileException(
                    "未知的 basePrice.kind=" + kind + "（合法值：const | table | unset）");
        };
    }

    /**
     * 表键**在编译期规范化**——运行时只做等值查找。
     *
     * <p>顺手查重：{@code "Size=2K"} 与 {@code "size=2k"} 规范化后是同一个键，
     * 若同时出现说明运营重复配置且值可能不同，**必须报错而不是悄悄覆盖**。
     */
    static Map<String, Long> normalizeTable(Map<String, Long> raw) {
        Map<String, Long> normalized = new LinkedHashMap<>();
        Map<String, String> originals = new LinkedHashMap<>();
        for (var entry : raw.entrySet()) {
            String canonical = PricingKeys.normalizeKey(entry.getKey());
            String previous = originals.putIfAbsent(canonical, entry.getKey());
            if (previous != null) {
                throw new CompileException("价格表存在等价键：" + previous + " 与 " + entry.getKey()
                        + " 规范化后都是 " + canonical + " —— 请删掉一个");
            }
            normalized.put(canonical, entry.getValue());
        }
        return Map.copyOf(normalized);
    }

    private static Map<UsageDim, Integer> compileDims(Map<String, Integer> raw) {
        if (raw == null || raw.isEmpty()) {
            return Map.of();
        }
        Map<UsageDim, Integer> dims = new LinkedHashMap<>();
        for (var entry : raw.entrySet()) {
            // UsageDim.of 在键拼错时抛 UnknownUsageDimException —— 编译期拒绝，不进运行期
            dims.put(UsageDim.of(entry.getKey()), entry.getValue());
        }
        return Map.copyOf(dims);
    }

    private static RoundingPolicy compileRounding(String rounding) {
        String value = rounding == null || rounding.isBlank() ? "halfUp" : rounding.trim();
        return switch (value) {
            // 默认四舍五入：中性，且让折扣更容易生效（让利 &gt; 0.5 积分即可，ceil 要 ≥ 1）
            case "halfUp" -> new RoundingPolicy.HalfUp();
            case "ceil" -> new RoundingPolicy.Ceil();
            case "floor" -> new RoundingPolicy.Floor();
            default -> throw new CompileException("未知的 rounding=" + value + "（合法值：halfUp | ceil | floor）");
        };
    }

    private static String requireNonBlank(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new CompileException(field + " 必填");
        }
        return value;
    }

    /** 目录编不过——**整份拒绝**，调用方应保持旧版本并告警。 */
    public static class CompileException extends RuntimeException {
        public CompileException(String message) {
            super(message);
        }

        public CompileException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
