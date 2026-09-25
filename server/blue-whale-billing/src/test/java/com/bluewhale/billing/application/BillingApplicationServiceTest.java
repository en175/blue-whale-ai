package com.bluewhale.billing.application;

import com.bluewhale.billing.catalog.CatalogHolder;
import com.bluewhale.billing.ledger.CreditLotRepository;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.HoldResult;
import com.bluewhale.billing.ledger.LedgerRepository;
import com.bluewhale.billing.ledger.TransactionRepository;
import com.bluewhale.billing.pricing.BasePriceResolver;
import com.bluewhale.billing.pricing.CompiledRule;
import com.bluewhale.billing.pricing.DiscountResolver;
import com.bluewhale.billing.pricing.PricingEngine;
import com.bluewhale.billing.pricing.RoundingPolicy;
import com.bluewhale.billing.pricing.Usage;
import com.bluewhale.billing.pricing.UsageDim;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 预扣的计价口径（纯单测，不起 Spring、不连 DB）。
 *
 * <h2>这一刀钉的是什么</h2>
 *
 * 预扣必须按**契约用量**冻钱。契约用量在提交时刻是已知的——它在 job 的规格快照里
 * （张数 {@code expected_output_count}、时长 {@code duration}），由
 * {@code specs} 送到 billing。
 *
 * <p>曾经 {@link BillingApplicationService#hold} 用 {@code Usage.empty()} 计价，
 * 于是「基准维度的数量」恒为 0：只有 {@code constant:1}（按次）的规则不受影响
 * （{@link UsageDim#quantityOf} 对它恒返回 1），而**按槽 / 按秒计价的规则会落到
 * {@code minCredits}**——预扣只冻了下限，结算侧又把消耗截到预扣额
 * （{@code CreditService#settle}），差额平台自己吃，且账面上没有任何异常。
 *
 * <p>所以下面第一条就是「按槽计价的规则，4 张要冻 4 张的钱，不是冻下限」。
 *
 * <p>用单测而不是真库集成测试：这条是**纯计价口径**，不该依赖 DB 环境变量才跑得起来
 * ——钱的口径必须每次提交都被验一遍（{@code BillingGrpcIntegrationTest} 考的是
 * gRPC 接线与账本落库那条链路，那是另一个考点）。
 */
class BillingApplicationServiceTest {

    private static final String MODEL = "seedream-4.0";
    private static final String TASK = "text2image";
    private static final long JOB = 8001L;
    private static final long USER = 43L;
    private static final String CMD = "cmd-8001";

    private final CreditService credits = mock(CreditService.class);
    private final CatalogHolder catalog = mock(CatalogHolder.class);

    /** 预扣的出口是 {@code credits.hold(...)}，金额是它的第 4 个参数。 */
    private long reservedCredits() {
        ArgumentCaptor<Long> amount = ArgumentCaptor.forClass(Long.class);
        verify(credits).hold(eq(USER), eq(CMD), eq(JOB), amount.capture(),
                anyInt(), anyInt(), anyString());
        return amount.getValue();
    }

    // ========== 按契约用量预扣 ==========

    @Test
    @DisplayName("★ 按槽计价的规则按契约张数预扣 —— 冻的不是下限")
    void 按槽计价_按契约张数预扣() {
        // 每成功一张 3 积分（3000 mc），下限 1 积分
        service(perSlotRule(3_000L, 1L));

        // 提交时契约就是 4 张（图多张），规格里带着尺寸档
        hold(Map.of("expected_output_count", "4", "size", "2k"));

        assertThat(reservedCredits()).isEqualTo(12L);
    }

    @Test
    @DisplayName("按秒计价的规则按契约时长预扣")
    void 按秒计价_按契约时长预扣() {
        // 每秒 2 积分（2000 mc），下限 2 积分
        service(perSecondRule(2_000L, 2L));

        hold(Map.of("duration", "5", "resolution", "1080p"));

        assertThat(reservedCredits()).isEqualTo(10L);
    }

    @Test
    @DisplayName("constant:1 按次计价的规则不受影响 —— 它本来就不依赖用量")
    void 按次计价_不受影响() {
        // 一次 100 积分
        service(perCallRule(100_000L));

        hold(Map.of("resolution", "1080p"));

        assertThat(reservedCredits()).isEqualTo(100L);
    }

    @Test
    @DisplayName("规格里的零头写法（5.0）也算得出契约时长")
    void 契约量的零头写法也算得出来() {
        service(perSecondRule(2_000L, 2L));

        // extractSpecs 把数字 String() 之后就是这条路径的输入；上游给小数写法时
        // 不能因为「解析不了」就把预扣降级成下限
        hold(Map.of("duration", "5.0"));

        assertThat(reservedCredits()).isEqualTo(10L);
    }

    // ========== 取不到契约量：拒绝，不冻下限 ==========

    @Test
    @DisplayName("★ 契约张数取不到 ⇒ 拒绝预扣，不按 0 落到下限")
    void 缺契约张数_拒绝而不是冻下限() {
        service(perSlotRule(3_000L, 1L));

        // 规格里没有 expected_output_count：算不出上限，冻 1 积分等于平台先亏 11
        Usage.ContractQuantityUnavailableException thrown = catchThrowableOfType(
                () -> hold(Map.of("size", "2k")), Usage.ContractQuantityUnavailableException.class);

        assertThat(thrown.baseUnit()).isEqualTo(UsageDim.SUCCEEDED_SLOTS);
        // 报出「该配哪个键」——这条异常是给运维看的补配置信号
        assertThat(thrown).hasMessageContaining("usage.succeededSlots")
                .hasMessageContaining("expected_output_count");

        // 一分钱都没冻、也没有预留
        verify(credits, never()).hold(anyLong(), anyString(), anyLong(), anyLong(),
                anyInt(), anyInt(), anyString());
    }

    @Test
    @DisplayName("自适应时长（duration=-1）取不到契约秒数 ⇒ 拒绝预扣")
    void 自适应时长_拒绝而不是冻下限() {
        service(perSecondRule(2_000L, 2L));

        // duration=-1 是 edit/prolong 的「自动时长」——真实时长提交时未知，
        // 按秒计价就无法定上限。宁可拒绝（配置能改），也不静默只冻下限。
        Usage.ContractQuantityUnavailableException thrown = catchThrowableOfType(
                () -> hold(Map.of("duration", "-1")), Usage.ContractQuantityUnavailableException.class);

        assertThat(thrown.baseUnit()).isEqualTo(UsageDim.SECONDS);
        assertThat(thrown).hasMessageContaining("usage.seconds");
    }

    // ========== 报价与预扣同源 ==========

    @Test
    @DisplayName("价格预览与预扣按同一份契约用量 —— 预览价 = 会冻的钱")
    void 报价与预扣同一份契约用量() {
        service(perSlotRule(3_000L, 1L));
        Map<String, String> specs = Map.of("expected_output_count", "4", "size", "2k");

        // 提交前预览：调用方报不出真实用量（proto 的 usage 留空）
        long preview = service.quote(new QuoteQuery(USER, MODEL, TASK, specs, "free",
                Usage.empty(), Instant.now())).credits();
        hold(specs);

        assertThat(preview).isEqualTo(reservedCredits());
    }

    // ========== 夹具 ==========

    /** 按成功槽计价：每槽 {@code mc} 微积分。 */
    private static CompiledRule perSlotRule(long mc, long minCredits) {
        return new CompiledRule(
                UsageDim.SUCCEEDED_SLOTS,
                new BasePriceResolver.Constant(mc),
                Map.of(), Map.of(), 1L, minCredits, null, new RoundingPolicy.HalfUp());
    }

    /** 按秒计价：每秒 {@code mc} 微积分。 */
    private static CompiledRule perSecondRule(long mc, long minCredits) {
        return new CompiledRule(
                UsageDim.SECONDS,
                new BasePriceResolver.Constant(mc),
                Map.of(), Map.of(), 1L, minCredits, null, new RoundingPolicy.HalfUp());
    }

    /** 按次计价：一次 {@code mc} 微积分，基准是 {@code constant:1}。 */
    private static CompiledRule perCallRule(long mc) {
        return CompiledRule.of(UsageDim.CONSTANT_ONE, new BasePriceResolver.Constant(mc), 1L);
    }

    private BillingApplicationService service;

    /** 装配：真引擎 + 只钉住这一条规则的目录；账本层是 mock（本类不考落库）。 */
    private BillingApplicationService service(CompiledRule rule) {
        when(catalog.lookup(MODEL, TASK)).thenReturn(rule);
        when(catalog.currentVersion()).thenReturn(1);
        when(credits.hold(anyLong(), anyString(), anyLong(), anyLong(), anyInt(), anyInt(), any()))
                .thenAnswer(invocation -> HoldResult.fresh(invocation.getArgument(3),
                        invocation.getArgument(4)));

        service = new BillingApplicationService(
                PricingEngine.forMedia(catalog, DiscountResolver.NONE),
                credits,
                mock(CreditLotRepository.class),
                mock(LedgerRepository.class),
                catalog,
                new GrantPolicy(),
                mock(TransactionRepository.class));
        return service;
    }

    private void hold(Map<String, String> specs) {
        service.hold(new HoldCommand(USER, CMD, JOB, MODEL, TASK, specs, "free",
                "生成任务", Instant.now()));
    }
}
