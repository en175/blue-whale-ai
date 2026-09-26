package com.bluewhale.billing.application;

import com.bluewhale.billing.catalog.CatalogCompiler;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.Reservation;
import com.bluewhale.billing.ledger.ReservationRepository;
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

/**
 * 结算的计价口径（纯单测，不起 Spring、不连 DB）。
 *
 * <h2>这一刀钉的是什么</h2>
 *
 * {@code events.proto} 写着「{@code succeeded_slots} 决定 actualCredits
 * （**按成功的 slot 计费**，不是按 job）」，而 worker 曾经恒发 {@code usage: []}，
 * 于是 {@code SettlementService} 永远走「按预扣额结算」那条兜底——
 * {@code partially_succeeded}（4 张里成了 2 张）被按**全额**收，偏平台。
 *
 * <p>修法是把分工摆回 {@code usage.proto} 定的位置：worker 报原始量
 * （{@code usage.succeededSlots}），billing 拿**预留行冻的规则快照**算价。
 * 所以下面第一条就是「4 张里成 2 张 ⇒ 只收 2 张的钱」。
 *
 * <p>用单测而不是真库集成测试，是因为这条是**纯计价口径**：
 * 它不该依赖 DB 环境变量才跑得起来——钱的口径必须每次提交都被验一遍
 * （{@code SettlementIntegrationTest} 考的是真库上的冻结快照链路，那是另一个考点）。
 *
 * <p>⚠️ 夹具里的预扣额是**上限**（4 张就冻 4 张的钱），因为本类只考结算口径。
 * 见 {@link #部分成功_按成功槽结算} 的断言：它只钉「实际额算对了没有」，
 * 不钉「预扣冻够了没有」——后者归 {@code BillingApplicationServiceTest}。
 */
class SettlementServiceTest {

    private static final String MODEL = "seedream-4.0";
    private static final String TASK = "text2image";
    private static final long JOB = 7001L;
    private static final long USER = 42L;

    private final ReservationRepository reservations = mock(ReservationRepository.class);
    private final CreditService credits = mock(CreditService.class);

    /**
     * ⚠️ 依赖里**没有**目录仓储：规则只有「预留行上的快照」一个来源。
     * 曾经的「没有快照就按 {@code catalog_version} 读目录」那条回落已被删除——
     * 规则住在模型能力行，billing 读不到那个库，目录里压根没有它。
     */
    private final SettlementService settlement = new SettlementService(reservations, credits);

    // ========== 按成功槽计费 ==========

    @Test
    @DisplayName("★ 部分成功按成功槽结算，不是按整单 —— 本单存在的理由")
    void 部分成功_按成功槽结算() {
        // 规则：每成功一张 3 积分（3000 mc），下限 1 积分
        // 预扣按 4 张冻的 12 积分（Hold 侧按契约用量冻上限）
        hold(12L, perSlotRule(3_000L));

        settlement.settle(completed("partially_succeeded", 2, /* 实际成功 2 张 */ 2));

        // 4 张里成 2 张 ⇒ 收 2 张的钱，不是 12
        assertThat(settledCredits()).isEqualTo(6L);
    }

