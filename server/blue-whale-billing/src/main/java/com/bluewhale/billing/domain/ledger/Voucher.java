package com.bluewhale.billing.domain.ledger;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

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

    public static Builder base(String idempotencyBase, long userId, BizType bizType, String bizId) {
        return new Builder(idempotencyBase, userId, bizType, bizId);
    }

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
