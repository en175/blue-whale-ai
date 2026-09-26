package com.bluewhale.billing.domain.ledger;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * 记账凭证 —— 一个业务动作产生的**全部**分录，借贷合计必须相等。
 *
 * <p>复式记账的两条要求在类型层面被强制：
 * <ol>
 *   <li><b>借贷平衡</b>：构造时校验 {@code Σ借 == Σ贷}，不平根本造不出来。
 *       对账时「总数不平」是最难查的错误——只能知道整体错了，不知道错在哪。
 *       在入口拦住，就永远不会有这一层。</li>
 *   <li><b>科目不重复</b>：同一科目在一条凭证里只允许出现一次。
 *       这不是洁癖——见下方幂等键。</li>
 * </ol>
 *
 * <h2>为什么科目不能重复（这是幂等键的推导前提）</h2>
 *
 * {@code billing_ledger_entries.idempotency_key} 是**唯一索引**，一条凭证的每一笔都要有自己的键。
 * 本类用 {@code 业务基础键 + ":" + 科目名} 推导，例如预扣的凭证
 * {@code hold:cmd-123} 会产生两笔：{@code hold:cmd-123:wallet} 与 {@code hold:cmd-123:frozen}。
 *
 * <p>这在「科目不重复」成立时是**完备**的（键唯一），且人工排查时一眼能看出这行是哪条腿。
 * 一旦允许同科目两笔，两个键就会撞上唯一索引——与其让数据库在运行时抛
 * {@code DuplicateKeyException}（还看不出是代码问题还是真重复请求），不如在这里当场拒绝。
 *
 * <p>需要给同一科目记两笔时，**先合并再记**：结算消耗同时来自付费批次与赠送批次时，
 * 后者合并成一条 {@code cost} 腿，而不是记两条 {@code cost}。
 * 合并后的金额才是报表真正想要的数。
 *
 * <h2>用法</h2>
 * <pre>{@code
 * Voucher.base("hold:" + commandId, userId, BizType.HOLD, String.valueOf(jobId))
 *        .debit (Account.WALLET, amount, "提交预扣")
 *        .credit(Account.FROZEN, amount, "提交预扣")
 *        .build();
 * }</pre>
 */
public record Voucher(List<LedgerEntry> legs) {

    public Voucher {
        legs = List.copyOf(legs);
        if (legs.isEmpty()) {
            throw new IllegalArgumentException("凭证不能没有分录");
        }
        long debit = 0;
        long credit = 0;
        for (LedgerEntry leg : legs) {
            if (leg.direction() == LedgerEntry.Direction.DEBIT) {
                debit += leg.amount();
            } else {
                credit += leg.amount();
            }
        }
        if (debit != credit) {
            throw new IllegalArgumentException("借贷不平：借 " + debit + " / 贷 " + credit);
        }
    }

    public List<LedgerEntry> debits() {
        return legs.stream().filter(leg -> leg.direction() == LedgerEntry.Direction.DEBIT).toList();
    }

    public List<LedgerEntry> credits() {
        return legs.stream().filter(leg -> leg.direction() == LedgerEntry.Direction.CREDIT).toList();
    }

    /**
     * 开始记一条凭证。
     *
     * @param idempotencyBase 业务幂等基础键（{@code hold:{commandId}} / {@code settle:{jobId}} …）；
     *                        每笔分录的键由它加科目名推导
     * @param userId          归属用户
     * @param bizType         业务类型
     * @param bizId           关联业务 id（jobId / orderNo）
     */
    public static Builder base(String idempotencyBase, long userId, BizType bizType, String bizId) {
        return new Builder(idempotencyBase, userId, bizType, bizId);
    }

    /**
     * 由凭证基础键推导某一笔分录的幂等键。
     *
     * <p>唯一使用方是 {@link Builder}，公开出来是为了让「判断这条凭证是否已记过」
     * 的一方不必自己拼字符串——两边拼接方式一旦不同，判重就会**静默失效**
     * （查不到 → 以为没记过 → 再记一次，然后撞在唯一索引上抛异常）。
     * 反过来，用前缀匹配的 {@code LedgerRepository.existsByVoucherBase} 是本方法的逆。
     */
    public static String legKey(String idempotencyBase, Account account) {
        return idempotencyBase + ":" + account.key();
    }

    public static final class Builder {

        private final String idempotencyBase;
        private final long userId;
        private final BizType bizType;
        private final String bizId;
        private final List<LedgerEntry> legs = new ArrayList<>();
        private final Set<Account> usedAccounts = EnumSet.noneOf(Account.class);

        private Builder(String idempotencyBase, long userId, BizType bizType, String bizId) {
            if (idempotencyBase == null || idempotencyBase.isBlank()) {
                throw new IllegalArgumentException("幂等基础键必填");
            }
            this.idempotencyBase = idempotencyBase;
            this.userId = userId;
            this.bizType = bizType;
            this.bizId = bizId;
        }

        public Builder debit(Account account, long amount, String remark) {
            return leg(account, LedgerEntry.Direction.DEBIT, amount, remark);
        }

        public Builder credit(Account account, long amount, String remark) {
            return leg(account, LedgerEntry.Direction.CREDIT, amount, remark);
        }

        private Builder leg(Account account, LedgerEntry.Direction direction, long amount, String remark) {
            if (amount <= 0) {
                throw new IllegalArgumentException(
                        "分录金额必须为正，实际 " + amount + "（" + account.key() + "）——"
                                + "无需记账的腿应当不加，而不是加一笔 0");
            }
            if (!usedAccounts.add(account)) {
                throw new IllegalArgumentException(
                        "同一凭证内科目重复：" + account.key() + " —— 请先合并该科目的金额再记一笔");
            }
            legs.add(new LedgerEntry(userId, account, direction, amount,
                    bizType.key(), bizId, legKey(idempotencyBase, account), remark));
            return this;
        }

        public Voucher build() {
            return new Voucher(legs);
        }
    }
}
