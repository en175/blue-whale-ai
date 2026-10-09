package com.bluewhale.billing.api;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.bluewhale.billing.infrastructure.persistence.po.MemberDiscountEntity;
import com.bluewhale.billing.infrastructure.persistence.mapper.MemberDiscountMapper;
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
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/admin/member-discounts")
@ConditionalOnProperty(name = "billing.admin.enabled", havingValue = "true")
public class AdminMemberDiscountController {

    private final MemberDiscountMapper mapper;

    public AdminMemberDiscountController(MemberDiscountMapper mapper) {
        this.mapper = mapper;
    }

    @GetMapping
    public List<MemberDiscountView> list(@RequestParam(name = "tier", required = false) String tier,
                                         @RequestParam(name = "status", required = false) String status) {
        String tierFilter = (tier == null || tier.isBlank()) ? null : DiscountRules.tier(tier);
        String statusFilter = (status == null || status.isBlank()) ? null : DiscountRules.memberStatus(status);

        LambdaQueryWrapper<MemberDiscountEntity> query = new LambdaQueryWrapper<MemberDiscountEntity>()
                .eq(tierFilter != null, MemberDiscountEntity::getTier, tierFilter)
                .eq(statusFilter != null, MemberDiscountEntity::getStatus, statusFilter)
                .orderByAsc(MemberDiscountEntity::getTier)
                .orderByDesc(MemberDiscountEntity::getPriority)
                .orderByAsc(MemberDiscountEntity::getId);
        return mapper.selectList(query).stream().map(MemberDiscountView::of).toList();
    }

    @PostMapping
    public MemberDiscountView create(@RequestBody UpsertRequest request) {
        MemberDiscountEntity entity = new MemberDiscountEntity();
        request.applyTo(entity);
        mapper.insert(entity);
        return MemberDiscountView.of(requireExists(entity.getId()));
    }

    @PutMapping("/{id}")
    public MemberDiscountView update(@PathVariable long id, @RequestBody UpsertRequest request) {
        requireExists(id);
        mapper.update(null, new LambdaUpdateWrapper<MemberDiscountEntity>()
                .eq(MemberDiscountEntity::getId, id)
                .set(MemberDiscountEntity::getTier, request.tier())
                .set(MemberDiscountEntity::getModelPattern, request.modelPattern())
                .set(MemberDiscountEntity::getTaskPattern, request.taskPattern())
                .set(MemberDiscountEntity::getDiscountBp, request.discountBp())
                .set(MemberDiscountEntity::getPriority, request.priority())
                .set(MemberDiscountEntity::getStatus, request.status()));
        return MemberDiscountView.of(requireExists(id));
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable long id) {
        if (mapper.deleteById(id) == 0) {
            throw new AdminNotFoundException("会员折扣不存在（可能已被删除）：id=" + id);
        }
        return Map.of("id", id, "deleted", true);
    }

    private MemberDiscountEntity requireExists(long id) {
        MemberDiscountEntity entity = mapper.selectById(id);
        if (entity == null) {
            throw new AdminNotFoundException("会员折扣不存在（可能已被删除）：id=" + id);
        }
        return entity;
    }

    public record UpsertRequest(
            String tier,
            String modelPattern,
            String taskPattern,
            Integer discountBp,
            Integer priority,
            String status
    ) {
        public UpsertRequest {
            tier = DiscountRules.tier(tier);
            modelPattern = DiscountRules.pattern(modelPattern, 128, "模型匹配");
            taskPattern = DiscountRules.pattern(taskPattern, 64, "任务匹配");
            discountBp = DiscountRules.discountBp(discountBp);
            priority = DiscountRules.priority(priority);
            status = DiscountRules.memberStatus(status);
        }

        void applyTo(MemberDiscountEntity entity) {
            entity.setTier(tier);
            entity.setModelPattern(modelPattern);
            entity.setTaskPattern(taskPattern);
            entity.setDiscountBp(discountBp);
            entity.setPriority(priority);
            entity.setStatus(status);
        }
    }

    public record MemberDiscountView(
            long id,
            String tier,
            String modelPattern,
            String taskPattern,
            int discountBp,
            int priority,
            String status,
            LocalDateTime gmtCreate,
            LocalDateTime gmtModified
    ) {
        static MemberDiscountView of(MemberDiscountEntity entity) {
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
}
