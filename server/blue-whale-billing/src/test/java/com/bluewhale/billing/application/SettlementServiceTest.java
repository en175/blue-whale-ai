package com.bluewhale.billing.application;

import com.bluewhale.billing.application.command.SettlementCommand;
import com.bluewhale.billing.application.command.SettlementUsageLine;
import com.bluewhale.billing.domain.ledger.Reservation;
import com.bluewhale.billing.adapter.outbound.persistence.repository.ReservationRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SettlementServiceTest {

    private static final String MODEL = "seedream-4.0";
    private static final String TASK = "text2image";
    private static final long JOB = 7001L;
    private static final long USER = 42L;

    private final ReservationRepository reservations = mock(ReservationRepository.class);
    private final CreditService credits = mock(CreditService.class);

    private final SettlementService settlement = new SettlementService(reservations, credits);


    @Test
    @DisplayName("★ 部分成功按成功槽结算，不是按整单 —— 本单存在的理由")
    void 部分成功_按成功槽结算() {
        hold(12L, perSlotRule(3_000L));

        settlement.settle(completed("partially_succeeded", 2,                2));

        assertThat(settledCredits()).isEqualTo(6L);
    }

    @Test
    @DisplayName("全成功且规则按次计价时，结算额与预扣额一致")
    void 全成功_按次计价_与预扣一致() {
        hold(100L, perCallRule(100_000L));

        settlement.settle(completed("succeeded", 3, 3));

        assertThat(settledCredits()).isEqualTo(100L);
    }

    @Test
    @DisplayName("多张全成功按槽累加 —— 按槽计价的规则里 4 张就是 4 张的钱")
    void 全成功_按槽计价_槽数相乘() {
        hold(12L, perSlotRule(3_000L));

        settlement.settle(completed("succeeded", 4, 4));

        assertThat(settledCredits()).isEqualTo(12L);
    }


    @Test
    @DisplayName("用量为空按预扣额结算 —— worker 报不出用量时的降级路径")
    void 用量为空_按预扣额结算() {
        hold(12L, perSlotRule(3_000L));

        settlement.settle(new SettlementCommand(
                JOB, USER, "succeeded", 1, 4, List.of()));

        assertThat(settledCredits()).isEqualTo(12L);
    }

    @Test
    @DisplayName("部分成功但用量为空时仍按全额（残留缺口，worker 侧有 WARN）")
    void 部分成功_用量为空_仍按全额() {
        hold(12L, perSlotRule(3_000L));

        settlement.settle(new SettlementCommand(
                JOB, USER, "partially_succeeded", 1, 2, List.of()));

        assertThat(settledCredits()).isEqualTo(12L);
    }

    @Test
    @DisplayName("★ 用量没带规则的基准维度 ⇒ 拒绝计价，不按 0 算成免费")
    void 缺基准维度_拒绝而不是免费() {
        hold(10L, perSecondRule(2_000L));

        SettlementCommand event = completed("succeeded", 5, 5);

        assertThatThrownBy(() -> settlement.settle(event))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("usage.seconds")
                .hasMessageContaining("usage.succeededSlots");
        verify(credits, never()).settle(anyLong(), anyLong());
    }


    @Test
    @DisplayName("★ 预留行有规则快照 ⇒ 按快照结算（快照是规则的唯一来源）")
    void 有快照_按快照结算() {
        hold(12L, perSlotRule(5_000L));

        settlement.settle(completed("succeeded", 2, 2));

        assertThat(settledCredits()).isEqualTo(10L);
    }

    @Test
    @DisplayName("★ 预留行没有快照 ⇒ 拒绝结算，不按 0、不按预扣额、也不回读目录")
    void 无快照_拒绝结算() {
        hold(12L, null);

        assertThatThrownBy(() -> settlement.settle(completed("succeeded", 2, 2)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("规则快照")
                .hasMessageContaining(String.valueOf(JOB));
        verify(credits, never()).settle(anyLong(), anyLong());
    }

    @Test
    @DisplayName("★ 快照编不过 ⇒ 抛出去让 MQ 重投，不静默按 0 结算")
    void 快照编不过_抛出去() {
        hold(12L, "{\"basePrice\":{\"kind\":\"const\",\"value\":5000}}");

        assertThatThrownBy(() -> settlement.settle(completed("succeeded", 2, 2)))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("baseUnit");
        verify(credits, never()).settle(anyLong(), anyLong());
    }


    private static String perSlotRule(long mc) {
        return """
                {"baseUnit":"usage.succeededSlots",
                 "basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":1}
                """.formatted(mc);
    }

    private static String perSecondRule(long mc) {
        return """
                {"baseUnit":"usage.seconds",
                 "basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":2}
                """.formatted(mc);
    }

    private static String perCallRule(long mc) {
        return """
                {"baseUnit":"constant:1",
                 "basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":1}
                """.formatted(mc);
    }

    private void hold(long reservedCredits, String ruleSnapshot) {
        when(reservations.findByJobId(JOB)).thenReturn(Optional.of(new Reservation(
                1L, JOB, USER, reservedCredits, null, 0L, Reservation.Status.HELD,
                List.of(), 1, 10_000, ruleSnapshot, "测试任务", null)));
    }

    private static SettlementCommand completed(String status, int succeededSlots,
                                               long reportedSlots) {
        return new SettlementCommand(JOB, USER, status, 1, succeededSlots,
                List.of(new SettlementUsageLine(MODEL, TASK,
                        Map.of("usage.succeededSlots", reportedSlots),
                        Map.of("size", "2k"))));
    }

    private long settledCredits() {
        ArgumentCaptor<Long> amount = ArgumentCaptor.forClass(Long.class);
        verify(credits).settle(eq(JOB), amount.capture());
        return amount.getValue();
    }
}
