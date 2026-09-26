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

/**
 * 营销活动（{@code billing_promotions}）的管理端接口（《架构设计》§12）。
 *
 * <h2>这是运营每天用的那一张</h2>
 *
 * <p>它与会员折扣分表的理由见 {@code V2__discounts.sql} 的文件头：会员折扣是长期契约（低频、
 * 无时间窗），活动是运营日常（高频、带时间窗与时段）。所以这里的列多得多，
 * 校验也多得多 —— 时段、时区、星期、等级范围，每一项配错都表现为「活动建了但没人被打到折」，
 * 而计价侧不会报错（它只是不命中）。
 *
 * <h2>⚠️ 三处最容易配错、且在计价侧「静默」的地方</h2>
 *
 * <ol>
 *   <li><b>{@code model_ids} 空数组 = 不限</b>：{@code Patterns.matchesAny} 对空集合返回 true。
 *       「限时活动」把全站模型都打折几乎不会是本意，所以写入侧**强制至少给一个模式**
 *       （要全站就打 {@code *}，让它是显式的）。</li>
 *   <li><b>每日时段只填一半 = 全天</b>：计价侧 {@code dailyStart == null || dailyEnd == null}
 *       直接放行。只填开始不放结束的人以为限定了时段，实际拿到一条全天折扣，写入侧拒。</li>
 *   <li><b>时区</b>：跨零点时段（22:00→06:00）必须按活动自己的时区算，名字写错会让
 *       预扣路径抛异常（所有命中它的任务提交失败）。写入侧真的解析一次 {@code ZoneId}。</li>
 * </ol>
 *
 * <h2>⚠️ 改活动不影响已提交未结算的任务</h2>
 *
 * <p>与会员折扣同一条冻结语义：提交时冻结的是**命中的系数**
 * （{@code billing_cost_reservations.discount_bp}），结算按冻结值复现。
 * 活动改折扣、提前结束、被停掉，都不改变已提交任务的价格 —— 这是设计要的结果
 * （否则用户看着 7 折提交、结算按原价扣）。界面上必须写清，见前端活动页。
 *
 * <p>⚠️ <b>本接口没有鉴权</b>：由 backend 经 {@code BILLING_ADMIN_URL} 调用，
 * 那个端口只在内网、不对公网开放。
 */
@RestController
@RequestMapping("/admin/promotions")
@ConditionalOnProperty(name = "billing.admin.enabled", havingValue = "true")
public class AdminPromotionController {

    private final PromotionMapper mapper;

    public AdminPromotionController(PromotionMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * 列出全部活动（含 draft / disabled / 已过期的）。
     *
     * <pre>
     * curl 'localhost:4003/admin/promotions'
     * curl 'localhost:4003/admin/promotions?status=enabled'
     * </pre>
     *
     * @param status 按状态过滤；省略 = 全部。⚠️ 不能按「当前是否命中」过滤 ——
     *               那要按活动自己的时区算时段与星期，是计价侧的逻辑，
     *               在管理端复刻一份必然与实际命中漂移
     */
    @GetMapping
    public List<PromotionView> list(@RequestParam(name = "status", required = false) String status) {
        // ⚠️ 过滤值先求值再进 wrapper（`.eq` 的 value 参数是无条件求值的）
        String statusFilter = (status == null || status.isBlank()) ? null : DiscountRules.promotionStatus(status);

        LambdaQueryWrapper<PromotionEntity> query = new LambdaQueryWrapper<PromotionEntity>()
                .eq(statusFilter != null, PromotionEntity::getStatus, statusFilter)
                .orderByDesc(PromotionEntity::getPriority)
                .orderByDesc(PromotionEntity::getStartAt)
                .orderByDesc(PromotionEntity::getId);
        return mapper.selectList(query).stream().map(PromotionView::of).toList();
    }

    /**
     * 新建活动（默认 {@code status=draft}：**先建好、确认无误再启用**）。
     *
     * @param operator 操作人（写进 {@code created_by}）。由 backend 传当前管理员 ——
     *                 billing 的管理面没有鉴权，它是唯一能回答「这条活动是谁建的」的来源
     */
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
        // ⚠️ 插入后**再读一次**再返回：gmt_create / gmt_modified 是列默认值（DEFAULT CURRENT_TIMESTAMP），
        //    MyBatis-Plus 插入后不会把它们回填到实体上，直接返回会给出两个 null ——
        //    界面拿它去渲染「更新时间」就是一格空白，而库里明明有值。
        return PromotionView.of(requireExists(entity.getId()));
    }

