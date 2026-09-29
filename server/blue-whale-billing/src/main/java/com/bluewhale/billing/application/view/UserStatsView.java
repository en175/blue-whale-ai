package com.bluewhale.billing.application.view;

/**
 * 一个用户的「可用 / 累计充值 / 累计消费」三列（**管理端用户列表**专用）。
 *
 * <p>它只装在批量取数里（{@code BillingApplicationService#userStats}）：列表页一次
 * 问一批用户，逐个调 {@link BalanceView} 那条路径就是 N+1。所以这里刻意是个
 * **窄视图** —— 只有列表真正要渲染的三列，不带临期批次与欠费额那些详情页才要的东西。
 *
 * <p>⚠️ 三列的口径（都取整数积分，与账本同单位）：
 * <ul>
 *   <li>{@link #availableCredits} —— Σ(remaining − frozen)，只算未过期批次。
 *       与 {@link BalanceView#availableCredits()} **同一条 WHERE**，只多一个
 *       {@code user_id IN}。列表页与详情页显示的不是同一个数就是 bug</li>
 *   <li>{@link #totalRecharged} —— {@code purchased} 批次的 {@code amount} 合计。
 *       **只算充值本金，不含充值赠送**（那是 bonus 批次）：这一列问的是
 *       「用户自己充了多少钱」，把赠送折进去运营就对不上营收了</li>
 *   <li>{@link #totalConsumed} —— **已结算**的实际消耗。不含冻结中的预扣 ——
 *       那是「可能消耗」，算进去会让这个数随在途任务浮动</li>
 * </ul>
 *
 * <p>⚠️ {@link #totalRecharged} 用的是批次 {@code amount}（发放量）而不是
 * {@code remaining}（剩余）：一旦消耗过，剩余就小于发放，而「累计充值」问的是
 * 历史上充了多少，不是现在还剩多少。
 */
public record UserStatsView(long availableCredits, long totalRecharged, long totalConsumed) {
}
