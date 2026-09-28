package com.bluewhale.billing.adapter.inbound.http;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.bluewhale.billing.adapter.outbound.persistence.entity.MemberDiscountEntity;
import com.bluewhale.billing.adapter.outbound.persistence.mapper.MemberDiscountMapper;
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

/**
 * 会员等级折扣（{@code billing_member_discounts}）的管理端接口（《架构设计》§12）。
 *
 * <h2>这张表原先只能改 SQL</h2>
 *
 * <p>它是**长期契约**（用户买了会员就该享受），不是活动：没有起止时间、保存即生效、
 * 同一等级命中多条时取最优惠的一条（裁决在 {@code DiscountProvider.Abstract}，不在这里）。
 * 管理端因此只做四件事：列、增、改、删。界面上的「停用」= 把 status 改成 {@code disabled}
 * —— 它与删除的差别只是**留着还能再启用**，对计价而言两者都是「不命中」。
 *
 * <h2>⚠️ 改折扣不影响已提交未结算的任务（冻结语义）</h2>
 *
 * <p>job 提交时把**命中的结果**（万分比系数）冻结进
 * {@code billing_cost_reservations.discount_bp}，结算按冻结值复现、不重新解析。
 * 所以「我把 pro 从 9 折改成 8 折，为什么那笔还按 9 折算」的答案是：
 * 那笔在改之前就提交了，它冻结的是当时的价格。**界面上必须写清这一条** ——
 * 它是最容易被运营误解的一处（见前端的会员折扣页）。
 *
 * <p>⚠️ <b>本接口没有鉴权</b>，与 billing 其它管理面接口相同：它由 backend 经
 * {@code BILLING_ADMIN_URL} 调用，那个端口只在内网、不对公网开放。
 */
@RestController
@RequestMapping("/admin/member-discounts")
@ConditionalOnProperty(name = "billing.admin.enabled", havingValue = "true")
public class AdminMemberDiscountController {

    private final MemberDiscountMapper mapper;

    public AdminMemberDiscountController(MemberDiscountMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * 列出全部会员折扣。
     *
     * <p>把 {@code disabled} 的行也列出来（默认不过滤）：管理端的用途是「看看我配过什么」，
     * 藏掉停用的那几条，运营会以为它们已经被删了，然后重新配一条一模一样的。
     *
     * <pre>
     * curl 'localhost:4003/admin/member-discounts'
     * curl 'localhost:4003/admin/member-discounts?tier=pro&amp;status=enabled'
     * </pre>
     *
     * @param tier   按等级过滤；省略 = 全部
     * @param status 按状态过滤；省略 = 全部
     */
    @GetMapping
    public List<MemberDiscountView> list(@RequestParam(name = "tier", required = false) String tier,
                                         @RequestParam(name = "status", required = false) String status) {
        // ⚠️ 过滤值先算好再进 wrapper：`.eq(condition, column, value)` 的 value 是**先求值**的，
        //    把 DiscountRules.tier(tier) 直接写在里面，省略参数时会当场抛「会员等级只能是…」。
        String tierFilter = (tier == null || tier.isBlank()) ? null : DiscountRules.tier(tier);
        String statusFilter = (status == null || status.isBlank()) ? null : DiscountRules.memberStatus(status);

        LambdaQueryWrapper<MemberDiscountEntity> query = new LambdaQueryWrapper<MemberDiscountEntity>()
                .eq(tierFilter != null, MemberDiscountEntity::getTier, tierFilter)
                .eq(statusFilter != null, MemberDiscountEntity::getStatus, statusFilter)
                // 排序与索引 idx_member_disc__lookup (tier, status, priority) 同向：
                // 同等级内优先级高的先看到，剩下按 id 保证顺序稳定（否则刷新一次换个顺序）
                .orderByAsc(MemberDiscountEntity::getTier)
                .orderByDesc(MemberDiscountEntity::getPriority)
                .orderByAsc(MemberDiscountEntity::getId);
        return mapper.selectList(query).stream().map(MemberDiscountView::of).toList();
    }

    /**
     * 新建一条会员折扣。**保存即生效**（下次预扣时就会命中），没有发布动作。
     *
     * @return 落库后的完整行（含 id 与 gmtCreate）——回整行而不是只回 id，
     *         界面才能直接把它插进列表而不必再查一次
     */
    @PostMapping
    public MemberDiscountView create(@RequestBody UpsertRequest request) {
        MemberDiscountEntity entity = new MemberDiscountEntity();
        request.applyTo(entity);
        mapper.insert(entity);
        // ⚠️ 插入后**再读一次**再返回：gmt_create / gmt_modified 是列默认值（DEFAULT CURRENT_TIMESTAMP），
        //    MyBatis-Plus 插入后不会把它们回填到实体上，直接返回会给出两个 null ——
        //    界面拿它去渲染「更新时间」就是一格空白，而库里明明有值。
        return MemberDiscountView.of(requireExists(entity.getId()));
    }

    /**
     * 整条覆盖（不是部分更新）。
     *
     * <p>⚠️ 用 {@link LambdaUpdateWrapper} 显式列出每一列，而不是 {@code updateById}：
     * MyBatis-Plus 默认跳过 null 字段，将来这张表加了可空列（「留空 = 不限」那种），
     * 运营把值清空保存会**看起来成功、实际没写进去**。显式 set 让「清空」真的能落库。
     *
     * @throws AdminNotFoundException 该 id 已被别人删掉（映射成 404，见异常处理器）
     */
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

    /**
     * 删除一条会员折扣。
     *
     * <p>**物理删除**：这张表没有历史版本，也不需要有 —— 已经提交的任务冻结了当时的系数，
     * 删除只影响**之后**新提交的任务。想留一手就用 {@code status=disabled} 停用。
     */
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

    /**
     * 写入请求。
     *
     * <p>校验写在**紧凑构造器**里（与 {@code AdminCreditController.GrantRequest} 同一手法）：
     * Jackson 反序列化时就会抛，异常处理器把 {@link IllegalArgumentException} 翻成
     * 400 + 人话（见 {@code AdminExceptionHandler.unreadable} —— 它专门接住 Jackson
     * 包过一层的那种，否则校验写得再严，用户看到的都是 500）。
     */
    public record UpsertRequest(
            /** free | basic | pro | max。取值权威在 backend 的 libs/core/identity/tier.ts */
            String tier,
            /** 模型匹配，支持 * / seedance-* / 精确 id */
            String modelPattern,
            /** 任务匹配，支持 * / text2video */
            String taskPattern,
            /** 折扣，万分比（9000 = 9 折） */
            Integer discountBp,
            /** 同等级命中多条时取最优惠，此项只用于展示排序 */
            Integer priority,
            /** enabled | disabled；不填默认 enabled */
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

    /**
     * 一行会员折扣（管理端读形态 = 表里的列）。
     *
     * @param discountBp 万分比（9000 = 9 折）。⚠️ 界面按「折」展示，写回的是这个整数
     */
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
