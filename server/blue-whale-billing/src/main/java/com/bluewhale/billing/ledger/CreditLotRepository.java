package com.bluewhale.billing.ledger;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

/**
 * 积分批次的持久化（《计费逻辑详细设计》§7.2）。
 *
 * <p><b>批次是余额的唯一权威</b>——不设物化余额表。两处状态必然有不一致风险，
 * 而对账时无法判断谁对；直接从批次聚合（{@link #availableCredits}）只需一次索引扫描。
 */
@Repository
public class CreditLotRepository {

    private final JdbcTemplate jdbc;

    public CreditLotRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 批次（读模型）。 */
    public record Lot(long id, long userId, CreditSource source, long amount,
                      long remaining, long frozen, Instant expiresAt) {
        public long available() {
            return remaining - frozen;
        }
    }

    private static final RowMapper<Lot> MAPPER = (rs, rowNum) -> new Lot(
            rs.getLong("id"),
            rs.getLong("user_id"),
            CreditSource.of(rs.getString("source")),
            rs.getLong("amount"),
            rs.getLong("remaining"),
            rs.getLong("frozen"),
            rs.getTimestamp("expires_at") == null ? null : rs.getTimestamp("expires_at").toInstant());

    /**
     * ★ **锁该用户的全部有效批次**，按扣减顺序排好序返回。
     *
     * <p>三级 tie-break（《计费逻辑详细设计》§7.1）：
     * <pre>
     *   ① (expires_at IS NULL)   永久排最后
     *   ① expires_at ASC         先过期先扣
     *   ② source_priority ASC    同到期时间按来源（先消耗平台赠送的）
     *   ③ id ASC                 先获得的先扣
     * </pre>
     *
     * <p><b>只用 {@code FOR UPDATE} 锁单个用户的行</b>，不是全表——争用范围天然是单用户
     * （同一用户的并发提交是个位数，业务语义上本就该串行）。对比 GeekAI 的
     * 全局 {@code sync.Mutex}：那是把「同用户串行」做成了「全库串行」。
     *
     * <p>过期批次靠 {@code WHERE} 天然排除，**不需要定时任务清理**。
     */
    public List<Lot> lockActiveLots(long userId) {
        return jdbc.query(
                "SELECT id, user_id, source, amount, remaining, frozen, expires_at "
                        + "FROM billing_credit_lots "
                        + "WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW()) "
                        + "ORDER BY (expires_at IS NULL), expires_at ASC, source_priority ASC, id ASC "
                        + "FOR UPDATE",
                MAPPER, userId);
    }

    /** 可用余额 = Σ(remaining − frozen)，仅计未过期的批次。 */
    public long availableCredits(long userId) {
        Long sum = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining - frozen), 0) FROM billing_credit_lots "
                        + "WHERE user_id = ? AND (expires_at IS NULL OR expires_at > NOW())",
                Long.class, userId);
        return sum == null ? 0L : sum;
    }

    /** 冻结：预扣用。**只动 frozen**，remaining 不动——钱还没花掉，只是不能用了。 */
    public void addFrozen(long lotId, long amount) {
        jdbc.update("UPDATE billing_credit_lots SET frozen = frozen + ?, version = version + 1 WHERE id = ?",
                amount, lotId);
    }

    /**
     * 解冻：返还用。**只动 frozen**。
     *
     * <p>⚠️ 刻意不动 remaining，也不新建批次——若「先扣掉、返还时新建批次」，
     * 返还的积分会带**新的有效期**，用户凭空获得一次有效期重置，与应得权益不符。
     */
    public void releaseFrozen(long lotId, long amount) {
        jdbc.update("UPDATE billing_credit_lots SET frozen = frozen - ?, version = version + 1 WHERE id = ?",
                amount, lotId);
    }

    /**
     * 结算：解冻并实扣。
     *
     * <p>{@code frozenTake} 是预扣时锁定的量，{@code actualTake} 是实际消耗的量。
     * 两者可以不等（部分成功 / 缓存命中）——差额自动回到可用余额。
     */
    public void settle(long lotId, long frozenTake, long actualTake) {
        jdbc.update("UPDATE billing_credit_lots "
                        + "SET frozen = frozen - ?, remaining = remaining - ?, version = version + 1 "
                        + "WHERE id = ?",
                frozenTake, actualTake, lotId);
    }

    /**
     * 发放一个批次。
     *
     * @param grantKey 发放幂等键；重复发放靠唯一索引拦下（不靠应用层判重）
     * @throws org.springframework.dao.DuplicateKeyException 幂等键已存在
     */
    public long grant(long userId, CreditSource source, long amount, Instant expiresAt,
                      String bizType, String bizId, String grantKey) {
        jdbc.update("INSERT INTO billing_credit_lots "
                        + "(user_id, source, source_priority, amount, remaining, frozen, "
                        + " expires_at, biz_type, biz_id, grant_key) "
                        + "VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
                userId, source.key(), source.priority(), amount, amount,
                expiresAt == null ? null : Timestamp.from(expiresAt), bizType, bizId, grantKey);
        return jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
    }

    /** 该批次的可用量——结算分配时防超扣。 */
    public long availableOf(long lotId) {
        Long value = jdbc.queryForObject(
                "SELECT remaining - frozen FROM billing_credit_lots WHERE id = ?", Long.class, lotId);
        return value == null ? 0L : value;
    }

    /**
     * 该批次的来源。
     *
     * <p>结算时按批次逐个判定消耗记 {@code revenue}（付费）还是 {@code cost}（赠送）——
     * 一笔任务可能同时吃掉两种来源的批次，**不能整单一个科目**（《计费逻辑详细设计》§3 注）。
     */
    public CreditSource sourceOf(long lotId) {
        return CreditSource.of(jdbc.queryForObject(
                "SELECT source FROM billing_credit_lots WHERE id = ?", String.class, lotId));
    }
}
