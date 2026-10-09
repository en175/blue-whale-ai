package com.bluewhale.billing.application;

import com.bluewhale.billing.domain.catalog.CatalogDocument;
import com.bluewhale.billing.domain.pricing.BasePriceResolver;
import com.bluewhale.billing.domain.pricing.CompiledRule;
import com.bluewhale.billing.domain.pricing.PricingKeys;
import com.bluewhale.billing.domain.pricing.RoundingPolicy;
import com.bluewhale.billing.domain.pricing.TokenEstimator;
import com.bluewhale.billing.domain.pricing.UsageDim;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.Map;

public final class CatalogCompiler {

    private static final ObjectMapper SNAPSHOT_JSON = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private CatalogCompiler() {}

    public static void validate(CatalogDocument doc) {
        if (doc.schemaVersion() != CatalogDocument.SUPPORTED_SCHEMA_VERSION) {
            throw new CompileException("不支持的 schemaVersion=" + doc.schemaVersion()
                    + "（本服务支持 " + CatalogDocument.SUPPORTED_SCHEMA_VERSION + "）");
        }
        compileCreditsPerYuan(doc.creditsPerYuan());
    }

    public static CompiledRule compileRuleSnapshot(String ruleJson) {
        CatalogDocument.TaskRule rule;
        try {
            rule = SNAPSHOT_JSON.readValue(ruleJson, CatalogDocument.TaskRule.class);
        } catch (Exception e) {
            throw new CompileException("规则快照解析失败（它应当是一条规则的 JSON 对象）："
                    + e.getMessage(), e);
        }
        try {
            return compileRule(rule);
        } catch (CompileException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new CompileException("规则快照编译失败：" + e.getMessage(), e);
        }
    }

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
            case "unset" -> new BasePriceResolver.Unset();
            default -> throw new CompileException(
                    "未知的 basePrice.kind=" + kind + "（合法值：const | table | unset）");
        };
    }

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
            dims.put(UsageDim.of(entry.getKey()), entry.getValue());
        }
        return Map.copyOf(dims);
    }

    private static RoundingPolicy compileRounding(String rounding) {
        String value = rounding == null || rounding.isBlank() ? "halfUp" : rounding.trim();
        return switch (value) {
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

    public static class CompileException extends RuntimeException {
        public CompileException(String message) {
            super(message);
        }

        public CompileException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
