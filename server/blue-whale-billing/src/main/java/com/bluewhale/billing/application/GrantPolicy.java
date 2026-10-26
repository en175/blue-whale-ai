package com.bluewhale.billing.application;
import com.bluewhale.billing.domain.ledger.CreditSource;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;






































@Component
public class GrantPolicy {


    private static final LocalTime END_OF_DAY = LocalTime.of(23, 59, 59);

    private static final int DEFAULT_GIFT_DAYS = 30;


    private static final int COMPENSATION_DAYS = 365;









    private static final int PURCHASED_YEARS = 2;






    public LocalDateTime expiryFor(CreditSource source, LocalDateTime grantedAt) {
        return switch (source) {
            case DAILY -> grantedAt.toLocalDate()
                    .atTime(END_OF_DAY);

            case BONUS, GIFT, INVITE, REDEEM, SUBSCRIPTION ->
                    grantedAt.plus(DEFAULT_GIFT_DAYS, ChronoUnit.DAYS);

            case COMPENSATION -> grantedAt.plus(COMPENSATION_DAYS, ChronoUnit.DAYS);



            case PURCHASED -> grantedAt.plusYears(PURCHASED_YEARS);



            case REGISTER -> null;
        };
    }
}
