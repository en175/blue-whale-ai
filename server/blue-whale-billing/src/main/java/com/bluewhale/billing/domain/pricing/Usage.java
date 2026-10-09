package com.bluewhale.billing.domain.pricing;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public record Usage(
        String modelId,
        String taskType,
        Map<UsageDim, Long> quantities
) {

    public Usage {
        quantities = quantities == null ? Map.of() : Map.copyOf(quantities);
    }

    public static Usage of(UsageDim dim, long value) {
        return new Usage(null, null, Map.of(dim, value));
    }

    public static Usage ofKeys(String modelId, String taskType, Map<String, Long> quantitiesByKey) {
        if (quantitiesByKey == null || quantitiesByKey.isEmpty()) {
            return new Usage(modelId, taskType, Map.of());
        }
        Map<UsageDim, Long> byDim = new LinkedHashMap<>();
        quantitiesByKey.forEach((key, value) -> byDim.put(UsageDim.of(key), value));
        return new Usage(modelId, taskType, byDim);
    }

    public static Usage empty() {
        return new Usage(null, null, Map.of());
    }

    public static Usage contractFrom(CompiledRule rule, Map<String, String> specs) {
        Map<UsageDim, Long> fromSpecs = new LinkedHashMap<>();
        List<UsageDim> estimatedDims = new ArrayList<>();
        for (UsageDim dim : UsageDim.values()) {
            if (dim.contractSource() instanceof ContractSource.Estimated) {
                estimatedDims.add(dim);
                continue;
            }
            Long quantity = contractQuantity(dim, specs);
            if (quantity != null) {
                fromSpecs.put(dim, quantity);
            }
        }
        for (UsageDim dim : estimatedDims) {
            Long quantity = estimatedQuantity(dim, rule, specs, fromSpecs);
            if (quantity != null) {
                fromSpecs.put(dim, quantity);
            }
        }
        if (rule.baseUnit() != UsageDim.CONSTANT_ONE && !fromSpecs.containsKey(rule.baseUnit())) {
            throw new ContractQuantityUnavailableException(rule.baseUnit(), specs);
        }
        return new Usage(null, null, fromSpecs);
    }

    private static Long contractQuantity(UsageDim dim, Map<String, String> specs) {
        ContractSource source = dim.contractSource();
        if (!(source instanceof ContractSource.SpecKey specKey)) {
            return null;
        }
        String raw = specs.get(specKey.key());
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            long value = new BigDecimal(raw.trim()).longValueExact();
            return value < 0 ? null : value;
        } catch (NumberFormatException | ArithmeticException e) {
            return null;
        }
    }

    private static Long estimatedQuantity(UsageDim dim, CompiledRule rule,
                                          Map<String, String> specs, Map<UsageDim, Long> direct) {
        return switch (dim) {
            case COMPLETION_TOKENS -> rule.tokenEstimator() == null
                    ? null
                    : rule.tokenEstimator().estimateVideoTokens(
                            specs,
                            direct.get(UsageDim.SECONDS),
                            direct.getOrDefault(UsageDim.SUCCEEDED_SLOTS, 1L));
            default -> throw new IllegalStateException(
                    "维度 " + dim.key() + " 登记为估算来源，但 estimatedQuantity 没有实现它");
        };
    }

    public static class ContractQuantityUnavailableException extends RuntimeException {

        public ContractQuantityUnavailableException(UsageDim baseUnit, Map<String, String> specs) {
            super("预扣算不出上限：" + baseUnit.key() + " 是本规则的基准维度，而"
                    + (baseUnit.contractSource() == null
                            ? "它在提交时刻没有契约量来源"
                            : "它在提交时刻的契约量这次取不到"
                                    + "（" + describeSource(baseUnit.contractSource()) + "）")
                    + "（本次规格键：" + specs.keySet() + "）"
                    + " —— 按 0 计价只会冻到下限，差额由平台承担，故拒绝");
            this.baseUnit = baseUnit;
        }

        private static String describeSource(ContractSource source) {
            return switch (source) {
                case ContractSource.SpecKey specKey -> "读规格键 " + specKey.key();
                case ContractSource.Estimated ignored -> "按规则的 tokenEstimate 估算";
            };
        }

        private final UsageDim baseUnit;

        public UsageDim baseUnit() {
            return baseUnit;
        }
    }

    public long quantityOf(UsageDim dim) {
        return dim.quantityOf(quantities);
    }
}
