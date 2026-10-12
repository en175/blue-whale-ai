package com.bluewhale.billing.application;

import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.ReservationRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.TransactionRepository;
import com.bluewhale.billing.application.command.ChargeCommand;
import com.bluewhale.billing.application.command.QuoteQuery;
import com.bluewhale.billing.domain.ledger.ChargeResult;
import com.bluewhale.billing.domain.pricing.DiscountResolver;
import com.bluewhale.billing.domain.pricing.MediaPricingCalculator;
import com.bluewhale.billing.domain.pricing.Usage;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChargeQuotePricingEquivalenceTest {

    private static final String MODEL = "seedream-4.0";
    private static final String TASK = "text2image";
    private static final long JOB = 9001L;
    private static final long USER = 42L;

    private static final int DISCOUNT_BP = 7_000;

    private static final int NO_DISCOUNT_BP = 10_000;

    private static final String RULE_SNAPSHOT = """
            {"baseUnit":"usage.succeededSlots",
             "basePrice":{"kind":"const","value":3000},
             "unitDenominator":1,"minCredits":1}
            """;

    private static final Map<String, String> SPECS =
            Map.of("size", "2k", "expected_output_count", "2");

    private static BillingApplicationService service(int discountBp, CreditService credits) {
        CatalogHolder catalog = mock(CatalogHolder.class);
        when(catalog.currentVersion()).thenReturn(1);
        return new BillingApplicationService(
                new MediaPricingCalculator(DiscountResolver.frozen(discountBp)),
                credits,
                mock(CreditLotRepository.class),
                catalog,
                new GrantPolicy(),
                mock(TransactionRepository.class),
                mock(ReservationRepository.class));
    }

    private static long chargedCredits(int discountBp) {
        CreditService credits = mock(CreditService.class);
        when(credits.charge(anyLong(), anyString(), anyLong(), anyLong(), anyInt(), anyInt(),
                any(), any()))
                .thenAnswer(invocation -> ChargeResult.fresh(invocation.getArgument(3),
                        invocation.getArgument(4)));

        service(discountBp, credits).charge(new ChargeCommand(
                USER, "cmd-equiv", JOB, MODEL, TASK, SPECS, "free",
                "生成任务", LocalDateTime.now(), RULE_SNAPSHOT));

        ArgumentCaptor<Long> charged = ArgumentCaptor.forClass(Long.class);
        ArgumentCaptor<Integer> discount = ArgumentCaptor.forClass(Integer.class);
        verify(credits).charge(anyLong(), anyString(), anyLong(), charged.capture(),
                anyInt(), discount.capture(), any(), any());

        assertThat(discount.getValue()).isEqualTo(discountBp);

        return charged.getValue();
    }

    private static long quotedCredits(int discountBp) {
        return service(discountBp, mock(CreditService.class))
                .quote(new QuoteQuery(USER, MODEL, TASK, SPECS, "free",
                        Usage.empty(), LocalDateTime.now(), RULE_SNAPSHOT))
                .credits();
    }


    @Test
    void 同一份规则与同一个折扣下_报价与扣款同价() {
        assertThat(quotedCredits(DISCOUNT_BP)).isEqualTo(chargedCredits(DISCOUNT_BP));
    }

    @Test
    void 两侧都真的用上了折扣() {
        assertThat(chargedCredits(DISCOUNT_BP)).isLessThan(chargedCredits(NO_DISCOUNT_BP));
        assertThat(quotedCredits(DISCOUNT_BP)).isLessThan(quotedCredits(NO_DISCOUNT_BP));
    }
}
