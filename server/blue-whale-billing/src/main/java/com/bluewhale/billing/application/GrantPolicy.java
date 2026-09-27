package com.bluewhale.billing.application;

import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.domain.ledger.CreditSource;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;

/**
 * 发放策略 —— **每种积分来源的有效期规则**。
 *
 * <p>集中在一处，是因为它决定三件互相牵连的事：用户看到「X 分将于 Y 日过期」、
 * 扣减顺序（先过期先扣）实际扣到哪一批、以及过期核销要销掉多少。
 * 散落在各发放入口里，迟早出现「注册送的说永久、实际 30 天过期」这种没人能一眼看出的错。
 *
 * <p>⚠️ <b>下面的具体天数是从设计推导的默认值，不是产品确认过的数字。</b>
 * 定价与权益的最终口径归产品；改这里之前先确认。需要一次性特殊有效期时，
 * 管理端发放接口支持显式传入 {@code expiresAt} 覆盖本策略。
 *
 * <h2>为什么充值本金也有有效期（推翻此前「本金永久」的理由）</h2>
 *
 * <p>产品口径已定（《通用积分卡 PRD》§9.5 / §6.6）：到账积分 <b>2 年</b>有效、
 * 自订单支付成功时刻起算，且<b>赠送与同单基础积分同批同效期</b>——它们在库里本就是
 * 同一个订单批次，拆成两个到期时间只会让「先到期先扣」这一级凭空多出一种
 * 「同一批却不同期」的算不清的情况。
 *
 * <p>此前这里的理由是「退款只退本金，本金若会过期，用户就有理由说『我买的东西消失了』」。
 * 它被推翻，是因为它把一个**少数、人工核验、且只回收未使用部分**的出口（退款）
 * 当成了本金的常态去向：绝大多数积分是被花掉的。而「永久」在账上意味着平台
 * **无限期**背着一笔已收款、已确认成本的负债，永远没有清账的一天——
 * 有效期给这笔负债一个确定的终点，也让「平台赠送」与「用户购买」在账面上
 * 不再是一个有期、一个无期。
 *
 * <p>⚠️ 这条策略是**按发放时刻取数**的：改它只影响此后新发的批次，
 * 已落库批次的 {@code expires_at} 不会被回改。所以它不构成「改一行代码，
 * 存量余额当场缩水」——要动存量得走一次显式的数据迁移，那是另一件事。
 *
 * <h2>为什么这个策略住在 billing，而不是由各调用点传 {@code expiresAt}</h2>
 *
 * <p>调用点（backend 的充值到账、运营的发放接口、每日登录…）只该说「发什么、发多少」。
 * 有效期是**来源的属性**不是**入口的属性**：让每个入口自己传，等于把
 * 「充值本金 2 年」这条产品约定复制成 N 份调用点各自的记忆，
 * 而其中任何一份忘了跟改，都会静默地发出一批与别人有效期不同的积分。
 * 放在这里，改一处所有入口同时正确；入口只保留「显式覆盖」这一个例外通道。
 */
@Component
public class GrantPolicy {

    /** 每日登录赠送：当日 23:59:59 过期——当日不领就作废，这是「每日」的题中之义。 */
    private static final LocalTime END_OF_DAY = LocalTime.of(23, 59, 59);

    /**
     * 运营类赠送的默认有效期。
     *
     * <p>public 是因为**临期提醒的时间窗不得与它相等**（见
     * {@code BillingApplicationService.EXPIRING_WINDOW_DAYS}）：两者相等时，
     * 刚按默认策略发出的那批积分恰好压在窗口边界上——DATETIME 列会把小数秒
     * 四舍五入，而查询用的是执行那一刻的 {@code NOW()}，两者先后不定，
     * 同一份数据时而显示在「即将过期」里、时而消失。
     */
    public static final int DEFAULT_GIFT_DAYS = 30;

    /** 事故补偿给最长的有效期：平台欠用户的，不该再设短期限制。 */
    private static final int COMPENSATION_DAYS = 365;

    /**
     * 充值本金与充值赠送的有效期：**2 年**（《通用积分卡 PRD》§9.5 / §6.6 / §7.1）。
     *
     * <p>按**日历年**算而不是 730 天：「2 年有效」在用户那侧的直觉是
     * 「2026-09-27 充的，2028-09-27 到期」，而 730 天会在跨闰年时给出 09-26，
     * 差一天且没有解释得通的理由。{@link Instant} 不支持 {@code ChronoUnit.YEARS}
     * （它只支持到 DAYS），所以要借 zone 折算一次。
     */
    private static final int PURCHASED_YEARS = 2;

    /**
     * 该来源在 {@code grantedAt} 发放时的默认过期时刻。
     *
     * @return {@code null} = 永久
     */
    public Instant expiryFor(CreditSource source, Instant grantedAt) {
        return switch (source) {
            case DAILY -> grantedAt.atZone(DbTime.ZONE)
                    .toLocalDate()
                    .atTime(END_OF_DAY)
                    .atZone(DbTime.ZONE)
                    .toInstant();

            case BONUS, GIFT, INVITE, REDEEM, SUBSCRIPTION ->
                    grantedAt.plus(DEFAULT_GIFT_DAYS, ChronoUnit.DAYS);

            case COMPENSATION -> grantedAt.plus(COMPENSATION_DAYS, ChronoUnit.DAYS);

            // ★ 用户自己花钱买的：2 年。赠送类与它同批（同一订单写入同一批次），
            //   有效期自然一致——不是「也给了 2 年」，而是它们本来就是同一批。
            case PURCHASED -> grantedAt.atZone(DbTime.ZONE)
                    .plusYears(PURCHASED_YEARS)
                    .toInstant();

            // ★ 注册赠送仍然永久：新用户刚来，第一批积分就带过期提醒是纯粹的劝退，
            //   而它是拉新成本里最小的一笔（不随订单，也不随充值金额）。
            case REGISTER -> null;
        };
    }
}
