package com.bluewhale.billing.adapter.outbound.discount;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.adapter.outbound.persistence.entity.MemberDiscountEntity;
import com.bluewhale.billing.adapter.outbound.persistence.mapper.MemberDiscountMapper;
import com.bluewhale.billing.domain.discount.DiscountProvider;
import com.bluewhale.billing.domain.pricing.PricingContext;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 会员等级折扣（《计费逻辑详细设计》§2.7）。
 *
 * <p>它是**长期契约**（用户买了会员就该享受），不是活动——所以与营销活动分表、
 * 没有起止时间、保存即生效。
 *
 * <p>命中条件：{@code status='enabled'} 且 {@code tier} 匹配 且 model/task 模式匹配。
 * **多条命中由基类取折扣最大的一条，不叠加。**
 */
@Component
public class MemberDiscountProvider extends DiscountProvider.Abstract<MemberDiscountProvider.Row> {

    private final MemberDiscountMapper mapper;

    public MemberDiscountProvider(MemberDiscountMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public String source() {
        return "member";
    }

    /**
     * @param modelPatterns 单元素列表——会员折扣表是「一行一个模式」，
     *                      与营销活动的集合形态不同，但都满足 {@link Candidate} 的接口
     */
    public record Row(
            long id,
            int discountBp,
            List<String> modelPatterns,
            List<String> taskPatterns
    ) implements Candidate {
        @Override public String code() { return null; }   // 会员折扣没有业务码
        @Override public boolean enabled() { return true; } // enabled 由查询条件过滤
    }

    @Override
    protected List<Row> loadCandidates(PricingContext ctx) {
        // tier 在查询条件里过滤：表按 tier 建了索引，全表拉再内存过滤是浪费。
        // 注意用 tier 而非 user_id —— 同一等级共享同一批规则，结果可整体缓存。
        List<MemberDiscountEntity> rows = mapper.selectList(new LambdaQueryWrapper<MemberDiscountEntity>()
                .eq(MemberDiscountEntity::getTier, ctx.request().tier())
                .eq(MemberDiscountEntity::getStatus, "enabled"));

        return rows.stream()
                .map(entity -> new Row(
                        entity.getId(),
                        entity.getDiscountBp(),
                        List.of(entity.getModelPattern()),
                        List.of(entity.getTaskPattern())))
                .toList();
    }
}
