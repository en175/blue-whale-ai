package com.bluewhale.billing.domain.pricing;

import java.time.LocalDateTime;

public record PricingContext(
        CompiledRule rule,
        PricingRequest request,
        Usage usage,
        LocalDateTime submitAt
) {

    public PricingContext {
        if (rule == null) throw new IllegalArgumentException("rule 必填");
        if (request == null) throw new IllegalArgumentException("request 必填");
        if (usage == null) throw new IllegalArgumentException("usage 必填");
        if (submitAt == null) throw new IllegalArgumentException("submitAt 必填（折扣判定按提交时刻）");
    }

    public java.util.Map<String, String> specs() {
        return request.specs();
    }
}
