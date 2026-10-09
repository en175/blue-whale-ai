package com.bluewhale.billing.application;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.bluewhale.billing.application.command.PromotionUpsertCommand;
import com.bluewhale.billing.application.view.PromotionView;
import com.bluewhale.billing.common.error.AdminNotFoundException;
import com.bluewhale.billing.domain.discount.DiscountRules;
import com.bluewhale.billing.infrastructure.discount.PatternJson;
import com.bluewhale.billing.infrastructure.persistence.mapper.PromotionMapper;
import com.bluewhale.billing.infrastructure.persistence.po.PromotionEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@ConditionalOnProperty(name = "billing.admin.enabled", havingValue = "true")
public class PromotionAdminService {

    private final PromotionMapper mapper;

    public PromotionAdminService(PromotionMapper mapper) {
        this.mapper = mapper;
    }

    public List<PromotionView> list(String status) {
        String statusFilter = (status == null || status.isBlank()) ? null : DiscountRules.promotionStatus(status);

        LambdaQueryWrapper<PromotionEntity> query = new LambdaQueryWrapper<PromotionEntity>()
                .eq(statusFilter != null, PromotionEntity::getStatus, statusFilter)
                .orderByDesc(PromotionEntity::getPriority)
                .orderByDesc(PromotionEntity::getStartAt)
                .orderByDesc(PromotionEntity::getId);
        return mapper.selectList(query).stream().map(PromotionAdminService::toView).toList();
    }

    public PromotionView create(PromotionUpsertCommand command, String operator) {
        String createdBy = DiscountRules.text(operator, 64, "操作人");
        if (codeTaken(command.code(), null)) {
            throw new IllegalArgumentException("活动标识已存在：" + command.code() + "（它要唯一，审计时靠它定位）");
        }

        PromotionEntity entity = new PromotionEntity();
        apply(command, entity);
        entity.setCreatedBy(createdBy);
        mapper.insert(entity);
        return toView(requireExists(entity.getId()));
    }

    public PromotionView update(long id, PromotionUpsertCommand command) {
        requireExists(id);
        if (codeTaken(command.code(), id)) {
            throw new IllegalArgumentException("活动标识已存在：" + command.code() + "（它要唯一，审计时靠它定位）");
        }

        mapper.update(null, new LambdaUpdateWrapper<PromotionEntity>()
                .eq(PromotionEntity::getId, id)
                .set(PromotionEntity::getCode, command.code())
                .set(PromotionEntity::getName, command.name())
                .set(PromotionEntity::getDiscountBp, command.discountBp())
                .set(PromotionEntity::getModelIds, DiscountRules.toJson(command.modelIds()))
                .set(PromotionEntity::getTaskTypes, DiscountRules.toJson(command.taskTypes()))
                .set(PromotionEntity::getTierScope, DiscountRules.toJson(command.tierScope()))
                .set(PromotionEntity::getStartAt, command.startAt())
                .set(PromotionEntity::getEndAt, command.endAt())
                .set(PromotionEntity::getDailyTimeStart, command.dailyTimeStart())
                .set(PromotionEntity::getDailyTimeEnd, command.dailyTimeEnd())
                .set(PromotionEntity::getDaysOfWeek, DiscountRules.toJson(command.daysOfWeek()))
                .set(PromotionEntity::getStatus, command.status())
                .set(PromotionEntity::getPriority, command.priority()));
        return toView(requireExists(id));
    }

    public void delete(long id) {
        if (mapper.deleteById(id) == 0) {
            throw new AdminNotFoundException("活动不存在（可能已被删除）：id=" + id);
        }
    }

    private PromotionEntity requireExists(long id) {
        PromotionEntity entity = mapper.selectById(id);
        if (entity == null) {
            throw new AdminNotFoundException("活动不存在（可能已被删除）：id=" + id);
        }
        return entity;
    }

    private boolean codeTaken(String code, Long excludeId) {
        return mapper.selectCount(new LambdaQueryWrapper<PromotionEntity>()
                .eq(PromotionEntity::getCode, code)
                .ne(excludeId != null, PromotionEntity::getId, excludeId)) > 0;
    }

    private static void apply(PromotionUpsertCommand command, PromotionEntity entity) {
        entity.setCode(command.code());
        entity.setName(command.name());
        entity.setDiscountBp(command.discountBp());
        entity.setModelIds(DiscountRules.toJson(command.modelIds()));
        entity.setTaskTypes(DiscountRules.toJson(command.taskTypes()));
        entity.setTierScope(DiscountRules.toJson(command.tierScope()));
        entity.setStartAt(command.startAt());
        entity.setEndAt(command.endAt());
        entity.setDailyTimeStart(command.dailyTimeStart());
        entity.setDailyTimeEnd(command.dailyTimeEnd());
        entity.setDaysOfWeek(DiscountRules.toJson(command.daysOfWeek()));
        entity.setStatus(command.status());
        entity.setPriority(command.priority());
    }

    private static PromotionView toView(PromotionEntity entity) {
        return new PromotionView(
                entity.getId(),
                entity.getCode(),
                entity.getName(),
                entity.getDiscountBp(),
                PatternJson.stringList(entity.getModelIds()),
                nullIfEmpty(PatternJson.stringList(entity.getTaskTypes())),
                nullIfEmpty(PatternJson.stringList(entity.getTierScope())),
                entity.getStartAt(),
                entity.getEndAt(),
                entity.getDailyTimeStart(),
                entity.getDailyTimeEnd(),
                nullIfEmpty(PatternJson.intList(entity.getDaysOfWeek())),
                entity.getStatus(),
                entity.getPriority(),
                entity.getCreatedBy(),
                entity.getGmtCreate(),
                entity.getGmtModified());
    }

    private static <T> List<T> nullIfEmpty(List<T> values) {
        return values.isEmpty() ? null : values;
    }
}
