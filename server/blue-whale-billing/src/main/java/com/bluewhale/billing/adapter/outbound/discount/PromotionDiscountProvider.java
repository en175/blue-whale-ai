package com.bluewhale.billing.adapter.outbound.discount;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.adapter.outbound.persistence.entity.PromotionEntity;
import com.bluewhale.billing.adapter.outbound.persistence.mapper.PromotionMapper;
import com.bluewhale.billing.domain.discount.DiscountProvider;
import com.bluewhale.billing.domain.discount.Patterns;
import com.bluewhale.billing.domain.pricing.PricingContext;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Set;

/**
 * 营销活动折扣（《计费逻辑详细设计》§2.6）。
 *
 * <p>在基类的过滤链上**多加一层时段匹配**（周几 + 每日时段 + 时区），
 * 以及等级范围。这是它与会员折扣的差别，也是它做成子类而非另一套逻辑的理由。
 *
 * <p><b>时间判定用 {@code ctx.submitAt}（提交时刻）</b>：
 * 否则会出现「提交时看到 7 折、结算时活动结束变原价」。
 * 结算根本不走这里——它按 job 冻结的定价快照复现。
 */
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
            /** 生效星期 [1..7]；null/空 = 每天 */
            Set<Integer> daysOfWeek,
            /** 每日时段；两个都为 null = 全天 */
            LocalTime dailyStart,
            LocalTime dailyEnd,
            /** ⚠️ 必填（ADR-0111 北京时间口径）：不写时区，跨零点时段必然算错 */
            String tz,
            /** 适用等级；null/空 = 不限 */
            Set<String> tierScope
    ) implements Candidate {
        @Override public boolean enabled() { return true; }  // enabled 由 SQL 过滤

        /** ⚠️ 时区必填（ADR-0111 北京时间口径）。库里给了默认值，这里再兜一次防脏数据。 */
        String tzOrDefault() {
            return tz == null || tz.isBlank() ? "Asia/Shanghai" : tz;
        }
    }

    @Override
    protected List<Row> loadCandidates(PricingContext ctx) {
        // ⚠️ 时间窗只是**粗筛**（走 idx_promo__active），但**时区无法在 SQL 里处理**——
        //    MySQL 的 NOW() 用会话时区，而活动自带 tz。「现在是否落在时段内」
        //    必须留给 matchesScope 按活动自己的时区判定。
        LocalDateTime submitAt = DbTime.toDb(ctx.submitAt());
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
                        entity.getTz(),
                        parseStringSet(entity.getTierScope())))
                .toList();
    }

    @Override
    protected boolean matchesScope(Row row, PricingContext ctx) {
        // ① 等级范围：没配 = 不限；配了则必须包含本次用户等级
        if (Patterns.isRestricted(row.tierScope()) && !row.tierScope().contains(ctx.request().tier())) {
            return false;
        }
        // ② 时段：全部按**活动自己的时区**换算
        ZonedDateTime local = ctx.submitAt().atZone(ZoneId.of(row.tzOrDefault()));
        if (Patterns.isRestricted(row.daysOfWeek())
                && !row.daysOfWeek().contains(local.getDayOfWeek().getValue())) {
            return false;
        }
        if (row.dailyStart() == null || row.dailyEnd() == null) {
            return true;   // 没配时段 = 全天
        }
        return inWindow(local.toLocalTime(), row.dailyStart(), row.dailyEnd());
    }

    /**
     * 支持跨天：{@code start} 不早于 {@code end} 时表示
     * {@code [start, 24:00) ∪ [00:00, end)}——「夜间 22:00→06:00」就是这种。
     */
    static boolean inWindow(LocalTime now, LocalTime start, LocalTime end) {
        if (!start.isAfter(end)) {
            return !now.isBefore(start) && now.isBefore(end);
        }
        return !now.isBefore(start) || now.isBefore(end);
    }

    // ── JSON 列解析。⚠️ 解析实现已抽到 {@link PatternJson}：管理端要从同一列推出
    //    「这条活动限了哪些模型」，两处各写一份解析必然有一天对不上（界面上显示限了 3 个，
    //    计价侧当成不限）。配置坏了不该让整次计价崩，但也不能静默放行：记 WARN + 当作「没配」。 ──

    private Set<String> parseStringSet(String jsonText) {
        return Set.copyOf(PatternJson.stringList(jsonText));
    }

    private Set<Integer> parseIntSet(String jsonText) {
        return Set.copyOf(PatternJson.intList(jsonText));
    }
}