    @Test
    @DisplayName("全成功且规则按次计价时，结算额与预扣额一致")
    void 全成功_按次计价_与预扣一致() {
        // 规则：一次 100 积分（const，基准是 constant:1）
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

    // ========== 兜底与守卫 ==========

    @Test
    @DisplayName("用量为空按预扣额结算 —— worker 报不出用量时的降级路径")
    void 用量为空_按预扣额结算() {
        hold(12L, perSlotRule(3_000L));

        settlement.settle(new SettlementCommand(
                JOB, USER, "succeeded", 1, 4, List.of()));

        // 报不出用量时唯一一个「不比契约多收、也不比契约少收」的取值
        assertThat(settledCredits()).isEqualTo(12L);
    }

    @Test
    @DisplayName("部分成功但用量为空时仍按全额（残留缺口，worker 侧有 WARN）")
    void 部分成功_用量为空_仍按全额() {
        hold(12L, perSlotRule(3_000L));

        settlement.settle(new SettlementCommand(
                JOB, USER, "partially_succeeded", 1, 2, List.of()));

        // 这是**取不到用量时的保守取值**，不是正确值：worker 报不出 model_id 时才会走到，
        // 它在自己那边打 WARN。留这条测试是为了让这个缺口一直可见，而不是被当成正常。
        assertThat(settledCredits()).isEqualTo(12L);
    }

    @Test
    @DisplayName("★ 用量没带规则的基准维度 ⇒ 拒绝计价，不按 0 算成免费")
    void 缺基准维度_拒绝而不是免费() {
        // 规则按秒计价，而 worker 只报了槽数（比如将来漏报时长的那条路径）
        hold(10L, perSecondRule(2_000L));

        SettlementCommand event = completed("succeeded", 5, 5);

        // 取不到 → 0 → 落到 minCredits：用户白用一次，账面上却没有任何异常。
        // 所以宁可重投进死信（红灯有人看得见），也不要静默少收。
        assertThatThrownBy(() -> settlement.settle(event))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("usage.seconds")
                .hasMessageContaining("usage.succeededSlots");
        verify(credits, never()).settle(anyLong(), anyLong());
    }

    // ========== 规则从哪来：只有预留行上的快照 ==========

    @Test
    @DisplayName("★ 预留行有规则快照 ⇒ 按快照结算（快照是规则的唯一来源）")
    void 有快照_按快照结算() {
        // 预留行冻的快照写的是每槽 5 积分。规则搬进能力行之后，这正是唯一正确的来源：
        // 能力行里那条规则现在改成什么价，都不该改写这次已经成交的价。
        hold(12L, perSlotRule(5_000L));

        settlement.settle(completed("succeeded", 2, 2));

        // 2 槽 × 5 积分 = 10
        assertThat(settledCredits()).isEqualTo(10L);
    }

    @Test
    @DisplayName("★ 预留行没有快照 ⇒ 拒绝结算，不按 0、不按预扣额、也不回读目录")
    void 无快照_拒绝结算() {
        // 本次预扣没带快照的预留就是这副样子（历史上是别的东西写的行，或调用方漏带）。
        // 规则住在模型能力行、只在预扣那一次随请求冻下来——没有第二条来源可回落，
        // 所以这里**必须抛**：让 MQ 重投 → 死信 → 有人看得见，而不是静默按一个数成交。
        hold(12L, null);

        assertThatThrownBy(() -> settlement.settle(completed("succeeded", 2, 2)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("规则快照")
                .hasMessageContaining(String.valueOf(JOB));
        // 一分钱都没结算
        verify(credits, never()).settle(anyLong(), anyLong());
    }

    @Test
    @DisplayName("★ 快照编不过 ⇒ 抛出去让 MQ 重投，不静默按 0 结算")
    void 快照编不过_抛出去() {
        // 缺 baseUnit —— 若这里静默放过，这次结算会按别的价静默成交
        hold(12L, "{\"basePrice\":{\"kind\":\"const\",\"value\":5000}}");

        assertThatThrownBy(() -> settlement.settle(completed("succeeded", 2, 2)))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("baseUnit");
        verify(credits, never()).settle(anyLong(), anyLong());
    }

    // ========== 夹具 ==========

    /**
     * 规则快照的 JSON 文本 —— **手写字面量**，不用对象序列化。
     *
     * <p>刻意的：快照是跨进程的线格式（后端的能力行把它原样送来），它的形态本身就是被测对象。
     * 用序列化生成会与「后端到底送了什么形状」脱钩，这条测试就只剩下自证。
     */
    private static String perSlotRule(long mc) {
        return """
                {"baseUnit":"usage.succeededSlots",
                 "basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":1}
                """.formatted(mc);
    }

    /** 按秒计价的规则快照（下限 2 积分）。 */
    private static String perSecondRule(long mc) {
        return """
                {"baseUnit":"usage.seconds",
                 "basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":2}
                """.formatted(mc);
    }

    /** 按次计价的规则快照：基准 {@code constant:1}，一次 {@code mc} 微积分。 */
    private static String perCallRule(long mc) {
        return """
                {"baseUnit":"constant:1",
                 "basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":1}
                """.formatted(mc);
    }

    /**
     * 一笔未决预留，带上（或不带）规则快照。
     *
     * @param ruleSnapshot 预留行上冻的规则快照；{@code null} = 没冻（老预留）——
     *                     结算会因此算不出价并抛出去
     */
    private void hold(long reservedCredits, String ruleSnapshot) {
        when(reservations.findByJobId(JOB)).thenReturn(Optional.of(new Reservation(
                1L, JOB, USER, reservedCredits, null, 0L, Reservation.Status.HELD,
                List.of(), 1, 10_000, ruleSnapshot, "测试任务", null)));
    }

    /** 完成事件：{@code succeededSlots} 是事件里的标量，用量行报的是实际量。 */
    private static SettlementCommand completed(String status, int succeededSlots,
                                               long reportedSlots) {
        return new SettlementCommand(JOB, USER, status, 1, succeededSlots,
                List.of(new SettlementUsageLine(MODEL, TASK,
                        Map.of("usage.succeededSlots", reportedSlots),
                        Map.of("size", "2k"))));
    }

    /** 实际结算额 —— 结算的唯一出口是 {@code credits.settle(jobId, actualCredits)}。 */
    private long settledCredits() {
        ArgumentCaptor<Long> amount = ArgumentCaptor.forClass(Long.class);
        verify(credits).settle(eq(JOB), amount.capture());
        return amount.getValue();
    }
}
