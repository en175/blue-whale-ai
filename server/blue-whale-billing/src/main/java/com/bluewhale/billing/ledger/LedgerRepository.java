package com.bluewhale.billing.ledger;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Statement;

/**
 * 复式账本的持久化（《计费逻辑详细设计》§2.2 / §3）。
 *
 * <p><b>append-only</b>：本仓库对外只有「插入」与「读」，没有 UPDATE / DELETE。
 * 冲正靠反向分录，不靠改历史——改历史会让「当时到底发生了什么」永久不可考。
 */
@Repository
public class LedgerRepository {

    private final JdbcTemplate jdbc;

    public LedgerRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * 这条凭证是否已记过 —— 重复请求的判据。
     *
     * <p>⚠️ 传的是**凭证基础键**（{@code hold:{commandId}}），不是分录键。
     * 分录的键是基础键加科目后缀（{@link Voucher#legKey}），所以这里要按前缀找。
     * 直接拿基础键去等值匹配会**永远查不到**——判重静默失效，重复请求一路走到
     * 唯一索引上才炸，而那时事务里已经冻结过一遍钱了。
     *
     * <p>前缀匹配走到 {@code uk_ledger__idem} 上，且因为带了分隔冒号，
     * {@code hold:cmd-6} 不会误匹配 {@code hold:cmd-60}。
     */
    public boolean existsByVoucherBase(String idempotencyBase) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_ledger_entries WHERE idempotency_key LIKE ?",
                Integer.class, idempotencyBase + ":%");
        return count != null && count > 0;
    }

    /**
     * 落一条凭证的全部分录，**逐笔计算 {@code balance_after}**。
     *
     * <h2>为什么要加锁读上一笔</h2>
     *
     * {@code balance_after} 是「该科目到目前为止的累计余额」快照。读上一笔再累加，
     * 中间若有并发写入，两个事务会读到同一个「上一笔」，写出两个相同的快照——
     * 对账时（§9 层次①）就会在这一点断开，而且断得**无声无息**（金额没问题，只有快照不对）。
     *
     * <p>{@code SELECT ... FOR UPDATE} 是**当前读**（不是快照读）：并发方会阻塞，
     * 等前者提交后读到新写入的那一行，从而串行化同一 (user, account) 的累计。
     *
     * <p>⚠️ <b>残留缺口</b>：该 (user, account) 尚无任何分录时，锁的是一个不存在的行，
     * 靠的是 InnoDB 在 REPEATABLE READ 下对空区间加 gap lock 来互斥。
     * 这层保护比「锁到实际的行」弱——所以**调用方仍需保证同一用户的资金动作串行**
     * （预扣已通过 {@code billing_credit_lots} 的 {@code FOR UPDATE} 做到）。
     */
    public void insert(Voucher voucher) {
        // 同一条凭证内的科目互不重复（Voucher 构造时强制），所以逐笔读上一笔即可，
        // 不会出现「本凭证前一腿刚写的余额还没读到」的问题。
        for (LedgerEntry leg : voucher.legs()) {
            long previous = latestBalance(leg.userId(), leg.account());
            long after = previous + leg.account().balanceDelta(leg.direction(), leg.amount());
            jdbc.update(connection -> {
                PreparedStatement statement = connection.prepareStatement(
                        "INSERT INTO billing_ledger_entries "
                                + "(user_id, account, direction, amount, biz_type, biz_id, "
                                + " idempotency_key, balance_after, remark) "
                                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        Statement.RETURN_GENERATED_KEYS);
                statement.setLong(1, leg.userId());
                statement.setString(2, leg.account().key());
                statement.setString(3, leg.direction().name().toLowerCase());
                statement.setLong(4, leg.amount());
                statement.setString(5, leg.bizType());
                statement.setString(6, leg.bizId());
                statement.setString(7, leg.idempotencyKey());
                statement.setLong(8, after);
                statement.setString(9, leg.remark());
                return statement;
            }, (KeyHolder) new GeneratedKeyHolder());
        }
    }

    /**
     * 该 (用户, 科目) 的当前余额。
     *
     * <p>读的是**最近一笔分录的快照**，不是 SUM——两者在一致的历史下必然相等，
     * 但读快照能把「余额对不对」与「历史累计对不对」区分开：
     * 若某处断裂，快照会立刻显形，而 SUM 会把错误抹平。
     */
    public long balanceOf(long userId, Account account) {
        return latestBalance(userId, account);
    }

    private long latestBalance(long userId, Account account) {
        var rows = jdbc.query(
                "SELECT balance_after FROM billing_ledger_entries "
                        + "WHERE user_id = ? AND account = ? "
                        + "ORDER BY id DESC LIMIT 1 FOR UPDATE",
                (rs, rowNum) -> rs.getLong("balance_after"),
                userId, account.key());
        return rows.isEmpty() ? 0L : rows.get(0);
    }
}
