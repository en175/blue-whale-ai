package com.bluewhale.billing.application;

import com.bluewhale.billing.catalog.CatalogCompiler;
import com.bluewhale.billing.catalog.CatalogDocument;
import com.bluewhale.billing.catalog.CatalogRepository;
import com.bluewhale.billing.infrastructure.mq.JobEventPayload;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.Reservation;
import com.bluewhale.billing.ledger.ReservationRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
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
 * （{@code usage.succeededSlots}），billing 拿**冻结的目录**算价。
 * 所以下面第一条就是「4 张里成 2 张 ⇒ 只收 2 张的钱」。
 *
 * <p>用单测而不是真库集成测试，是因为这条是**纯计价口径**：
 * 它不该依赖 DB 环境变量才跑得起来——钱的口径必须每次提交都被验一遍
 * （{@code SettlementIntegrationTest} 考的是冻结版本 / 冻结折扣那条链路，那是另一个考点）。
 *
 * <p>⚠️ 夹具里的预扣额是**上限**（4 张就冻 4 张的钱），因为本类只考结算口径。
 * （曾经这里还写着「真实链路里 {@code hold} 用的是 {@code Usage.empty()}，
 * 按槽计价的规则只会冻到 {@code minCredits}」——那是**预扣侧**的缺口，已由
 * {@code BillingApplicationService#priceAtSubmit} 按**契约用量**计价修掉，
 * 该缺口不复存在，本段随之改写。）见 {@link #部分成功_按成功槽结算} 的断言：
 * 它只钉「实际额算对了没有」，不钉「预扣冻够了没有」——后者归 {@code BillingApplicationServiceTest}。
 */
class SettlementServiceTest {

    private static final String MODEL = "seedream-4.0";
    private static final String TASK = "text2image";
    private static final long JOB = 7001L;
    private static final long USER = 42L;

    private final CatalogRepository catalogs = mock(CatalogRepository.class);
    private final ReservationRepository reservations = mock(ReservationRepository.class);
    private final CreditService credits = mock(CreditService.class);

    private final SettlementService settlement =
            new SettlementService(catalogs, reservations, credits);

    // ========== 按成功槽计费 ==========

    @Test
    @DisplayName("★ 部分成功按成功槽结算，不是按整单 —— 本单存在的理由")
    void 部分成功_按成功槽结算() {
        // 规则：每成功一张 3 积分（3000 mc），下限 1 积分
        useCatalog(perSlotRule(3_000L, 1L));
        // 预扣按 4 张冻的 12 积分（Hold 侧按契约用量冻上限）
        hold(12L);

        settlement.settle(completed("partially_succeeded", 2, /* 实际成功 2 张 */ 2));

        // 4 张里成 2 张 ⇒ 收 2 张的钱，不是 12
        assertThat(settledCredits()).isEqualTo(6L);
    }

    @Test
    @DisplayName("全成功且目录按次计价时，结算额与预扣额一致")
    void 全成功_按次计价_与预扣一致() {
        // 规则：一次 100 积分（const，基准是 constant:1 —— 生产目录现在的形态）
        useCatalog(perCallRule(100_000L));
        hold(100L);

        settlement.settle(completed("succeeded", 3, 3));

        assertThat(settledCredits()).isEqualTo(100L);
    }

    @Test
    @DisplayName("多张全成功按槽累加 —— 按槽计价的目录里 4 张就是 4 张的钱")
    void 全成功_按槽计价_槽数相乘() {
        useCatalog(perSlotRule(3_000L, 1L));
        hold(12L);

        settlement.settle(completed("succeeded", 4, 4));

        assertThat(settledCredits()).isEqualTo(12L);
    }

    // ========== 兜底与守卫 ==========

    @Test
    @DisplayName("用量为空按预扣额结算 —— worker 报不出用量时的降级路径")
    void 用量为空_按预扣额结算() {
        useCatalog(perSlotRule(3_000L, 1L));
        hold(12L);

        settlement.settle(new JobEventPayload.JobCompleted(
                JOB, USER, "succeeded", 1, 4, List.of()));

        // 报不出用量时唯一一个「不比契约多收、也不比契约少收」的取值
        assertThat(settledCredits()).isEqualTo(12L);
    }

    @Test
    @DisplayName("部分成功但用量为空时仍按全额（残留缺口，worker 侧有 WARN）")
    void 部分成功_用量为空_仍按全额() {
        useCatalog(perSlotRule(3_000L, 1L));
        hold(12L);

        settlement.settle(new JobEventPayload.JobCompleted(
                JOB, USER, "partially_succeeded", 1, 2, List.of()));

        // 这是**取不到用量时的保守取值**，不是正确值：worker 报不出 model_id 时才会走到，
        // 它在自己那边打 WARN。留这条测试是为了让这个缺口一直可见，而不是被当成正常。
        assertThat(settledCredits()).isEqualTo(12L);
    }

    @Test
    @DisplayName("★ 用量没带规则的基准维度 ⇒ 拒绝计价，不按 0 算成免费")
    void 缺基准维度_拒绝而不是免费() {
        // 规则按秒计价，而 worker 只报了槽数（比如将来漏报时长的那条路径）
        useCatalog(new CatalogDocument.TaskRule(
                null, "usage.seconds", new CatalogDocument.BasePrice("const", 2_000L, null, null),
                null, null, 1L, 2L, null, null));
        hold(10L);

        JobEventPayload.JobCompleted event = completed("succeeded", 5, 5);

        // 取不到 → 0 → 落到 minCredits：用户白用一次，账面上却没有任何异常。
        // 所以宁可重投进死信（红灯有人看得见），也不要静默少收。
        assertThatThrownBy(() -> settlement.settle(event))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("usage.seconds")
                .hasMessageContaining("usage.succeededSlots");
        verify(credits, never()).settle(anyLong(), anyLong());
    }

    @Test
    @DisplayName("目录版本读不回来时炸掉 —— 不按 0 结算")
    void 目录版本缺失_抛出去重投() {
        when(catalogs.loadVersion(1)).thenReturn(null);
        hold(12L);

        assertThatThrownBy(() -> settlement.settle(completed("succeeded", 4, 4)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("目录版本已不存在");
    }

    // ========== 夹具 ==========

    /** 按成功槽计价：每槽 {@code mc} 微积分。 */
    private static CatalogDocument.TaskRule perSlotRule(long mc, long minCredits) {
        return new CatalogDocument.TaskRule(
                null, "usage.succeededSlots",
                new CatalogDocument.BasePrice("const", mc, null, null),
                null, null, 1L, minCredits, null, null);
    }

    /** 按次计价：一次 {@code mc} 微积分，基准是 {@code constant:1}。 */
    private static CatalogDocument.TaskRule perCallRule(long mc) {
        return new CatalogDocument.TaskRule(
                null, "constant:1",
                new CatalogDocument.BasePrice("const", mc, null, null),
                null, null, 1L, 1L, null, null);
    }

    private void useCatalog(CatalogDocument.TaskRule rule) {
        CatalogDocument document = new CatalogDocument(
                1, "CNY", 15,
                Map.of(MODEL, Map.of(TASK, rule)),
                null);
        // 第三个参数是落库原文：只有管理端读它（读回来改一改再发布），本用例不碰，占位即可
        when(catalogs.loadVersion(1)).thenReturn(new CatalogRepository.LoadedCatalog(
                1, "hash", "{}", document, CatalogCompiler.compile(document), Instant.now()));
    }

    /** 一笔未决预留：冻结 {@code reservedCredits}，折扣 10000（原价）。 */
    private void hold(long reservedCredits) {
        when(reservations.findByJobId(JOB)).thenReturn(Optional.of(new Reservation(
                1L, JOB, USER, reservedCredits, null, Reservation.Status.HELD,
                List.of(), 1, 10_000, "测试任务", null)));
    }

    /** 完成事件：{@code succeededSlots} 是事件里的标量，用量行报的是实际量。 */
    private static JobEventPayload.JobCompleted completed(String status, int succeededSlots,
                                                         long reportedSlots) {
        return new JobEventPayload.JobCompleted(JOB, USER, status, 1, succeededSlots,
                List.of(new JobEventPayload.UsageLine(MODEL, TASK,
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
