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
 * <p>为什么「充值本金永久、赠送有期」：退款只退本金，本金若会过期，
 * 用户就有理由说「我买的东西消失了」。赠送是平台给的，设有效期才合理。
 */
@Component
public class GrantPolicy {

    /** 每日登录赠送：当日 23:59:59 过期——当日不领就作废，这是「每日」的题中之义。 */
    private static final LocalTime END_OF_DAY = LocalTime.of(23, 59, 59);

    /**
     * 运营类赠送的默认有效期。
     *
     * <p>public 是因为**临期提醒的时间窗必须比它大**：两者相等时，刚发的一批积分恰好
     * 压在窗口边界上，能不能显示取决于插入时的亚秒进位（DATETIME 列会把小数秒四舍五入）
     * 与查询时刻的先后——同一份数据时而显示时而不显示。
     * 见 {@code BillingApplicationService.EXPIRING_WINDOW_DAYS}。
     */
    public static final int DEFAULT_GIFT_DAYS = 30;

    /** 事故补偿给最长的有效期：平台欠用户的，不该再设短期限制。 */
    private static final int COMPENSATION_DAYS = 365;

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

            // ★ 用户自己花钱买的，以及拉新成本里最基础的注册赠送 —— 永久。
            //   二者都不设有效期：purchased 是因为「买的东西不该消失」，
            //   register 是因为新用户刚来，第一批积分就带过期提醒是纯粹的劝退。
            case PURCHASED, REGISTER -> null;
        };
    }
}
