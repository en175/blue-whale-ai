package com.bluewhale.billing.infrastructure.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 跨表对账查询（《计费逻辑详细设计》§9 层次①）。
 *
 * <h2>为什么它不是 BaseMapper、也不挂在 CreditLotMapper / LedgerEntryMapper 上</h2>
 *
 * 下面三条查询横跨 {@code billing_credit_lots}（余额的唯一权威）与
 * {@code billing_ledger_entries}（复式账本），而这两张表分别归
 * {@code CreditLotRepository} 与 {@code LedgerRepository} 管。塞进任一侧，
 * 那一侧的读者会以为「这些表是我一个人的」——下一次改批次表结构的人不会去翻账本仓库。
 *
 * <h2>⚠️ 三条查询都不在扣费路径上</h2>
 *
 * 它们做的是**全表聚合**，一条可能要几百毫秒到几秒。只有每日自检调用它们，
 * 换来的是「预扣事务永远 < 5ms」——那个预算一旦被一条全表扫打破，
 * 表现是所有用户的提交一起变慢，而 P95 升高时没人会想到是「对账查询写的」。
 *
 * <p>口径上的取舍见 {@code ReconciliationMapper.xml} 的注释：这里只比
 * {@code Σ lots.remaining} 与 {@code ledger(wallet) + ledger(frozen)}，
 * 不比 revenue/cost（那两个科目是平台侧口径，与用户余额不是同一个恒等式）。
 */
@Mapper
public interface ReconciliationMapper {

    /**
     * Σ 全部批次的 {@code remaining}（**含已过期未核销**）。
     *
     * <p>已过期的批次没有被扣掉：过期靠查询条件排除，不靠改写数据（见
     * {@code CreditLotMapper.lockActiveLots} 的注释）。而账本的 wallet 同样没有
     * 因过期而减少——**两边口径因此是对齐的**，不必在 SQL 里加 expires_at 条件。
     * 加了反而会把「过期核销还没落地」这件事伪装成不平。
     */
    long sumLotsRemaining();

    /**
     * Σ 全部用户 {@code (wallet + frozen)} 的**最近一笔余额快照**。
     *
     * <p>读快照而不是 SUM 分录的增减：快照能把「余额对不对」与「历史累计对不对」
     * 分开——两者本来等价，但一旦某处断裂，快照会立刻显形，SUM 会把错误抹平
     * （这正是 {@code LedgerRepository.balanceOf} 的注释里同一条理由）。
     *
     * <p>{@code wallet} 与 {@code frozen} 一起加，是因为它们是**同一笔钱的两个状态**：
     * 预扣只是把钱从「可用」挪到「受限」，用户的总资产不变（见 {@code Account.FROZEN}）。
     */
    long sumLedgerBalance();

    /**
     * 找出「批次总量 ≠ 账本余额」的用户，按差额绝对值从大到小。
     *
     * <p>只看这两个数的差额**不足以知道谁错了**（可能是批次被直接改过，也可能是
     * 某笔分录没写），所以它只是**定位的起点**：拿到用户后，
     * {@code LedgerRepository.findBalanceBreaks} 再沿 {@code balance_after} 走一遍，
     * 把断点落在具体分录上。
     *
     * <p>结果**两边的用户都要收**：某人的批次行被删干净、只剩账本，也必须报出来
     * （这正是「批次是余额唯一权威」被破坏的样子）。
     *
     * @param limit 最多返回几条——不平的用户可能有几千个，日志里全量打印等于没打印；
     *              调用方据「返回条数 == limit」判断是否被截断
     */
    List<UserImbalanceRow> imbalancedUsers(@Param("limit") int limit);
}
