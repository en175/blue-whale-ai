package com.bluewhale.billing.application;

import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.application.command.HoldCommand;
import com.bluewhale.billing.application.command.SettlementCommand;
import com.bluewhale.billing.application.command.SettlementUsageLine;
import com.bluewhale.billing.domain.ledger.HoldResult;
import com.bluewhale.billing.infrastructure.persistence.repository.LedgerRepository;
import com.bluewhale.billing.domain.ledger.Reservation;
import com.bluewhale.billing.infrastructure.persistence.repository.ReservationRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.TransactionRepository;
import com.bluewhale.billing.domain.pricing.ContractSource;
import com.bluewhale.billing.domain.pricing.DiscountResolver;
import com.bluewhale.billing.domain.pricing.MediaPricingCalculator;
import com.bluewhale.billing.domain.pricing.UsageDim;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;
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

class ReferenceCountSurchargeTest {

    private static final String MODEL = "seedream-4.0";
    private static final String TASK = "text2image";
    private static final long JOB = 9001L;
    private static final long USER = 44L;
    private static final String CMD = "cmd-9001";

    private static final String RULE = """
            {"baseUnit":"usage.succeededSlots",
             "basePrice":{"kind":"const","value":3000},
             "multipliers":{"usage.referenceCount":12000},
             "unitDenominator":1,"minCredits":1}
            """;

    private static final Map<String, String> SPECS = Map.of(
            "expected_output_count", "2", "size", "2k", "reference_count", "2");

    private final CreditService credits = mock(CreditService.class);
    private final ReservationRepository reservations = mock(ReservationRepository.class);

    private final BillingApplicationService billing;
    private final SettlementService settlement;

    ReferenceCountSurchargeTest() {
        when(credits.hold(anyLong(), anyString(), anyLong(), anyLong(), anyInt(), anyInt(),
                any(), any()))
                .thenAnswer(invocation -> HoldResult.fresh(invocation.getArgument(3),
                        invocation.getArgument(4)));

        billing = new BillingApplicationService(
                new MediaPricingCalculator(DiscountResolver.NONE),
                credits,
                mock(CreditLotRepository.class),
                mock(LedgerRepository.class),
                mock(com.bluewhale.billing.application.CatalogHolder.class),
                new GrantPolicy(),
                mock(TransactionRepository.class),
                mock(ReservationRepository.class));

        settlement = new SettlementService(reservations, credits);
    }


    @Test
    @DisplayName("★ 参考素材加价：预扣冻的价 == 结算收的价（同一个参考数）")
    void 参考素材加价_预扣与结算同一个数() {
        long frozen = frozenCredits();

        assertThat(frozen).isEqualTo(14L);

        reservation(frozen);
        settle("succeeded", Map.of("usage.succeededSlots", 2L, "usage.referenceCount", 2L));

        assertThat(settledCredits()).isEqualTo(frozen);
    }

    @Test
    @DisplayName("★ 结算漏报参考素材数时加价被退回 —— 本单修的就是这条")
    void 漏报参考素材数_加价被退回() {
        long frozen = frozenCredits();
        reservation(frozen);

        settle("succeeded", Map.of("usage.succeededSlots", 2L));

        assertThat(settledCredits()).isEqualTo(6L).isLessThan(frozen);
    }


    @Test
    @DisplayName("★ wire 键与规格键的名字 —— worker 与 billing 不能各写一套")
    void 键名两个都不能漂() {
        assertThat(UsageDim.REFERENCE_COUNT.key()).isEqualTo("usage.referenceCount");
        assertThat(UsageDim.REFERENCE_COUNT.contractSource())
                .isEqualTo(new ContractSource.SpecKey("reference_count"));
    }


    private long frozenCredits() {
        billing.hold(new HoldCommand(USER, CMD, JOB, MODEL, TASK, SPECS, "free",
                "生成任务", LocalDateTime.now(), RULE));

        ArgumentCaptor<Long> amount = ArgumentCaptor.forClass(Long.class);
        verify(credits).hold(eq(USER), eq(CMD), eq(JOB), amount.capture(),
                anyInt(), anyInt(), anyString(), anyString());
        return amount.getValue();
    }

    private void reservation(long reservedCredits) {
        when(reservations.findByJobId(JOB)).thenReturn(Optional.of(new Reservation(
                1L, JOB, USER, reservedCredits, null, 0L, Reservation.Status.HELD,
                List.of(), 1, 10_000, RULE, "测试任务", null)));
    }

    private void settle(String status, Map<String, Long> quantities) {
        settlement.settle(new SettlementCommand(JOB, USER, status, 1,
                quantities.getOrDefault("usage.succeededSlots", 0L).intValue(),
                List.of(new SettlementUsageLine(MODEL, TASK, quantities,
                        Map.of("size", "2k")))));
    }

    private long settledCredits() {
        ArgumentCaptor<Long> amount = ArgumentCaptor.forClass(Long.class);
        verify(credits).settle(eq(JOB), amount.capture());
        return amount.getValue();
    }
}
