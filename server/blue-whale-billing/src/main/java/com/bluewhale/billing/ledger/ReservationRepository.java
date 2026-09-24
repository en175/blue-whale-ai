package com.bluewhale.billing.ledger;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.domain.entity.CostReservationEntity;
import com.bluewhale.billing.infrastructure.mapper.CostReservationMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Repository;

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
                       int catalogVersion, int discountBp, List<Allocation> allocations) {
        CostReservationEntity entity = new CostReservationEntity();
        entity.setGenerationJobId(jobId);
        entity.setUserId(userId);
        entity.setReservedCredits(reservedCredits);
        entity.setStatus(Reservation.Status.HELD.key());
        entity.setAllocations(writeAllocations(allocations));
        entity.setCatalogVersion(catalogVersion);
        entity.setDiscountBp(discountBp);
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

    public void markSettled(long jobId, long actualCredits) {
        mapper.markSettled(jobId, actualCredits);
    }

    public void markReleased(long jobId, String releaseNote) {
        mapper.markReleased(jobId, releaseNote);
    }

    private static Reservation toReservation(CostReservationEntity entity) {
        return new Reservation(
                entity.getId(),
                entity.getGenerationJobId(),
                entity.getUserId(),
                entity.getReservedCredits(),
                entity.getActualCredits(),
                Reservation.Status.of(entity.getStatus()),
                readAllocations(entity.getAllocations()),
                entity.getCatalogVersion(),
                entity.getDiscountBp(),
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
