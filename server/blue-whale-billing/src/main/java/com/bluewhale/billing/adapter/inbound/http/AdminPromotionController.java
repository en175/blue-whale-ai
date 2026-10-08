package com.bluewhale.billing.adapter.inbound.http;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.bluewhale.billing.adapter.outbound.discount.PatternJson;
import com.bluewhale.billing.adapter.outbound.persistence.entity.PromotionEntity;
import com.bluewhale.billing.adapter.outbound.persistence.mapper.PromotionMapper;
import com.bluewhale.billing.domain.discount.DiscountRules;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/admin/promotions")
@ConditionalOnProperty(name = "billing.admin.enabled", havingValue = "true")
public class AdminPromotionController {

    private final PromotionMapper mapper;

    public AdminPromotionController(PromotionMapper mapper) {
        this.mapper = mapper;
    }

    @GetMapping
    public List<PromotionView> list(@RequestParam(name = "status", required = false) String status) {
        String statusFilter = (status == null || status.isBlank()) ? null : DiscountRules.promotionStatus(status);

        LambdaQueryWrapper<PromotionEntity> query = new LambdaQueryWrapper<PromotionEntity>()
                .eq(statusFilter != null, PromotionEntity::getStatus, statusFilter)
                .orderByDesc(PromotionEntity::getPriority)
                .orderByDesc(PromotionEntity::getStartAt)
                .orderByDesc(PromotionEntity::getId);
        return mapper.selectList(query).stream().map(PromotionView::of).toList();
    }

    @PostMapping
    public PromotionView create(@RequestParam(name = "operator", defaultValue = "admin") String operator,
                                @RequestBody UpsertRequest request) {
        String createdBy = DiscountRules.text(operator, 64, "操作人");
        if (codeTaken(request.code(), null)) {
            throw new IllegalArgumentException("活动标识已存在：" + request.code() + "（它要唯一，审计时靠它定位）");
        }

        PromotionEntity entity = new PromotionEntity();
        request.applyTo(entity);
        entity.setCreatedBy(createdBy);
        mapper.insert(entity);
        return PromotionView.of(requireExists(entity.getId()));
    }

    @PutMapping("/{id}")
    public PromotionView update(@PathVariable long id, @RequestBody UpsertRequest request) {
        requireExists(id);
        if (codeTaken(request.code(), id)) {
            throw new IllegalArgumentException("活动标识已存在：" + request.code() + "（它要唯一，审计时靠它定位）");
        }

        mapper.update(null, new LambdaUpdateWrapper<PromotionEntity>()
                .eq(PromotionEntity::getId, id)
                .set(PromotionEntity::getCode, request.code())
                .set(PromotionEntity::getName, request.name())
                .set(PromotionEntity::getDiscountBp, request.discountBp())
                .set(PromotionEntity::getModelIds, DiscountRules.toJson(request.modelIds()))
                .set(PromotionEntity::getTaskTypes, DiscountRules.toJson(request.taskTypes()))
                .set(PromotionEntity::getTierScope, DiscountRules.toJson(request.tierScope()))
                .set(PromotionEntity::getStartAt, request.startAt())
                .set(PromotionEntity::getEndAt, request.endAt())
                .set(PromotionEntity::getDailyTimeStart, request.dailyTimeStart())
                .set(PromotionEntity::getDailyTimeEnd, request.dailyTimeEnd())
                .set(PromotionEntity::getDaysOfWeek, DiscountRules.toJson(request.daysOfWeek()))
                .set(PromotionEntity::getTz, request.tz())
                .set(PromotionEntity::getStatus, request.status())
                .set(PromotionEntity::getPriority, request.priority()));
        return PromotionView.of(requireExists(id));
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable long id) {
        if (mapper.deleteById(id) == 0) {
            throw new AdminNotFoundException("活动不存在（可能已被删除）：id=" + id);
        }
        return Map.of("id", id, "deleted", true);
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

    public record UpsertRequest(
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
        public UpsertRequest {
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

        void applyTo(PromotionEntity entity) {
            entity.setCode(code);
            entity.setName(name);
            entity.setDiscountBp(discountBp);
            entity.setModelIds(DiscountRules.toJson(modelIds));
            entity.setTaskTypes(DiscountRules.toJson(taskTypes));
            entity.setTierScope(DiscountRules.toJson(tierScope));
            entity.setStartAt(startAt);
            entity.setEndAt(endAt);
            entity.setDailyTimeStart(dailyTimeStart);
            entity.setDailyTimeEnd(dailyTimeEnd);
            entity.setDaysOfWeek(DiscountRules.toJson(daysOfWeek));
            entity.setTz(tz);
            entity.setStatus(status);
            entity.setPriority(priority);
        }
    }

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
    ) {
        static PromotionView of(PromotionEntity entity) {
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
                    entity.getTz(),
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
}
