package com.bluewhale.billing.application.view;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

public record PromotionView(
        long id,
        String code,
        String name,
        int discountBp,
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
        int priority,
        String createdBy,
        LocalDateTime gmtCreate,
        LocalDateTime gmtModified
) {}
