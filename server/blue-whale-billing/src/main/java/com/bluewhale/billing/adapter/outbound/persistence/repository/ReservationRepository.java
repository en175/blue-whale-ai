package com.bluewhale.billing.adapter.outbound.persistence.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.adapter.outbound.persistence.entity.CostReservationEntity;
import com.bluewhale.billing.adapter.outbound.persistence.mapper.CostReservationMapper;
import com.bluewhale.billing.adapter.outbound.persistence.row.StaleReservationRow;
import com.bluewhale.billing.domain.ledger.Allocation;
import com.bluewhale.billing.domain.ledger.Reservation;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Repository;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 预扣预留的持久化（《计费逻辑详细设计》§2.4）。
 *
 * <p>{@code allocations} 以 JSON 列存储。**列里的内容不参与 SQL 条件**——
 * 它是一份「当时怎么分的」快照，读取方只有 Java 一侧，所以用 JSON 而不是拆表：
 * 拆表会让每次预扣多插 N 行明细，收益只是一次根本不会发生的按明细查询。
 *
 * <p>SQL 在 {@link CostReservationMapper} 与 {@code resources/mapper/CostReservationMapper.xml}。
 */
@Repository
public class ReservationRepository {

    private final CostReservationMapper mapper;
    private final ObjectMapper json = new ObjectMapper();

    public ReservationRepository(CostReservationMapper mapper) {
        this.mapper = mapper;
    }

    /** 建预留。幂等键是 {@code uk_reservation__job}（job_id 唯一）——重复预扣靠它拦下。 */
    public long insert(long jobId, long userId, long reservedCredits,
                       int catalogVersion, int discountBp, String ruleSnapshot, String title,
                       List<Allocation> allocations) {
        CostReservationEntity entity = new CostReservationEntity();
        entity.setGenerationJobId(jobId);
        entity.setUserId(userId);
        entity.setReservedCredits(reservedCredits);
        entity.setStatus(Reservation.Status.HELD.key());
        entity.setAllocations(writeAllocations(allocations));
        entity.setCatalogVersion(catalogVersion);
        entity.setDiscountBp(discountBp);
        // 规则快照（见 V8 迁移）：空白归一成 NULL，让「没带快照」在库里只有一种写法
        // ——结算的判据是「取出来是不是空的」，两种写法就得判两次
        entity.setRuleSnapshot(ruleSnapshot == null || ruleSnapshot.isBlank() ? null : ruleSnapshot);
        // 展示文案快照（见 V6 迁移）：null 归一成空串，让「没提供」在库里只有一种写法
        entity.setTitle(title == null ? "" : title);
        mapper.insert(entity);
        return entity.getId();
    }

    public Optional<Reservation> findByJobId(long jobId) {
        return Optional.ofNullable(mapper.selectOne(new LambdaQueryWrapper<CostReservationEntity>()
                .eq(CostReservationEntity::getGenerationJobId, jobId)))
                .map(ReservationRepository::toReservation);
    }

    /**
     * 取出并**锁住**该 job 的预留。
     *
     * <p>结算与返还是两条并发路径（任务完成回调 vs 超时兜底扫描），都可能同时到达。
     * 没有这把行锁，两者会各自读到 {@code held}，各自解冻一次——同一笔钱退两遍。
     */
    public Reservation lockByJobId(long jobId) {
        CostReservationEntity entity = mapper.lockByJobId(jobId);
        return entity == null ? null : toReservation(entity);
    }

    /**
     * 置为已结算。
     *
     * @param actualCredits     真实用量成本（积分）
     * @param receivableCredits 其中**没收到**的那部分（积分，见 V9 迁移）；无超扣时传 0。
     *                          它与 actualCredits 由调用方在同一次判断里算出、这里同一条
     *                          UPDATE 写入——「欠费列已写、账本腿还没写」的窗口不能存在
     */
    public void markSettled(long jobId, long actualCredits, long receivableCredits) {
        mapper.markSettled(jobId, actualCredits, receivableCredits);
    }

    public void markReleased(long jobId, String releaseNote) {
        mapper.markReleased(jobId, releaseNote);
    }

    /**
     * 区间内**已结算**的实际消耗合计（管理端仪表盘的「总使用积分」）。
     *
     * <p>口径与边界见 {@link CostReservationMapper#sumSettledActualCredits}。
     * 参数是**库内墙钟**（北京时间），换算由调用方经 {@code DbTime} 做——
     * 本层与其它库访问一样不碰时区。
     */
    public long sumSettledActualCredits(LocalDateTime from, LocalDateTime to) {
        return mapper.sumSettledActualCredits(from, to);
    }

    /**
     * 持有超过 {@code olderThan} 仍未终态的预留（最早持有的在前）。
     *
     * <p>取数口径（为什么用 {@code gmt_modified}、为什么时间在 SQL 侧算、
     * 为什么必须有 limit）见 {@link CostReservationMapper#listStaleHeld}。
     *
     * @param olderThan 超过多久算「超时」；由调用方传入阈值，
     *                  这里不预设 2h/24h——**阈值是策略，不是持久化的事**
     */
    public List<StaleHold> listStaleHeld(Duration olderThan, int limit) {
        return mapper.listStaleHeld(olderThan.getSeconds(), limit).stream()
                .map(ReservationRepository::toStaleHold)
                .toList();
    }

    /**
     * 「持有超时」的预留读模型。
     *
     * <p>它不是 {@link Reservation}：兜底扫描不需要分配明细与规则快照
     * （那两列是结算复现用的），带上它们只是让每轮扫描多读一批没人看的字节。
     * 需要恢复成完整预留时，按 jobId 再查一次即可——那条路径走的是唯一索引。
     */
    public record StaleHold(long jobId, long userId, long reservedCredits, long heldSeconds) {

        /** 已持有小时数（只用于展示与日志）。 */
        public long heldHours() {
            return heldSeconds / 3600;
        }
    }

    private static StaleHold toStaleHold(StaleReservationRow row) {
        return new StaleHold(row.getGenerationJobId(), row.getUserId(),
                row.getReservedCredits(), row.getHeldSeconds());
    }

    private static Reservation toReservation(CostReservationEntity entity) {
        return new Reservation(
                entity.getId(),
                entity.getGenerationJobId(),
                entity.getUserId(),
                entity.getReservedCredits(),
                entity.getActualCredits(),
                // NOT NULL DEFAULT 0（V9）：结算前读不出来也不会是 null，无需兜底
                entity.getReceivableCredits(),
                Reservation.Status.of(entity.getStatus()),
                readAllocations(entity.getAllocations()),
                entity.getCatalogVersion(),
                entity.getDiscountBp(),
                entity.getRuleSnapshot(),
                entity.getTitle(),
                entity.getReleaseNote());
    }

    private String writeAllocations(List<Allocation> allocations) {
        try {
            return json.writeValueAsString(allocations);
        } catch (Exception e) {
            // 分配明细都是 long，序列化不可能失败；真失败说明是致命的编码问题
            throw new IllegalStateException("预扣分配明细无法序列化", e);
        }
    }

    private static List<Allocation> readAllocations(String allocationsJson) {
        try {
            return new ObjectMapper().readValue(allocationsJson, new TypeReference<List<Allocation>>() {});
        } catch (Exception e) {
            // ⚠️ 刻意不「读不出来就当空」：空分配会让结算解冻不到任何批次，
            //    冻结量永久留在账户上。宁可当场炸，也不要静默错账。
            throw new IllegalStateException("预扣分配明细无法解析：" + allocationsJson, e);
        }
    }
}
