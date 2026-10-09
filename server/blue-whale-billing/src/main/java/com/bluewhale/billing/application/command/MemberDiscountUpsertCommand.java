package com.bluewhale.billing.application.command;

import com.bluewhale.billing.domain.discount.DiscountRules;

public record MemberDiscountUpsertCommand(
        String tier,
        String modelPattern,
        String taskPattern,
        Integer discountBp,
        Integer priority,
        String status
) {
    public MemberDiscountUpsertCommand {
        tier = DiscountRules.tier(tier);
        modelPattern = DiscountRules.pattern(modelPattern, 128, "模型匹配");
        taskPattern = DiscountRules.pattern(taskPattern, 64, "任务匹配");
        discountBp = DiscountRules.discountBp(discountBp);
        priority = DiscountRules.priority(priority);
        status = DiscountRules.memberStatus(status);
    }
}
