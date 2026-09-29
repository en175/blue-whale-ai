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

/**
 * 预扣与结算**两条真实装配路线**的等价性：同一笔钱，两边必须算出同一个数。
 *
 * <h2>这一刀钉的是什么</h2>
 *
 * 两条路的装配形状不同：
 *
 * <ul>
 *   <li>预扣：规则来源是随请求带来的快照，算法是**注入的那个实例**
 *       （{@code BillingApplicationService#engineFor}）</li>
 *   <li>结算：规则来源是预留行上的快照，算法**现场另造**一个实例 —— 因为它必须用
 *       **冻结折扣**（{@code SettlementService#engineAtHoldTime}）</li>
 * </ul>
 *
 * <p>形状不同**不等于算法不同**：共享的是同一份算法代码。这条测试**走生产的两个入口**
 * （{@code BillingApplicationService#hold} 与 {@code SettlementService#settle}）——
 * 同一份规则、同一个折扣、同一份用量，断言两边交给账本层的金额**相同**。
 *
 * <p>⚠️ 关键在「走生产入口」四个字。若这条测试自己在测试里把两边的装配各抄一遍，
 * 它证明的只是「同一个引擎算两次得到同一个数」——把生产的结算折扣整个换成不打折，
 * 它照样会绿。那种测试比没有更贵：一个绿灯会被读成「这条路径已覆盖」。
 *
 * <p>⚠️ 它**钉不住**「本仓只有一份算法实现」——那是结构事实（`AbstractPricingCalculator`
 * 当前只有一个子类），也写在 `PricingConfig` 的 bean 注释里。这里钉的是：
 * 走两条真实装配，同一笔钱算出来是同一个数。
 */
class HoldSettlePricingEquivalenceTest {

    private static final String MODEL = "seedream-4.0";
    private static final String TASK = "text2image";
    private static final long JOB = 9001L;
    private static final long USER = 42L;
    private static final long SLOTS = 2L;

    /**
     * 7 折。**刻意不是 100%**：折扣要是根本没被任一侧用上，两边会「一致」地给出原价，
     * 等价性那条就白写了 —— 所以下面把「两侧确实打了折」也单独钉一条。
     */
    private static final int DISCOUNT_BP = 7_000;

    /** 不打折。用来对照「折扣确实被用上了」。 */
    private static final int NO_DISCOUNT_BP = 10_000;

    /**
     * 规则：每成功一槽 3 积分（3000 mc），下限 1 积分。
     *
     * <p>**手写字面量**，不用对象序列化：快照是跨进程的线格式（后端的能力行把它原样送来），
     * 它的形态本身就是被测对象 —— 序列化生成会与「后端到底送了什么形状」脱钩。
     */
    private static final String RULE_SNAPSHOT = """
            {"baseUnit":"usage.succeededSlots",
             "basePrice":{"kind":"const","value":3000},
             "unitDenominator":1,"minCredits":1}
            """;

    /**
     * 契约用量 = 实际用量（都是 2 槽）。
     *
     * <p>`usage.succeededSlots` 的契约量来自请求里的 {@code expected_output_count}
     * （见 {@code UsageDim.SUCCEEDED_SLOTS} 的契约量来源登记），两处都写 2 ——
     * 于是「预扣按 2 槽冻、结算按 2 槽收」说的是同一件事，两次结果才可比。
     */
    private static final Map<String, String> SPECS =
            Map.of("size", "2k", "expected_output_count", "2");

    // ========== 两条生产路的接线 ==========

    /**
     * 走**生产**的预扣入口，取出它交给账本层的额度。
     *
     * <p>装配与 {@code PricingConfig} 同形：算法实例由「容器」注入（这里直接 new 一个），
     * 规则来源在调用点拼。折扣从参数给 —— 生产里它就是被注入的那个 live resolver 解析出的值。
     */
    private static long reservedCredits(int discountBp) {
        CreditService credits = mock(CreditService.class);
        CatalogHolder catalog = mock(CatalogHolder.class);
        when(catalog.currentVersion()).thenReturn(1);
        // 账本层回显它收到的金额（本类不考落库），下面用 captor 取出来
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

        // ⚠️ 预扣必须把**当时那条规则的折扣**冻进预留行 —— 结算侧读的就是它。
        //    少了这条断言，`settledCredits` 里那个手写的 discountBp 就是无源之水：
        //    把生产侧「冻结当时的折扣」改成写一个常量，下面那条等价性照样会绿。
        assertThat(frozenBp.getValue()).isEqualTo(discountBp);

        return reserved.getValue();
    }

    /**
     * 走**生产**的结算入口，取出它交给账本层的金额。
     *
     * <p>扣动结算的预留行上写的是 {@code discountBp} —— 那就是预扣时冻下来的值。
     * 结算侧读它、不重新解析（见 {@code SettlementService} 的类注释）。
     */
    private static long settledCredits(int discountBp) {
        ReservationRepository reservations = mock(ReservationRepository.class);
        CreditService credits = mock(CreditService.class);
        when(reservations.findByJobId(JOB)).thenReturn(Optional.of(new Reservation(
                1L, JOB, USER, /* 预扣冻的额度：本类只考单价，用不用到它取决于用量是否为空 */ 0L,
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

    // ========== 断言 ==========

    @Test
    void 同一份规则与同一个折扣下_结算复现预扣价() {
        assertThat(settledCredits(DISCOUNT_BP)).isEqualTo(reservedCredits(DISCOUNT_BP));
    }

    @Test
    void 两侧都真的用上了折扣() {
        // 上一条只证明「两边一致」。若**两侧**都漏了折扣，它照样绿 ——
        // 所以这条把折扣的存在也钉住：打了折的价必须低于不打折的价。
        assertThat(reservedCredits(DISCOUNT_BP)).isLessThan(reservedCredits(NO_DISCOUNT_BP));
        assertThat(settledCredits(DISCOUNT_BP)).isLessThan(settledCredits(NO_DISCOUNT_BP));
    }
}
