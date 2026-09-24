package com.bluewhale.billing.infrastructure.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.domain.entity.CreditLotEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 积分批次 Mapper。
 *
 * <h2>为什么这个接口里几乎没有方法</h2>
 *
 * 单行读写（按 id 查、插入、按主键取来源）都由 {@link BaseMapper} 提供，
 * 调用方用 {@code LambdaQueryWrapper} 拼条件即可——**这类 SQL 是纯样板**，
 * 手写只会多一处改列名时要同步的地方。
 *
 * <p>下面这五个方法例外，它们各自带着 Wrapper 表达不了的东西，
 * 因此语句落在 {@code resources/mapper/CreditLotMapper.xml}：
 * <ul>
 *   <li>{@link #lockActiveLots} —— 四级 ORDER BY（含 {@code expires_at IS NULL} 这种布尔排序）
 *       与 {@code FOR UPDATE} 行锁</li>
 *   <li>{@link #sumAvailable} —— 聚合表达式 {@code SUM(remaining - frozen)}</li>
 *   <li>三个相对更新 —— {@code SET frozen = frozen + ?} 这类**自引用表达式**，
 *       Wrapper 的 set 只能赋常量</li>
 * </ul>
 */
@Mapper
public interface CreditLotMapper extends BaseMapper<CreditLotEntity> {

    /**
     * ★ 锁该用户的全部有效批次，按扣减顺序排好序返回（《计费逻辑详细设计》§4.1）。
     *
     * <p>三级 tie-break：{@code (expires_at IS NULL)} → {@code expires_at ASC}
     * → {@code source_priority ASC} → {@code id ASC}。
     *
     * <p>过期批次靠 WHERE 天然排除，不需要定时任务清理。
     */
    List<CreditLotEntity> lockActiveLots(@Param("userId") long userId);

    /** 可用余额 = Σ(remaining − frozen)，仅计未过期的批次。 */
    long sumAvailable(@Param("userId") long userId);

    /** 冻结：预扣用。**只动 frozen**，remaining 不动。 */
    int addFrozen(@Param("lotId") long lotId, @Param("amount") long amount);

    /** 解冻：返还用。**只动 frozen**，并保留批次有效期。 */
    int releaseFrozen(@Param("lotId") long lotId, @Param("amount") long amount);

    /**
     * 结算：解冻并实扣。
     *
     * @param frozenTake 预扣时锁定的量
     * @param actualTake 实际消耗的量；差额自动回到可用余额
     */
    int settle(@Param("lotId") long lotId,
               @Param("frozenTake") long frozenTake,
               @Param("actualTake") long actualTake);
}
