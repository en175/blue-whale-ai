package com.bluewhale.billing.application;

import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.application.command.ChargeCommand;
import com.bluewhale.billing.application.command.QuoteQuery;
import com.bluewhale.billing.domain.ledger.ChargeResult;
import com.bluewhale.billing.infrastructure.persistence.repository.ReservationRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.TransactionRepository;
import com.bluewhale.billing.domain.pricing.ContractSource;
import com.bluewhale.billing.domain.pricing.DiscountResolver;
import com.bluewhale.billing.domain.pricing.MediaPricingCalculator;
import com.bluewhale.billing.domain.pricing.Usage;
import com.bluewhale.billing.domain.pricing.UsageDim;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;
import java.util.Map;

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

    private final BillingApplicationService billing;

    ReferenceCountSurchargeTest() {
        when(credits.charge(anyLong(), anyString(), anyLong(), anyLong(), anyInt(), anyInt(),
                any(), any()))
                .thenAnswer(invocation -> ChargeResult.fresh(invocation.getArgument(3),
                        invocation.getArgument(4)));

        billing = new BillingApplicationService(
                new MediaPricingCalculator(DiscountResolver.NONE),
                credits,
                mock(CreditLotRepository.class),
                mock(com.bluewhale.billing.application.CatalogHolder.class),
                new GrantPolicy(),
                mock(TransactionRepository.class),
                mock(ReservationRepository.class));
    }


    @Test
    @DisplayName("★ 参考素材加价：扣款与报价是同一个数")
    void 参考素材加价_扣款与报价同一个数() {
        long charged = chargedCredits();

        assertThat(charged).isEqualTo(14L);
        assertThat(quotedCredits()).isEqualTo(charged);
    }


    @Test
    @DisplayName("★ wire 键与规格键的名字 —— worker 与 billing 不能各写一套")
    void 键名两个都不能漂() {
        assertThat(UsageDim.REFERENCE_COUNT.key()).isEqualTo("usage.referenceCount");
        assertThat(UsageDim.REFERENCE_COUNT.contractSource())
                .isEqualTo(new ContractSource.SpecKey("reference_count"));
    }


    private long chargedCredits() {
        billing.charge(new ChargeCommand(USER, CMD, JOB, MODEL, TASK, SPECS, "free",
                "生成任务", LocalDateTime.now(), RULE));

        ArgumentCaptor<Long> amount = ArgumentCaptor.forClass(Long.class);
        verify(credits).charge(eq(USER), eq(CMD), eq(JOB), amount.capture(),
                anyInt(), anyInt(), anyString(), anyString());
        return amount.getValue();
    }

    private long quotedCredits() {
        return billing.quote(new QuoteQuery(USER, MODEL, TASK, SPECS, "free",
                Usage.empty(), LocalDateTime.now(), RULE)).credits();
    }
}
