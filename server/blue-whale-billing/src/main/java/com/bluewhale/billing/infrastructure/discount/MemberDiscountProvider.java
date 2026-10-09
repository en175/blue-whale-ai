package com.bluewhale.billing.infrastructure.discount;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.infrastructure.persistence.po.MemberDiscountEntity;
import com.bluewhale.billing.infrastructure.persistence.mapper.MemberDiscountMapper;
import com.bluewhale.billing.domain.discount.DiscountProvider;
import com.bluewhale.billing.domain.pricing.PricingContext;
import org.springframework.stereotype.Component;

import java.util.List;

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

    public record Row(
            long id,
            int discountBp,
            List<String> modelPatterns,
            List<String> taskPatterns
    ) implements Candidate {
        @Override public String code() { return null; }
        @Override public boolean enabled() { return true; }
    }

    @Override
    protected List<Row> loadCandidates(PricingContext ctx) {
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
