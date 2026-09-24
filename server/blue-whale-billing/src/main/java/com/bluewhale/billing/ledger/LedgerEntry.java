package com.bluewhale.billing.ledger;

/**
 * 账本分录（《计费逻辑详细设计》§2.2）。
 *
 * <p><b>append-only</b>：不 UPDATE、不 DELETE。冲正靠**反向分录**，不靠改历史。
 *
 * <p>{@code balanceAfter} **不在这里** —— 它由 {@code LedgerRepository} 落库时计算
 * （需要读该科目的上一笔余额）。放在这里会诱使调用方自己算，而调用方没有那个上下文。
 *
 * @param bizType        hold | settle | refund | recharge | grant | expire | adjust
 * @param bizId          关联业务 id（jobId / orderNo）
 * @param idempotencyKey ★ 幂等键。重复请求靠**唯一索引**拦下，不靠应用层判重
 */
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
        /** 借。 */
        DEBIT,
        /** 贷。 */
        CREDIT
    }

    public LedgerEntry {
        if (amount <= 0) {
            // 金额恒正，方向由 direction 表达 —— 允许负数会让「借 5」和「贷 -5」
            // 两种写法等价，对账时无法判断哪笔是冲正
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
