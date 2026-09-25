package com.bluewhale.billing.catalog;

import com.bluewhale.billing.pricing.BasePriceResolver;
import com.bluewhale.billing.pricing.CompiledRule;
import com.bluewhale.billing.pricing.PricingKeys;
import com.bluewhale.billing.pricing.RoundingPolicy;
import com.bluewhale.billing.pricing.UsageDim;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 把目录 JSON 编译成引擎能用的 {@link CompiledRule}。
 *
 * <p><b>编译期是唯一的校验时机</b>：维度键拼错、价格表空、上下限倒置——全在这里炸。
 * 放到运行时炸的代价是「某个模型第一次被调用时才失败」，而那时用户已经在等了。
 *
 * <p>这也是 §4.5.8「运行时消费」里那句「加载失败 → 拒绝加载，保持旧版本 + 告警」
 * 能够成立的前提：编译要么全过、要么全不过，不存在「加载了一半」。
 */
public final class CatalogCompiler {

    private CatalogCompiler() {}

    /**
     * 编译整份目录。
     *
     * @throws CompileException 任何一条规则编不过——**整份拒绝**，不部分加载
     */
    public static Map<String, CompiledRule> compile(CatalogDocument doc) {
        if (doc.schemaVersion() != CatalogDocument.SUPPORTED_SCHEMA_VERSION) {
            throw new CompileException("不支持的 schemaVersion=" + doc.schemaVersion()
                    + "（本服务支持 " + CatalogDocument.SUPPORTED_SCHEMA_VERSION + "）");
        }
        compileCreditsPerYuan(doc.creditsPerYuan());

        Map<String, CompiledRule> index = new LinkedHashMap<>();
        for (var modelEntry : doc.models().entrySet()) {
            String modelId = modelEntry.getKey();
            for (var taskEntry : modelEntry.getValue().entrySet()) {
                String taskType = taskEntry.getKey();
                String key = indexKey(modelId, taskType);
                try {
                    index.put(key, compileRule(taskEntry.getValue()));
                } catch (RuntimeException e) {
                    // 带上 (model, task) 上下文——否则运营面对「baseUnit 必填」不知道改哪一行
                    throw new CompileException("编译 " + key + " 失败：" + e.getMessage(), e);
                }
            }
        }
        if (index.isEmpty()) {
            throw new CompileException("目录里没有任何规则");
        }
        return Map.copyOf(index);
    }

    /** 引擎用的索引键。与 {@code DbCatalogLookup} 的查询键必须一致。 */
    public static String indexKey(String modelId, String taskType) {
        return modelId + "/" + taskType;
    }

    /**
     * 校验换算率 {@link CatalogDocument#creditsPerYuan()}。
     *
     * <p>它是**元 → 积分的换算率**（这个值意味着「1 元等于多少积分」），运营在前端看到的
     * 余额、以及每次生成扣的积分，都由它换算。写错的后果不是「某个模型算错价」，
     * 而是**全站口径错**，且会随 job 冻结的版本一直复现——所以放在编译期拒绝，
     * 与其它配置错误同一个时机、同一个粒度（整份拒绝，不部分加载）。
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

    static CompiledRule compileRule(CatalogDocument.TaskRule rule) {
        if (rule == null) {
            throw new CompileException("规则为空");
        }

        UsageDim baseUnit = UsageDim.of(requireNonBlank(rule.baseUnit(), "baseUnit"));
        BasePriceResolver basePrice = compileBasePrice(rule.basePrice());

        return new CompiledRule(
                baseUnit,
                basePrice,
                compileDims(rule.dims()),
                compileDims(rule.multipliers()),
                rule.unitDenominator() == null ? 1L : rule.unitDenominator(),
                rule.minCredits() == null ? 1L : rule.minCredits(),
                rule.maxCredits(),
                compileRounding(rule.rounding()));
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
                    throw new CompileException("basePrice.kind=table 时必须给非空 table");
                }
                yield new BasePriceResolver.Table(normalizeTable(price.table()));
            }
            default -> throw new CompileException(
                    "未知的 basePrice.kind=" + kind + "（合法值：const | table）");
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
            // UsageDim.of 在键拼错时抛 UnknownUsageDimException —— 加载期拒绝，不进运行期
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

    /** 供测试与文档用：这份目录声明的全部 (model, task)。 */
    public static List<String> declaredKeys(CatalogDocument doc) {
        return doc.models().entrySet().stream()
                .flatMap(m -> m.getValue().keySet().stream().map(t -> indexKey(m.getKey(), t)))
                .sorted()
                .toList();
    }
}
