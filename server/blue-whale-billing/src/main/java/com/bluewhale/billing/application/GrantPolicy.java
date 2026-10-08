package com.bluewhale.billing.application;

import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.domain.ledger.CreditSource;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;

@Component
public class GrantPolicy {

    private static final LocalTime END_OF_DAY = LocalTime.of(23, 59, 59);

<<<<<<< HEAD
    private static final int DEFAULT_GIFT_DAYS = 30;
=======
    public static final int DEFAULT_GIFT_DAYS = 30;
>>>>>>> b21e3ef7a (fix: 补齐全仓维护范围注释清理)

    private static final int COMPENSATION_DAYS = 365;

    private static final int PURCHASED_YEARS = 2;

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

            case PURCHASED -> grantedAt.atZone(DbTime.ZONE)
                    .plusYears(PURCHASED_YEARS)
                    .toInstant();

            case REGISTER -> null;
        };
    }
}
