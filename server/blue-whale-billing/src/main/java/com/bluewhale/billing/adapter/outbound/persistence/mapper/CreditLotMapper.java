package com.bluewhale.billing.adapter.outbound.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.adapter.outbound.persistence.entity.CreditLotEntity;
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
 * <p>下面这八个方法例外，它们各自带着 Wrapper 表达不了的东西，
 * 因此语句落在 {@code resources/mapper/CreditLotMapper.xml}：
 * <ul>
 *   <li>{@link #lockActiveLots} —— 四级 ORDER BY（含 {@code expires_at IS NULL} 这种布尔排序）
 *       与 {@code FOR UPDATE} 行锁</li>
 *   <li>{@link #sumAvailable} —— 聚合表达式 {@code SUM(remaining - frozen)}</li>
 *   <li>{@link #listDueLots} —— 全表范围的 {@code expires_at} 区间扫描 + LIMIT（过期核销用），
 *       与下面三个「只针对某个用户」的取数不是一回事</li>
 *   <li>{@link #lockById} —— 按主键读并锁住该行（核销要「读到什么就销掉什么」）</li>
 *   <li>{@link #expireLot} —— 自引用表达式 {@code remaining = remaining - ?}，
 *       与下面三个相对更新同类</li>
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
     * <p>过期批次靠 WHERE 天然排除，**不靠定时任务删行**（行不删，见 {@link #expireLot}）。
     */
    List<CreditLotEntity> lockActiveLots(@Param("userId") long userId);

    /** 可用余额 = Σ(remaining − frozen)，仅计未过期的批次。 */
    long sumAvailable(@Param("userId") long userId);

    /**
     * 已到期、仍有可核销量的批次（**跨全部用户**，最久到期的在前）。
     *
     * <p>它不是「某个用户的余额」类取数，所以不带 userId：核销是平台侧按批次推的
     * 定时动作，逐用户分片只会把同一件事拆成 N 次全表扫描。
     *
     * @param limit 本轮最多取几条（防止一次把积压几年、早已到期的批次全拉进内存）
     */
    List<CreditLotEntity> listDueLots(@Param("limit") int limit);

    /**
     * 按主键读一行并**锁住它**（{@code FOR UPDATE}）。
     *
     * <p>核销必须「读到什么就销掉什么」：金额由读到的
     * {@code remaining − frozen} 算出，读与写之间的任何并发都会让这个差失去意义。
     *
     * @return 不存在时 {@code null}
     */
    CreditLotEntity lockById(@Param("lotId") long lotId);

    /**
     * 核销：把 {@code remaining} 减掉已算好的量，**冻结部分原封不动**。
     *
     * <p>为什么必须动 {@code remaining} 而不是只写一条账本分录：批次表是余额的唯一权威，
     * 而每日自检钉的恒等式是 {@code Σ lots.remaining == ledger(wallet) + ledger(frozen)}。
     * 只销账本不改批次，两边当场差一个「已核销额」——那是最像真事的假警报。
     *
     * <p>调用方先按 {@link #lockById} 读到的值算好 {@code amount}，再来这里扣。
     */
    int expireLot(@Param("lotId") long lotId, @Param("amount") long amount);

    /**
     * 临期批次 —— 前端展示「X 积分将于 Y 日过期」用。
     *
     * @param withinDays 只看这么多天内到期的；更远的不用提醒
     * @param limit      最多返回几条（按到期时间从近到远）
     */
    List<CreditLotEntity> listExpiring(@Param("userId") long userId,
                                       @Param("withinDays") int withinDays,
                                       @Param("limit") int limit);

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
