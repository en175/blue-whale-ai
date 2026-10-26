package com.bluewhale.billing.domain.ledger;

public record LedgerEntry(
        long userId,
        Account account,
        Direction direction,
        long amount,
        String bizType,
        String bizId,
        String idempotencyKey,
        String remark
) {

    public enum Direction {
        DEBIT,
        CREDIT
    }

    public LedgerEntry {
        if (amount <= 0) {
            throw new IllegalArgumentException("分录金额必须为正：" + amount);
        }
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new IllegalArgumentException("幂等键必填");
        }
        remark = remark == null ? "" : remark;
    }

    public static LedgerEntry debit(long userId, Account account, long amount,
                                    String bizType, String bizId,
                                    String idempotencyKey, String remark) {
        return new LedgerEntry(userId, account, Direction.DEBIT, amount,
                bizType, bizId, idempotencyKey, remark);
    }

    public static LedgerEntry credit(long userId, Account account, long amount,
                                     String bizType, String bizId,
                                     String idempotencyKey, String remark) {
        return new LedgerEntry(userId, account, Direction.CREDIT, amount,
                bizType, bizId, idempotencyKey, remark);
    }
}
