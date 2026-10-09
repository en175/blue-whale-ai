package com.bluewhale.billing.application.view;

import java.time.LocalDateTime;

public record MemberDiscountView(
        long id,
        String tier,
        String modelPattern,
        String taskPattern,
        int discountBp,
        int priority,
        String status,
        LocalDateTime gmtCreate,
        LocalDateTime gmtModified
) {}
