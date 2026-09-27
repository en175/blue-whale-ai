package com.bluewhale.billing.adapter.outbound.persistence.repository;

import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.adapter.outbound.persistence.entity.CreditLotEntity;
import com.bluewhale.billing.adapter.outbound.persistence.mapper.CreditLotMapper;
import com.bluewhale.billing.domain.ledger.CreditSource;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;

/**
 * 积分批次的持久化（《计费逻辑详细设计》§7.2）。
 *
 * <p><b>批次是余额的唯一权威</b>——不设物化余额表。两处状态必然有不一致风险，
 * 而对账时无法判断谁对；直接从批次聚合（{@link #availableCredits}）只需一次索引扫描。
 *
 * <p>本类只管**行 ↔ 领域对象的搬运与转换**；SQL 在
 * {@link CreditLotMapper} 与 {@code resources/mapper/CreditLotMapper.xml}。
 * 拆开的理由：SQL 的读者是「要改查询、看索引、查执行计划」的人，
 * Java 的读者是「要改业务规则」的人，两者改动的时机与评审标准都不同。
 */
@Repository
public class CreditLotRepository {

    private final CreditLotMapper mapper;

    public CreditLotRepository(CreditLotMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * 批次（读模型）。
     *
     * @param version 行的版本号，由每次写入自增。它是**过期核销幂等键**的一部分：
     *                同一批次可能被核销不止一次（冻结部分解冻回可用后再次到期），
     *                而版本号是做一次写就变一次的单调量，天然能区分两次核销。
     * @see #lockById(long)
     */
    public record Lot(long id, long userId, CreditSource source, long amount,
                      long remaining, long frozen, Instant expiresAt, int version) {
        public long available() {
            return remaining - frozen;
        }
    }

    /**
     * ★ **锁该用户的全部有效批次**，按扣减顺序排好序返回。
     *
     * <p>三级 tie-break 与 {@code FOR UPDATE} 的语义见 {@link CreditLotMapper#lockActiveLots}。
     */
    public List<Lot> lockActiveLots(long userId) {
        return mapper.lockActiveLots(userId).stream()
                .map(CreditLotRepository::toLot)
                .toList();
    }

    /**
     * 按主键读一行并**锁住它**（过期核销用）。
     *
     * <p>与 {@link #lockActiveLots} 的差别是**不筛有效期**：核销正要看的就是已过期的那一行。
     *
     * @return 不存在时 {@code null}
     */
    public Lot lockById(long lotId) {
        CreditLotEntity entity = mapper.lockById(lotId);
        return entity == null ? null : toLot(entity);
    }

    /**
     * 已到期、仍有可核销量的批次（跨全部用户，最久到期的在前）。
     *
     * @param limit 本轮最多取几条
     */
    public List<Lot> listDueLots(int limit) {
        return mapper.listDueLots(limit).stream()
                .map(CreditLotRepository::toLot)
                .toList();
    }

    /** 可用余额 = Σ(remaining − frozen)，仅计未过期的批次。 */
    public long availableCredits(long userId) {
        return mapper.sumAvailable(userId);
    }

    /**
     * 临期批次（按到期时间从近到远）。
     *
     * @param withinDays 只看这么多天内到期的
     * @param limit      最多几条
     */
    public List<Lot> listExpiring(long userId, int withinDays, int limit) {
        return mapper.listExpiring(userId, withinDays, limit).stream()
                .map(CreditLotRepository::toLot)
                .toList();
    }

    /** 冻结：预扣用。**只动 frozen**，remaining 不动——钱还没花掉，只是不能用了。 */
    public void addFrozen(long lotId, long amount) {
        mapper.addFrozen(lotId, amount);
    }

    /** 解冻：返还用。**只动 frozen**，且保留批次原有的有效期。 */
    public void releaseFrozen(long lotId, long amount) {
        mapper.releaseFrozen(lotId, amount);
    }

    /**
     * 核销：把已到期的可用量从 {@code remaining} 扣掉，**冻结部分不动**。
     *
     * <p>只动 {@code remaining}，且金额由调用方按 {@link #lockById} 读到的快照算好传入——
     * 见 {@link CreditLotMapper#expireLot}。
     */
    public void expire(long lotId, long amount) {
        mapper.expireLot(lotId, amount);
    }

    /**
     * 结算：解冻并实扣。
     *
     * <p>{@code frozenTake} 是预扣时锁定的量，{@code actualTake} 是实际消耗的量。
     * 两者可以不等（部分成功 / 缓存命中）——差额自动回到可用余额。
     */
    public void settle(long lotId, long frozenTake, long actualTake) {
        mapper.settle(lotId, frozenTake, actualTake);
    }

    /**
     * 发放一个批次。
     *
     * @param grantKey 发放幂等键；重复发放靠唯一索引拦下（不靠应用层判重）
     * @throws org.springframework.dao.DuplicateKeyException 幂等键已存在
     */
    public long grant(long userId, CreditSource source, long amount, Instant expiresAt,
                      String bizType, String bizId, String grantKey) {
        CreditLotEntity entity = new CreditLotEntity();
        entity.setUserId(userId);
        entity.setSource(source.key());
        // 冗余列：把优先级固化在插入时，SQL 里就不必用 FIELD(source, ...) 硬编码顺序
        entity.setSourcePriority(source.priority());
        entity.setAmount(amount);
        entity.setRemaining(amount);
        entity.setFrozen(0L);
        entity.setExpiresAt(DbTime.toDb(expiresAt));
        entity.setBizType(bizType);
        entity.setBizId(bizId);
        entity.setGrantKey(grantKey);
        // IdType.AUTO：插入后主键回填到实体上，不必再查 LAST_INSERT_ID()
        mapper.insert(entity);
        return entity.getId();
    }

    /** 该批次的可用量——结算分配时防超扣。 */
    public long availableOf(long lotId) {
        CreditLotEntity entity = mapper.selectById(lotId);
        return entity == null ? 0L : entity.getRemaining() - entity.getFrozen();
    }

    /**
     * 该批次的来源。
     *
     * <p>结算时按批次逐个判定消耗记 {@code revenue}（付费）还是 {@code cost}（赠送）——
     * 一笔任务可能同时吃掉两种来源的批次，**不能整单一个科目**（《计费逻辑详细设计》§3 注）。
     */
    public CreditSource sourceOf(long lotId) {
        CreditLotEntity entity = mapper.selectById(lotId);
        if (entity == null) {
            throw new IllegalArgumentException("批次不存在：" + lotId);
        }
        return CreditSource.of(entity.getSource());
    }

    private static Lot toLot(CreditLotEntity entity) {
        return new Lot(
                entity.getId(),
                entity.getUserId(),
                CreditSource.of(entity.getSource()),
                entity.getAmount(),
                entity.getRemaining(),
                entity.getFrozen(),
                DbTime.fromDb(entity.getExpiresAt()),
                // 取 version 的语句都显式 SELECT 了它；缺列时的 0 只是兜底，
                // 不会造成「同一批次的两次核销撞同一个幂等键」以外的后果（那也只是漏销一次）
                entity.getVersion() == null ? 0 : entity.getVersion());
    }
}
