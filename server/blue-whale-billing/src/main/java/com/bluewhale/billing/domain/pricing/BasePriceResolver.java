package com.bluewhale.billing.domain.pricing;

import java.util.Map;

public sealed interface BasePriceResolver
        permits BasePriceResolver.Constant, BasePriceResolver.Table, BasePriceResolver.Unset {

    long resolve(Map<String, String> specs);

    record Constant(long mc) implements BasePriceResolver {
        @Override
        public long resolve(Map<String, String> specs) {
            return mc;
        }
    }

    record Table(Map<String, Long> table) implements BasePriceResolver {

        public Table {
            if (table == null || table.isEmpty()) {
                throw new IllegalArgumentException("按轴查表的定价不能为空表");
            }
        }

        @Override
        public long resolve(Map<String, String> specs) {
            String key = PricingKeys.normalizeSubset(specs, table.keySet());
            Long price = table.get(key);
            if (price == null) {
                throw new UnpriceableSpecException(key);
            }
            return price;
        }
    }

    record Unset() implements BasePriceResolver {

        @Override
        public long resolve(Map<String, String> specs) {
            throw new UnpriceableSpecException(
                    "<单价待配>", "该模型的单价还没填 —— 能力行里这条规则的 basePrice 是空位"
                            + "（kind=unset）。请运营在管理端的「模型计费」页填上单价并保存；"
                            + "在此之前本模型的提交会被拒绝，**不会**按 0 免费");
        }
    }

    class UnpriceableSpecException extends RuntimeException {
        private final String normalizedKey;

        public UnpriceableSpecException(String normalizedKey) {
            this(normalizedKey, "该规格组合未配置价格：" + normalizedKey);
        }

        protected UnpriceableSpecException(String normalizedKey, String message) {
            super(message);
            this.normalizedKey = normalizedKey;
        }

        public String normalizedKey() {
            return normalizedKey;
        }
    }
}
