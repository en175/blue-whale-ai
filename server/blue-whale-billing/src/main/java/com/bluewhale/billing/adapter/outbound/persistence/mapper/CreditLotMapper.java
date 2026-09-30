package com.bluewhale.billing.adapter.outbound.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.bluewhale.billing.adapter.outbound.persistence.entity.CreditLotEntity;
import com.bluewhale.billing.adapter.outbound.persistence.row.SourceAvailableRow;
import com.bluewhale.billing.adapter.outbound.persistence.row.UserAmountRow;
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
 * <p>下面这十个方法例外，它们各自带着 Wrapper 表达不了的东西，
 * 因此语句落在 {@code resources/mapper/CreditLotMapper.xml}：
 * <ul>
 *   <li>{@link #lockActiveLots} —— 四级 ORDER BY（含 {@code expires_at IS NULL} 这种布尔排序）
 *       与 {@code FOR UPDATE} 行锁</li>
 *   <li>{@link #sumAvailable} —— 聚合表达式 {@code SUM(remaining - frozen)}</li>
 *   <li>{@link #sumAvailableByUser} / {@link #sumGrantedByUser} —— 同两个聚合的**批量版**
 *       （{@code user_id IN} + {@code GROUP BY}），管理端列表页用</li>
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
     * 可用余额**按来源拆开**：同一条 WHERE、同一个 {@code SUM(remaining - frozen)}，
     * 多一个 {@code GROUP BY source}。
     *
     * <p>⚠️ 与 {@link #sumAvailable} 共用谓词是**要求**而不是巧合：用户界面上的总额与
     * 各来源的分量必须对得上（Σ 分项 == 总额）。要改条件就两处一起改，
     * 只改一处会让界面上多出一个凑不出来的数。
     *
     * <p>返回的来源是「仍持有未过期批次」的那些；某来源可用为 0（全被冻结）时仍会返回。
     */
    List<SourceAvailableRow> sumAvailableBySource(@Param("userId") long userId);

    /**
     * 批量版的 {@link #sumAvailable}：一次问一批用户的可用余额（管理端用户列表）。
     *
     * <p>⚠️ WHERE 与 {@link #sumAvailable} **逐字相同**（只多一个 {@code user_id IN}）——
     * 这不是巧合，是要求：列表页那一列与详情页显示的必须是同一个数。两处谓词一旦分叉，
     * 运营会在列表上看到一个数、点进详情看到另一个，而两边都不报错。
     *
     * @param userIds 一批用户 id。**调用方须保证非空** —— 空集合会拼出 {@code IN ()}
     *                这个语法错误；本层不兜底，因为「压根没有用户可问」是调用方才知道的事
     *                （见 {@code BillingApplicationService#userStats} 的空集早返回）
     */
    List<UserAmountRow> sumAvailableByUser(@Param("userIds") List<Long> userIds);

    /**
     * 批量版的「按来源发放合计」：Σ{@code amount}，只算给定来源的批次。
     *
     * <p>管理端「累计充值」用它（传 {@code purchased}）：问的是用户**自己充了多少**，
     * 所以只算充值本金，不含充值赠送（赠送落在 {@code bonus} 那个来源上）。
     *
     * <p>⚠️ 取 {@code amount}（发放量）而不是 {@code remaining - frozen}（可用量）：
     * 消耗过之后可用量就小于发放量，而「累计充值」问的是历史充了多少，不是现在还剩多少。
     * {@code amount} 也是这份历史里唯一不会被后续动作改动的列（结算与过期核销都只动
     * {@code remaining}）。
     *
     * <p>⚠️ {@code source} 由调用方从 {@code CreditSource#key()} 传进来，**不在 SQL 里
     * 写字面量**：硬编码的 {@code source = 'purchased'} 会在枚举改名时静默变成
     * 「一条都查不到 → 全员 0」，而 0 看起来又是一个完全合法的数（同一个坑见本类上方
     * 关于 {@code source_priority} 的那段）。
     */
    List<UserAmountRow> sumGrantedByUser(@Param("userIds") List<Long> userIds,
                                         @Param("source") String source);

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

    /**
     * 用户的批次台账一页（积分明细「已获取」）。
     *
     * <p>⚠️ 与 {@link #listExpiring} **不是同一条**：那条筛掉已过期与已用光的批次，
     * 这条一个都不筛 —— 用户要看的是一份完整台账，不是「该提醒我什么」。
     * 理由写在 XML 里，改这条之前先读那段。
     *
     * <p>{@code userId} **必填**：这是用户侧取数，没有「不限用户」这个模式。
     * 传 0 只会得到空页，不会得到别人的账。
     *
     * @param offset 跳过多少行（由应用层按页码换算）
     * @param limit  本页条数
     */
    List<CreditLotEntity> listUserLots(@Param("userId") long userId,
                                       @Param("offset") long offset,
                                       @Param("limit") int limit);

    /**
     * 台账总数。WHERE 与 {@link #listUserLots} **逐字相同** ——
     * 分叉时「共 N 条」会与翻出来的行对不上，且不报错。
     */
    long countUserLots(@Param("userId") long userId);

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