    /**
     * 整条覆盖（不是部分更新）。
     *
     * <p>⚠️ 用 {@link LambdaUpdateWrapper} 显式列出每一列，而不是 {@code updateById}：
     * MyBatis-Plus 默认**跳过 null 字段**，而这张表里「留空」是有语义的
     * （每日时段留空 = 全天、任务范围留空 = 不限、等级范围留空 = 不限）。
     * 用 updateById 的话，运营把 22:00–06:00 清掉保存会**看起来成功、实际没写进去**，
     * 活动继续只在那 8 小时里生效 —— 这种「保存了但没生效」最难查。
     */
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
        // created_by 刻意不改：它是「谁建的」，不是「谁最后改的」（后者要留痕得另加列）
        return PromotionView.of(requireExists(id));
    }

    /**
     * 删除一条活动。
     *
     * <p>**物理删除**：已经提交的任务冻结了当时的系数，快照里还留着活动 id 与 code，
     * 所以删掉这条行不影响任何历史追溯（追溯读的是快照，不是这张 live 表）。
     * 想留一手就先停用（{@code status=disabled}）。
     */
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

    /**
     * 活动标识是否已被别人占用。
     *
     * <p>先查一次是为了**给人话**（400「活动标识已存在」），而不是让 DB 的唯一索引
     * 抛出一个通用 409。⚠️ 查与写之间有竞态，最终兜底仍是 {@code uk_promo__code}
     * （撞上时 409，见异常处理器）—— 这里是文案层，不是正确性层。
     */
    private boolean codeTaken(String code, Long excludeId) {
        return mapper.selectCount(new LambdaQueryWrapper<PromotionEntity>()
                .eq(PromotionEntity::getCode, code)
                .ne(excludeId != null, PromotionEntity::getId, excludeId)) > 0;
    }

    /**
     * 写入请求。
     *
     * <p>校验在紧凑构造器里（Jackson 反序列化即抛 → 400 + 人话，理由见 {@link DiscountRules}）。
     */
    public record UpsertRequest(
            /** 活动标识，唯一，审计用 */
            String code,
            /** 活动名称，界面展示（如「夜间 7 折」） */
            String name,
            /** 折扣，万分比（7000 = 7 折） */
            Integer discountBp,
            /** 模型范围，支持 * 与前缀通配；**不可为空**（空 = 全部模型，危险默认值） */
            List<String> modelIds,
            /** 任务类型范围；null / 空 = 全部 */
            List<String> taskTypes,
            /** 适用等级；null / 空 = 不限 */
            List<String> tierScope,
            /** 起始时间（含） */
            LocalDateTime startAt,
            /** 结束时间（**不含**） */
            LocalDateTime endAt,
            /** 每日时段起；与 end 同时留空 = 全天 */
            LocalTime dailyTimeStart,
            /** 每日时段止，可跨天（22:00→06:00） */
            LocalTime dailyTimeEnd,
            /** 生效星期 [1..7]（1 = 周一）；null / 空 = 每天 */
            List<Integer> daysOfWeek,
            /** 时区（ADR-0111 北京时间口径），必填 */
            String tz,
            /** draft | enabled | disabled | expired；不填默认 draft */
            String status,
            /** 展示优先级（仅排序用，不参与优惠比较） */
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

    /**
     * 一行活动 —— **JSON 列在这里是解析后的形态**，不是库里的文本。
     *
     * <p>为什么不像其它接口那样原样回列：这几列的文本形态对界面毫无意义
     * （{@code "[\"*\"]"} 与 {@code null} 的区别恰恰是「全站打折」与「不限」的区别），
     * 让每个客户端各自 JSON.parse 一次，就会出现「界面显示限了 3 个模型、
     * 计价侧其实当成不限」。用 {@link PatternJson} —— 与计价侧**同一份**解析。
     *
     * @param modelIds 至少一个（写入侧强制）；空数组在计价侧等于不限
     * @param tierScope null = 不限等级
     * @param daysOfWeek null = 每天
     */
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

        /** 「不限」在接口里只留一种表示（null）：空数组与 null 是同一个语义，给两种是给自己挖坑。 */
        private static <T> List<T> nullIfEmpty(List<T> values) {
            return values.isEmpty() ? null : values;
        }
    }
}
