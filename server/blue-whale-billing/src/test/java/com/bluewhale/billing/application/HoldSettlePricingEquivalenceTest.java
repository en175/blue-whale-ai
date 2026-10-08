package com.bluewhale.billing.application;

import com.bluewhale.billing.adapter.outbound.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.adapter.outbound.persistence.repository.LedgerRepository;
import com.bluewhale.billing.adapter.outbound.persistence.repository.ReservationRepository;
import com.bluewhale.billing.adapter.outbound.persistence.repository.TransactionRepository;
import com.bluewhale.billing.application.command.HoldCommand;
import com.bluewhale.billing.application.command.SettlementCommand;
import com.bluewhale.billing.application.command.SettlementUsageLine;
import com.bluewhale.billing.domain.ledger.HoldResult;
import com.bluewhale.billing.domain.ledger.Reservation;
import com.bluewhale.billing.domain.pricing.DiscountResolver;
import com.bluewhale.billing.domain.pricing.MediaPricingCalculator;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HoldSettlePricingEquivalenceTest {

    private static final String MODEL = "seedream-4.0";
    private static final String TASK = "text2image";
    private static final long JOB = 9001L;
    private static final long USER = 42L;
    private static final long SLOTS = 2L;

    private static final int DISCOUNT_BP = 7_000;

    private static final int NO_DISCOUNT_BP = 10_000;

    private static final String RULE_SNAPSHOT = """
            {"baseUnit":"usage.succeededSlots",
             "basePrice":{"kind":"const","value":3000},
             "unitDenominator":1,"minCredits":1}
            """;

    private static final Map<String, String> SPECS =
            Map.of("size", "2k", "expected_output_count", "2");


    private static long reservedCredits(int discountBp) {
        CreditService credits = mock(CreditService.class);
        CatalogHolder catalog = mock(CatalogHolder.class);
        when(catalog.currentVersion()).thenReturn(1);
        when(credits.hold(anyLong(), anyString(), anyLong(), anyLong(), anyInt(), anyInt(),
                any(), any()))
                .thenAnswer(invocation -> HoldResult.fresh(invocation.getArgument(3),
                        invocation.getArgument(4)));

        var service = new BillingApplicationService(
                new MediaPricingCalculator(DiscountResolver.frozen(discountBp)),
                credits,
                mock(CreditLotRepository.class),
                mock(LedgerRepository.class),
                catalog,
                new GrantPolicy(),
                mock(TransactionRepository.class),
                mock(ReservationRepository.class));

        service.hold(new HoldCommand(USER, "cmd-equiv", JOB, MODEL, TASK, SPECS, "free",
                "生成任务", Instant.now(), RULE_SNAPSHOT));

        ArgumentCaptor<Long> reserved = ArgumentCaptor.forClass(Long.class);
        ArgumentCaptor<Integer> frozenBp = ArgumentCaptor.forClass(Integer.class);
        verify(credits).hold(anyLong(), anyString(), anyLong(), reserved.capture(),
                anyInt(), frozenBp.capture(), any(), any());

        assertThat(frozenBp.getValue()).isEqualTo(discountBp);

        return reserved.getValue();
    }

    private static long settledCredits(int discountBp) {
        ReservationRepository reservations = mock(ReservationRepository.class);
        CreditService credits = mock(CreditService.class);
        when(reservations.findByJobId(JOB)).thenReturn(Optional.of(new Reservation(
                1L, JOB, USER,                                    0L,
                null, 0L, Reservation.Status.HELD, List.of(), 1, discountBp, RULE_SNAPSHOT,
                "生成任务", null)));

        var settlement = new SettlementService(reservations, credits);
        settlement.settle(new SettlementCommand(JOB, USER, "succeeded", 1, (int) SLOTS,
                List.of(new SettlementUsageLine(MODEL, TASK,
                        Map.of("usage.succeededSlots", SLOTS), SPECS))));

        ArgumentCaptor<Long> settled = ArgumentCaptor.forClass(Long.class);
        verify(credits).settle(eq(JOB), settled.capture());
        return settled.getValue();
    }


    @Test
    void 同一份规则与同一个折扣下_结算复现预扣价() {
        assertThat(settledCredits(DISCOUNT_BP)).isEqualTo(reservedCredits(DISCOUNT_BP));
    }

    @Test
    void 两侧都真的用上了折扣() {
        assertThat(reservedCredits(DISCOUNT_BP)).isLessThan(reservedCredits(NO_DISCOUNT_BP));
        assertThat(settledCredits(DISCOUNT_BP)).isLessThan(settledCredits(NO_DISCOUNT_BP));
    }
}
