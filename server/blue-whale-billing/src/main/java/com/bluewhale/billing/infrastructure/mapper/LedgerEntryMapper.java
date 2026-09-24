package com.bluewhale.billing.infrastructure.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.domain.entity.LedgerEntryEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 复式账本 Mapper。
 *
 * <p><b>append-only</b>：{@link BaseMapper} 提供的 {@code updateById} / {@code deleteById}
 * 在本表上**永远不该被调用**。冲正靠反向分录，不靠改历史——
 * 改历史会让「当时到底发生了什么」永久不可考。
 */
@Mapper
public interface LedgerEntryMapper extends BaseMapper<LedgerEntryEntity> {

    /**
     * 取该 (用户, 科目) 的最近一笔余额快照，并**锁住那一行**。
     *
     * <p>{@code FOR UPDATE} 是**当前读**：并发方阻塞到前者提交后读到新的最新行，
     * 从而把同一 (user, account) 的累计串行化。没有它，两个事务会读到同一个
     * 「上一笔」，写出两个相同的 {@code balance_after}——金额都对，只有快照对不上，
     * 对账时断得无声无息。
     *
     * @return 无历史分录时返回 null（余额视为 0）
     */
    Long latestBalanceForUpdate(@Param("userId") long userId, @Param("account") String account);

    /**
     * 同上的**不加锁**版本，供只读的余额查询使用。
     *
     * <p>刻意与上面分成两个方法而不是加一个 boolean 参数：
     * 「这次读要不要加锁」是**调用点的性质**，不是运行期的开关。
     * 一个 boolean 参数到了调用处就变成难以辨认的 {@code latestBalance(u, a, true)}，
     * 而漏加/多加锁的后果（读路径持锁 vs 写路径漏锁）天差地别。
     */
    Long latestBalance(@Param("userId") long userId, @Param("account") String account);
}
