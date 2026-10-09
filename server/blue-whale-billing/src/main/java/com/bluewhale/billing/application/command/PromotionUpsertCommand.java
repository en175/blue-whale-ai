package com.bluewhale.billing.application.command;

import com.bluewhale.billing.domain.discount.DiscountRules;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

public record PromotionUpsertCommand(
        String code,
        String name,
        Integer discountBp,
        List<String> modelIds,
        List<String> taskTypes,
        List<String> tierScope,
        LocalDateTime startAt,
        LocalDateTime endAt,
        LocalTime dailyTimeStart,
        LocalTime dailyTimeEnd,
        List<Integer> daysOfWeek,
        String tz,
        String status,
        Integer priority
) {
    public PromotionUpsertCommand {
        code = DiscountRules.code(code);
        name = DiscountRules.text(name, 128, "活动名称");
        discountBp = DiscountRules.discountBp(discountBp);
        modelIds = DiscountRules.patterns(modelIds, 128, "模型范围", true);
        taskTypes = DiscountRules.patterns(taskTypes, 64, "任务类型范围", false);
        tierScope = DiscountRules.tierScope(tierScope);
        DiscountRules.window(startAt, endAt);
        DiscountRules.dailyWindow(dailyTimeStart, dailyTimeEnd);
        daysOfWeek = DiscountRules.daysOfWeek(daysOfWeek);
        tz = DiscountRules.timezone(tz);
        status = DiscountRules.promotionStatus(status);
        priority = DiscountRules.priority(priority);
    }
}
