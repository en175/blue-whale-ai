package com.bluewhale.billing.application.view;

import java.time.Instant;
import java.util.List;

/**
 * 余额视图（**用户面与管理面共用同一份数据**）。
 *
 * <p>⚠️ 「共用」指的是**取数只有这一处**，不是「字段会同时出现在两个契约里」。
 * {@link #receivableCredits} 就是反例：它装在视图里，但**只有管理面的
 * {@code AdminQueryBalanceResponse} 投影它**——用户面 {@code QueryBalanceResponse}
 * 一个字都不带，因为「任何用户可见界面永远只出现一个金额」是一条硬规则
 * （《计费逻辑详细设计》§2.3.1）。要不要投影由各自的适配器决定，见
 * {@code BillingGrpcService#queryBalance} 与 {@code BillingAdminGrpcService#adminQueryBalance}。
 *
 * @param availableCredits  可用（积分）—— 这个数**不含**冻结中的部分
 * @param frozenCredits     冻结中（积分）—— 「处理中」的任务占着的
 * @param receivableCredits 欠费（积分）—— 用量已发生、但没能从余额收到的部分。
 *                          它与账本 {@code RECEIVABLE} 账户余额同数（超扣走借方，
 *                          读出来是正数），**管理面专属**：它记的是平台少收了多少，
 *                          不是用户的钱，出现在用户界面上既没有用处也违反单金额规则
 * @param expiring          临期批次，供前端提示「X 积分将于 Y 日过期」
 */
public record BalanceView(long availableCredits, long frozenCredits,
                          long receivableCredits, List<ExpiringLot> expiring) {

    public BalanceView {
        expiring = List.copyOf(expiring);
    }

    /**
     * 用户总资产（积分）—— 可用 + 冻结。冻结的钱还在，只是动不了。
     *
     * <p>⚠️ **刻意不含 {@link #receivableCredits}**：欠费不是用户的钱，是平台少收的部分，
     * 把它算进来等于给用户凭空记一笔资产。它进不了这个等式，也不该进。
     */
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
