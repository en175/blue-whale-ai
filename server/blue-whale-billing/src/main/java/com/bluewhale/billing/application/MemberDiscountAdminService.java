package com.bluewhale.billing.application;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.bluewhale.billing.application.command.MemberDiscountUpsertCommand;
import com.bluewhale.billing.application.view.MemberDiscountView;
import com.bluewhale.billing.common.error.AdminNotFoundException;
import com.bluewhale.billing.domain.discount.DiscountRules;
import com.bluewhale.billing.infrastructure.persistence.mapper.MemberDiscountMapper;
import com.bluewhale.billing.infrastructure.persistence.po.MemberDiscountEntity;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class MemberDiscountAdminService {

    private final MemberDiscountMapper mapper;

    public MemberDiscountAdminService(MemberDiscountMapper mapper) {
        this.mapper = mapper;
    }

    public List<MemberDiscountView> list(String tier, String status) {
        String tierFilter = (tier == null || tier.isBlank()) ? null : DiscountRules.tier(tier);
        String statusFilter = (status == null || status.isBlank()) ? null : DiscountRules.memberStatus(status);

        LambdaQueryWrapper<MemberDiscountEntity> query = new LambdaQueryWrapper<MemberDiscountEntity>()
                .eq(tierFilter != null, MemberDiscountEntity::getTier, tierFilter)
                .eq(statusFilter != null, MemberDiscountEntity::getStatus, statusFilter)
                .orderByAsc(MemberDiscountEntity::getTier)
                .orderByDesc(MemberDiscountEntity::getPriority)
                .orderByAsc(MemberDiscountEntity::getId);
        return mapper.selectList(query).stream().map(MemberDiscountAdminService::toView).toList();
    }

    public MemberDiscountView create(MemberDiscountUpsertCommand command) {
        MemberDiscountEntity entity = new MemberDiscountEntity();
        apply(command, entity);
        mapper.insert(entity);
        return toView(requireExists(entity.getId()));
    }

    public MemberDiscountView update(long id, MemberDiscountUpsertCommand command) {
        requireExists(id);
        mapper.update(null, new LambdaUpdateWrapper<MemberDiscountEntity>()
                .eq(MemberDiscountEntity::getId, id)
                .set(MemberDiscountEntity::getTier, command.tier())
                .set(MemberDiscountEntity::getModelPattern, command.modelPattern())
                .set(MemberDiscountEntity::getTaskPattern, command.taskPattern())
                .set(MemberDiscountEntity::getDiscountBp, command.discountBp())
                .set(MemberDiscountEntity::getPriority, command.priority())
                .set(MemberDiscountEntity::getStatus, command.status()));
        return toView(requireExists(id));
    }

    public void delete(long id) {
        if (mapper.deleteById(id) == 0) {
            throw new AdminNotFoundException("会员折扣不存在（可能已被删除）：id=" + id);
        }
    }

    private MemberDiscountEntity requireExists(long id) {
        MemberDiscountEntity entity = mapper.selectById(id);
        if (entity == null) {
            throw new AdminNotFoundException("会员折扣不存在（可能已被删除）：id=" + id);
        }
        return entity;
    }

    private static void apply(MemberDiscountUpsertCommand command, MemberDiscountEntity entity) {
        entity.setTier(command.tier());
        entity.setModelPattern(command.modelPattern());
        entity.setTaskPattern(command.taskPattern());
        entity.setDiscountBp(command.discountBp());
        entity.setPriority(command.priority());
        entity.setStatus(command.status());
    }

    private static MemberDiscountView toView(MemberDiscountEntity entity) {
        return new MemberDiscountView(
                entity.getId(),
                entity.getTier(),
                entity.getModelPattern(),
                entity.getTaskPattern(),
                entity.getDiscountBp(),
                entity.getPriority(),
                entity.getStatus(),
                entity.getGmtCreate(),
                entity.getGmtModified());
    }
}
