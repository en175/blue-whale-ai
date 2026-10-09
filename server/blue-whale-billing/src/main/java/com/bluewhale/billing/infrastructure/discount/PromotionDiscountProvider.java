package com.bluewhale.billing.infrastructure.discount;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.infrastructure.persistence.po.PromotionEntity;
import com.bluewhale.billing.infrastructure.persistence.mapper.PromotionMapper;
import com.bluewhale.billing.domain.discount.DiscountProvider;
import com.bluewhale.billing.domain.discount.Patterns;
import com.bluewhale.billing.domain.pricing.PricingContext;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;

@Component
public class PromotionDiscountProvider extends DiscountProvider.Abstract<PromotionDiscountProvider.Row> {

    private final PromotionMapper mapper;

    public PromotionDiscountProvider(PromotionMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public String source() {
        return "promotion";
    }

    public record Row(
            long id,
            String code,
            int discountBp,
            List<String> modelPatterns,
            List<String> taskPatterns,
            Set<Integer> daysOfWeek,
            LocalTime dailyStart,
            LocalTime dailyEnd,
            Set<String> tierScope
    ) implements Candidate {
        @Override public boolean enabled() { return true; }
    }

    @Override
    protected List<Row> loadCandidates(PricingContext ctx) {
        LocalDateTime submitAt = ctx.submitAt();
        List<PromotionEntity> rows = mapper.selectList(new LambdaQueryWrapper<PromotionEntity>()
                .eq(PromotionEntity::getStatus, "enabled")
                .le(PromotionEntity::getStartAt, submitAt)
                .gt(PromotionEntity::getEndAt, submitAt));

        return rows.stream()
                .map(entity -> new Row(
                        entity.getId(),
                        entity.getCode(),
                        entity.getDiscountBp(),
                        PatternJson.stringList(entity.getModelIds()),
                        PatternJson.stringList(entity.getTaskTypes()),
                        parseIntSet(entity.getDaysOfWeek()),
                        entity.getDailyTimeStart(),
                        entity.getDailyTimeEnd(),
                        parseStringSet(entity.getTierScope())))
                .toList();
    }

    @Override
    protected boolean matchesScope(Row row, PricingContext ctx) {
        if (Patterns.isRestricted(row.tierScope()) && !row.tierScope().contains(ctx.request().tier())) {
            return false;
        }
        LocalDateTime local = ctx.submitAt();
        if (Patterns.isRestricted(row.daysOfWeek())
                && !row.daysOfWeek().contains(local.getDayOfWeek().getValue())) {
            return false;
        }
        if (row.dailyStart() == null || row.dailyEnd() == null) {
            return true;
        }
        return inWindow(local.toLocalTime(), row.dailyStart(), row.dailyEnd());
    }

    static boolean inWindow(LocalTime now, LocalTime start, LocalTime end) {
        if (!start.isAfter(end)) {
            return !now.isBefore(start) && now.isBefore(end);
        }
        return !now.isBefore(start) || now.isBefore(end);
    }


    private Set<String> parseStringSet(String jsonText) {
        return Set.copyOf(PatternJson.stringList(jsonText));
    }

    private Set<Integer> parseIntSet(String jsonText) {
        return Set.copyOf(PatternJson.intList(jsonText));
    }
}
