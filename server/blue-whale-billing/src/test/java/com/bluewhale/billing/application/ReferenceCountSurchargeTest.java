package com.bluewhale.billing.application;

import com.bluewhale.billing.infrastructure.mq.JobEventPayload;
import com.bluewhale.billing.ledger.CreditLotRepository;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.HoldResult;
import com.bluewhale.billing.ledger.LedgerRepository;
import com.bluewhale.billing.ledger.Reservation;
import com.bluewhale.billing.ledger.ReservationRepository;
import com.bluewhale.billing.ledger.TransactionRepository;
import com.bluewhale.billing.pricing.ContractSource;
import com.bluewhale.billing.pricing.DiscountResolver;
import com.bluewhale.billing.pricing.MediaPricingCalculator;
import com.bluewhale.billing.pricing.UsageDim;
import org.junit.jupiter.api.DisplayName;
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
 * 参考素材加价：**预扣冻的那个价 == 结算收的那个价**（同一个参考数）。
 *
 * <h2>为什么这一刀必须存在</h2>
 *
 * 规则可以把参考素材配成整单倍率（{@code multipliers} 里的 {@code usage.referenceCount}），
 * 而倍率按**数量**取值（{@code AbstractPricingCalculator#multiplierPermille}：
 * 数量 ≤ 0 恒返回 10000 = ×1.0）。这个数量两侧各有来源，且来源**完全不同**：
 *
 * <ul>
 *   <li><b>预扣</b>（{@link BillingApplicationService#hold}）的数量来自规格快照的标量键
 *       {@code reference_count} —— 建任务侧 {@code billing-specs.ts} 把 {@code input.references}
 *       数组的**长度**折成一个标量（Hold 与 Quote 共用那一份归一）；</li>
 *   <li><b>结算</b>（{@link SettlementService#settle}）的数量来自 worker 上报的用量维度，
 *       wire 键就是 {@link UsageDim#REFERENCE_COUNT} 的 {@code key()}
 *       —— 发布方是 worker 的 {@code SettlementUsageLines}。</li>
 * </ul>
 *
 * 任何一条断了，结算都会把预扣加的那笔钱**全额退回去**（缺维度 ⇒ 数量 0 ⇒ 倍率 ×1.0），
 * 用户实际没被多收，而账面上没有任何一处能解释这个差。所以下面第一条钉的就是
 * 「同一个参考数，两边同一个价」。
 *
 * <h2>对侧各钉各的，本类钉中间的接头</h2>
 *
 * {@code billing-specs.test.ts} 钉 {@code references} → {@code reference_count} 的折算；
 * worker 的 {@code JobSettlementPublisherTest} 钉上报的**值**与**键名**（它拿不到本模块的
 * 枚举，只能写字面量）。本类钉的是两处字面量必须落在同一个枚举上——{@link UsageDim}
 * 的 {@code key()} 与 {@code contractSpecKey()} 各自等于那两个串。
 *
 * <p>纯单测：不起 Spring、不连 DB（与 {@code BillingApplicationServiceTest} /
 * {@code SettlementServiceTest} 同一立场——钱的口径必须每次提交都被验一遍）。
 */
class ReferenceCountSurchargeTest {

    private static final String MODEL = "seedream-4.0";
    private static final String TASK = "text2image";
    private static final long JOB = 9001L;
    private static final long USER = 44L;
    private static final String CMD = "cmd-9001";

    /**
     * 规则快照：每槽 3 积分、下限 1 积分、参考素材每个 ×1.2（12000 万分比）。
     *
     * <p>手写字面量（形态 = 能力行的 {@code pricing} 列）。
     */
    private static final String RULE = """
            {"baseUnit":"usage.succeededSlots",
             "basePrice":{"kind":"const","value":3000},
             "multipliers":{"usage.referenceCount":12000},
             "unitDenominator":1,"minCredits":1}
            """;

    /**
     * 建任务侧 {@code extractSpecs} 会送来的规格：2 张图 + **2 个参考素材**。
     *
     * <p>{@code reference_count} 就是 {@code input.references.length} 折算出来的标量，
     * 不是手写的业务常量——这里照着 {@code billing-specs.ts} 的输出形态写。
     */
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

        // 与生产同一份装配（PricingConfig）：算法实例只有一个，规则来源在调用点拼
        billing = new BillingApplicationService(
                new MediaPricingCalculator(DiscountResolver.NONE),
                credits,
                mock(CreditLotRepository.class),
                mock(LedgerRepository.class),
                mock(com.bluewhale.billing.catalog.CatalogHolder.class),
                new GrantPolicy(),
                mock(TransactionRepository.class),
                mock(ReservationRepository.class));

        settlement = new SettlementService(reservations, credits);
    }

    // ========== 本单存在的全部理由 ==========

    @Test
    @DisplayName("★ 参考素材加价：预扣冻的价 == 结算收的价（同一个参考数）")
    void 参考素材加价_预扣与结算同一个数() {
        long frozen = frozenCredits();

        // 预扣：2 张 × 3 积分 = 6000 mc；参考 2 个 × 1.2 = 2.4 倍 → 14400 mc = 14.4 → 14
        assertThat(frozen).isEqualTo(14L);

        // 预留行里冻着的就是上面那个数——结算只能按它比，不能另取一个
        reservation(frozen);
        settle("succeeded", Map.of("usage.succeededSlots", 2L, "usage.referenceCount", 2L));

        // 结算按 worker 上报的同一个参考数复现同一个价：**加价收回来了，没有被退回**
        assertThat(settledCredits()).isEqualTo(frozen);
    }

    @Test
    @DisplayName("★ 结算漏报参考素材数时加价被退回 —— 本单修的就是这条")
    void 漏报参考素材数_加价被退回() {
        long frozen = frozenCredits();
        reservation(frozen);

        // 修复前 worker 只报 succeededSlots：referenceCount 缺维度 ⇒ 数量 0 ⇒ 倍率 ×1.0，
        // 加价那 8 个积分被静默退回（14 冻、6 收），账面上看不出任何异常。
        // 留这条测试是为了让「漏报的代价」一直可见，而不是被当成正常。
        settle("succeeded", Map.of("usage.succeededSlots", 2L));

        assertThat(settledCredits()).isEqualTo(6L).isLessThan(frozen);
    }

    // ========== 中间接头：两处字面量落在同一个枚举上 ==========

    @Test
    @DisplayName("★ wire 键与规格键的名字 —— worker 与 billing 不能各写一套")
    void 键名两个都不能漂() {
        // 结算侧：worker 的 SettlementUsageLines.REFERENCE_COUNT 写的就是这个字面量
        // （camelCase，与 usage.succeededSlots 同一套写法）。写错一个字母，
        // Usage.ofKeys 会以 UnknownUsageDimException **拒绝计价**——整单结算不出去
        assertThat(UsageDim.REFERENCE_COUNT.key()).isEqualTo("usage.referenceCount");
        // 预扣侧：billing-specs.ts 折算出的 specs 键名（Hold / Quote 共用那一份归一）
        assertThat(UsageDim.REFERENCE_COUNT.contractSource())
                .isEqualTo(new ContractSource.SpecKey("reference_count"));
    }

    // ========== 夹具 ==========

    /** 走**真的**提交路径预扣一次，取回实际冻住的积分（不是手写的期望值）。 */
    private long frozenCredits() {
        billing.hold(new HoldCommand(USER, CMD, JOB, MODEL, TASK, SPECS, "free",
                "生成任务", Instant.now(), RULE));

        ArgumentCaptor<Long> amount = ArgumentCaptor.forClass(Long.class);
        verify(credits).hold(eq(USER), eq(CMD), eq(JOB), amount.capture(),
                anyInt(), anyInt(), anyString(), anyString());
        return amount.getValue();
    }

    /**
     * 一笔未决预留：冻结 {@code reservedCredits}，折扣 10000（原价）。
     *
     * <p>带着上面那条规则快照 —— 结算复现定价**只有**这一个来源。
     */
    private void reservation(long reservedCredits) {
        when(reservations.findByJobId(JOB)).thenReturn(Optional.of(new Reservation(
                1L, JOB, USER, reservedCredits, null, Reservation.Status.HELD,
                List.of(), 1, 10_000, RULE, "测试任务", null)));
    }

    /** 完成事件：用量行报的是 worker 真的会上报的那几个维度。 */
    private void settle(String status, Map<String, Long> quantities) {
        settlement.settle(new JobEventPayload.JobCompleted(JOB, USER, status, 1,
                quantities.getOrDefault("usage.succeededSlots", 0L).intValue(),
                List.of(new JobEventPayload.UsageLine(MODEL, TASK, quantities,
                        Map.of("size", "2k")))));
    }

    /** 实际结算额 —— 结算的唯一出口是 {@code credits.settle(jobId, actualCredits)}。 */
    private long settledCredits() {
        ArgumentCaptor<Long> amount = ArgumentCaptor.forClass(Long.class);
        verify(credits).settle(eq(JOB), amount.capture());
        return amount.getValue();
    }
}
