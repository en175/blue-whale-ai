package com.bluewhale.billing.application.view;

import java.time.Instant;
import java.util.List;

/**
 * 用户可见流水的一行（**一个业务动作一行**，契约见
 * {@code contracts/proto/billing/v1/billing.proto} 的 {@code UserTransaction}）。
 *
 * <h2>为什么只有一个金额</h2>
 *
 * ⚠️ 用户可见界面**永远只出现一个金额**（《计费逻辑详细设计》§2.3.1）：{@code amount}
 * 放**那一行要展示的唯一金额**，由 {@code status} 表达它是不是最终值：
 * <ul>
 *   <li>{@code pending} —— 该任务是「处理中」，{@code amount} 是预扣时按契约用量
 *       算出的**预计消耗**，与用户当时在提交界面看到的数一致</li>
 *   <li>{@code done} —— 结算已发生，{@code amount} 是**实际消耗**（最终值）</li>
 * </ul>
 * 这正是《计费逻辑详细设计》§2.3 的原文口径：「用户只看到一行『处理中 · 预计消耗 40』
 * 变成『已完成 · 消耗 30』」（同见 {@code CreditService} / {@code Reservation} 的类注释）。
 * 两个数**不会同时出现**——它们先后占同一个字段。
 *
 * <h2>那 {@code reservedCredits} 算什么</h2>
 *
 * <p>它是**管理面独用**的一列：预扣与实际之间的差额、以及分配了哪些批次，只对客服/运营
 * 后台可见（{@code billing_cost_reservations} 不暴露给用户端）。用户面契约
 * {@code UserTransaction} 里**没有**这个字段，{@link com.bluewhale.billing.adapter.inbound.grpc.BillingGrpcService}
 * **刻意不投影它**——与 {@code userId} 完全同一种处理，所以「用户界面只出现一个金额」
 * 这条硬规则由适配器守住，而不是靠上游少读一列。
 *
 * <p>为什么管理端非要这一列：结算后 {@code amount} 换成了实际值，预扣额就再也无处可读。
 * 用户看到余额先降 12、后回来 11，流水上只有一行「-1」——没有这一列就没人交代得了
 * 那 11 的来回（实测任务 1943：冻 12、实扣 1）。
 *
 * @param id        流水 id（{@code lot:} / {@code res:} / {@code led:} 前缀 + 该来源的主键）。
 *                  前缀不是装饰：三类来源的 id 各自独立自增，不带前缀就会撞
 * @param userId    归属用户。用户面（按 userId 过滤）时它恒等于入参、没有信息量；
 *                  **管理面**（{@code BillingAdminService.AdminListTransactions}）才是它的用武之地——
 *                  全站流水每一行都得能回答「这是谁的」。契约 {@code UserTransaction} 里
 *                  **没有**这个字段，gRPC 适配器不投影它——用户看见的永远只有自己那份
 * @param type      见 {@link TransactionType}
 * @param direction {@code in}（进账）| {@code out}（出账）——由 {@code TransactionMapper.xml} 判定
 * @param title     展示文案快照（消费行是提交时的任务标题；发放类由来源决定）
 * @param amount    整数积分，**该行唯一的金额**（语义随 status，见上）
 * @param reservedCredits 该行预留当初冻了多少（整数积分，恒正）；**只有消费行有值**，
 *                  发放行与账本行为 {@code null}（不是 0——0 是「冻了 0 分」）。
 *                  只读不参与任何计算：它不改变 amount，也不参与结算
 * @param generationJobId 该行关联的生成任务；**只有消费行有值**，发放行与账本行为 {@code null}。
 *                  ⚠️ 它是给 backend 用的 join key，不是给人看的：任务的类型 / 模型 / 提示词
 *                  都在 backend 自己的库（ADR-0114 不共享库），由管理面 BFF 拿这批 id
 *                  回自己库批量查后合并。用户面适配器**不投影**它，与 userId / reservedCredits 同款
 * @param status    {@code pending} | {@code done}
 * @param createdAt 记账/提交时刻
 * @param settledAt 结算时刻；未结算（{@code pending}）为 null
 */
public record TransactionView(
        String id,
        long userId,
        String type,
        String direction,
        String title,
        long amount,
        Long reservedCredits,
        Long generationJobId,
        String status,
        Instant createdAt,
        Instant settledAt
) {

    /**
     * 一页流水。
     *
     * <p>⚠️ 2026-09-30 由游标改为 offset，并带上 {@code total}。此前这里写的是
     * 「游标分页而不是 offset：账本持续新增，offset 会漏行；所以没有总数 ——
     * 总数与游标分页是矛盾的」。**那段话仍然成立**：要给出准确总数就得扫全表，
     * 而扫完全表的那一刻它又变了，所以 {@code total} 与当页的行**本来就可能不同步**
     * （翻页途中有人充值，第 1 页的行数就会比总数少）。产品接受这个不一致，
     * 换的是列表上的「共 N 条」与页码；留痕见前端对接文档 §6.2。
     *
     * @param items 本页的行，按时间倒序
     * @param total 满足同一组条件的总条数。调用方用它算总页数，**不要**拿它与
     *              {@code items.size()} 比对来推断「还有没有下一页」——两者不同步是正常的
     */
    public record Page(List<TransactionView> items, long total) {

        public Page {
            items = List.copyOf(items);
        }
    }
}
