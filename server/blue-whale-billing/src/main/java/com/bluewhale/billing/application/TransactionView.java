package com.bluewhale.billing.application;

import java.time.Instant;
import java.util.List;

/**
 * 用户可见流水的一行（**一个业务动作一行**，契约见
 * {@code contracts/proto/billing/v1/billing.proto} 的 {@code UserTransaction}）。
 *
 * <h2>为什么只有一个金额</h2>
 *
 * ⚠️ 本类型**刻意不含预扣额字段**——落实「任何用户可见界面永远只出现一个金额」
 * （《计费逻辑详细设计》§2.3.1）。预扣与实际的差额、分配了哪些批次，
 * 只对客服/运营后台可见（{@code billing_cost_reservations} 不暴露给用户端）。
 *
 * <p>于是未结算的行该怎么显示，只有一种合法写法：{@code amount} 放**那一行要展示的
 * 唯一金额**，由 {@code status} 表达它是不是最终值：
 * <ul>
 *   <li>{@code pending} —— 该任务是「处理中」，{@code amount} 是预扣时按契约用量
 *       算出的**预计消耗**，与用户当时在提交界面看到的数一致</li>
 *   <li>{@code done} —— 结算已发生，{@code amount} 是**实际消耗**（最终值）</li>
 * </ul>
 * 这正是《计费逻辑详细设计》§2.3 的原文口径：「用户只看到一行『处理中 · 预计消耗 40』
 * 变成『已完成 · 消耗 30』」（同见 {@code CreditService} / {@code Reservation} 的类注释）。
 * 两个数**不会同时出现**——它们先后占同一个字段。
 *
 * @param id        流水 id（{@code lot:} / {@code res:} / {@code led:} 前缀 + 该来源的主键）。
 *                  前缀不是装饰：三类来源的 id 各自独立自增，不带前缀就会撞
 * @param type      见 {@link TransactionType}
 * @param direction {@code in}（进账）| {@code out}（出账）——由 {@code TransactionMapper.xml} 判定
 * @param title     展示文案快照（消费行是提交时的任务标题；发放类由来源决定）
 * @param amount    整数积分，**该行唯一的金额**（语义随 status，见上）
 * @param status    {@code pending} | {@code done}
 * @param createdAt 记账/提交时刻
 * @param settledAt 结算时刻；未结算（{@code pending}）为 null
 */
public record TransactionView(
        String id,
        String type,
        String direction,
        String title,
        long amount,
        String status,
        Instant createdAt,
        Instant settledAt
) {

    /**
     * 一页流水。
     *
     * <p>游标分页而不是 offset：账本与流水持续新增，offset 分页会在翻页时漏掉
     * 新插入的行、或重复已经看过的行（{@code common/v1/types.proto} 的 {@code PageRequest}
     * 注释写了这条）。所以这里**没有总数**——总数与游标分页是矛盾的：
     * 要给出准确总数就得扫全表，而扫完全表的那一刻它又变了。
     *
     * @param items         本页的行，按时间倒序
     * @param nextPageToken 空 = 没有下一页；非空则原样回传给下一次请求
     */
    public record Page(List<TransactionView> items, String nextPageToken) {

        public Page {
            items = List.copyOf(items);
        }
    }
}
