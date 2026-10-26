package com.bluewhale.billing.domain.pricing;

public sealed interface ContractSource {

    record SpecKey(String key) implements ContractSource {

        public SpecKey {
            if (key == null || key.isBlank()) {
                throw new IllegalArgumentException("契约量的规格键必填");
            }
        }
    }
}
