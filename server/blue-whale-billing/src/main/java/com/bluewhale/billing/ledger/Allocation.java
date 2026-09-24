package com.bluewhale.billing.ledger;

/**
 * 预扣的**批次分配明细**（《计费逻辑详细设计》§4.2）。
 *
 * <p>落库为 {@code billing_cost_reservations.allocations} 的一行：
 * {@code {"lotId": 12, "take": 3000}}。
 *
 * <p><b>为什么必须落库、结算时不能重算</b>：结算发生在预扣之后（可能隔了几分钟到几十分钟），
 * 期间完全可能插入新批次（用户充值）、旧批次到期失效。此时按当时的状态重跑一遍扣减顺序，
 * 会得到**与预扣时不同**的分配，于是解冻到别的批次上——冻结量对不上，不变量直接破。
 * 分配明细一旦写下就是这份预扣的唯一真相。
 *
 * @param lotId 批次 id
 * @param take  从该批次取走的量（mc），恒正
 */
public record Allocation(long lotId, long take) {

    public Allocation {
        if (lotId <= 0) {
            throw new IllegalArgumentException("批次 id 必须为正：" + lotId);
        }
        if (take <= 0) {
            // 零量分配没有意义，且会让 settle 写出金额为 0 的分录（分录金额恒正）。
            // 在构造处拦掉，比在记账处兜住更早暴露问题。
            throw new IllegalArgumentException("分配量必须为正：" + take);
        }
    }
}
