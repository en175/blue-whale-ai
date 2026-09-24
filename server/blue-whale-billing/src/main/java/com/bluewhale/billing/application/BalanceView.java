package com.bluewhale.billing.application;

import java.time.Instant;
import java.util.List;

/**
 * 余额视图（用户可见）。
 *
 * @param availableCredits 可用（积分）—— 这个数**不含**冻结中的部分
 * @param frozenCredits    冻结中（积分）—— 「处理中」的任务占着的
 * @param expiring         临期批次，供前端提示「X 积分将于 Y 日过期」
 */
public record BalanceView(long availableCredits, long frozenCredits, List<ExpiringLot> expiring) {

    public BalanceView {
        expiring = List.copyOf(expiring);
    }

    /** 用户总资产（积分）—— 可用 + 冻结。冻结的钱还在，只是动不了。 */
    public long totalCredits() {
        return availableCredits + frozenCredits;
    }

    /**
     * 临期批次。
     *
     * @param source 积分来源（{@code CreditSource.key()}）—— 决定展示文案：
     *               「充值赠送的 500 分即将过期」与「补偿的 500 分即将过期」对用户是不同的信息
     */
    public record ExpiringLot(long credits, Instant expiresAt, String source) {}
}
