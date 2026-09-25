package com.bluewhale.billing.application;

import com.bluewhale.billing.catalog.CatalogHolder;
import com.bluewhale.billing.ledger.CreditLotRepository;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.HoldResult;
import com.bluewhale.billing.ledger.LedgerRepository;
import com.bluewhale.billing.ledger.ReservationRepository;
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

    @Test
    @DisplayName("★ 参考素材加价算进预扣 —— reference_count 也是契约量")
    void 参考素材加价算进预扣() {
        // 每槽 3 积分，参考素材每个 ×1.2（12000 万分比，见 AbstractPricingCalculator）
        service(perSlotRule(3_000L, 1L).withMultiplier(UsageDim.REFERENCE_COUNT, 12_000));

        // 2 张图 + 2 个参考素材：references 是数组，进不了 specs —— 它的**长度**由
        // billing-specs.ts 折算成 reference_count（Hold 与 Quote 共用那一份）
        hold(Map.of("expected_output_count", "2", "size", "2k", "reference_count", "2"));

        // 2 张 × 3 积分 = 6000 mc；参考 2 个 × 1.2 = 2.4 倍 → 14400 mc = 14.4 → 四舍五入 14
        assertThat(reservedCredits()).isEqualTo(14L);
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
    @DisplayName("★ 自适应时长（duration=-1）没配上限 ⇒ 仍拒绝预扣")
    void 自适应时长_没配上限_拒绝而不是冻下限() {
        service(perSecondRule(2_000L, 2L));

        // duration=-1 是 edit/prolong 的「自动时长」——真实时长提交时未知，
        // 按秒计价就无法定上限。规则又没配 maxCredits：没有上限可依，
        // 宁可拒绝（配置能改），也不静默只冻下限。
        Usage.ContractQuantityUnavailableException thrown = catchThrowableOfType(
                () -> hold(Map.of("duration", "-1")), Usage.ContractQuantityUnavailableException.class);

        assertThat(thrown.baseUnit()).isEqualTo(UsageDim.SECONDS);
        assertThat(thrown).hasMessageContaining("usage.seconds");
    }

    @Test
    @DisplayName("★ 契约张数缺失、规则配了上限 ⇒ 按上限冻结（与 duration=-1 同一判据）")
    void 契约张数缺失_配了上限_按上限冻结() {
        service(perSlotRule(3_000L, 1L).withMaxCredits(30L));

        // 判据是**这个维度登记了契约量来源**（expected_output_count），不是「键在不在」：
        // 缺键与 duration=-1 都是「这次的值取不到」。有上限兜底就不会把正常提交变成 400，
        // 没上限则照上面的用例那样拒绝
        hold(Map.of("size", "2k"));

        assertThat(reservedCredits()).isEqualTo(30L);
    }

    // ========== 契约量取不到、但规则配了上限：按上限冻结（不拒绝） ==========

    @Test
    @DisplayName("★ 自适应时长（duration=-1）配了上限 ⇒ 按上限冻结，不再拒绝提交")
    void 自适应时长_配了上限_按上限冻结() {
        // 每秒 2 积分、下限 2、上限 50：真实时长未知，按上限冻 50，
        // 结算按 worker 上报的实际秒数重算、多冻的退回 —— 「用上限冻结、按实际扣款」
        service(perSecondRule(2_000L, 2L).withMaxCredits(50L));

        hold(Map.of("duration", "-1", "resolution", "1080p"));

        assertThat(reservedCredits()).isEqualTo(50L);
    }

    @Test
    @DisplayName("★ 上限冻结与预览同价 —— 预览 50，实冻也是 50")
    void 上限冻结_报价与预扣同价() {
        service(perSecondRule(2_000L, 2L).withMaxCredits(50L));
        Map<String, String> specs = Map.of("duration", "-1", "resolution", "1080p");

        // 提交前预览：调用方报不出真实用量（proto 的 usage 留空）
        long preview = service.quote(new QuoteQuery(USER, MODEL, TASK, specs, "free",
                Usage.empty(), Instant.now())).credits();
        hold(specs);

        assertThat(preview).isEqualTo(50L).isEqualTo(reservedCredits());
    }

    @Test
    @DisplayName("没有契约量来源的维度不兜底 —— 配了上限也拒绝")
    void 没有契约量来源_不兜底() {
        // 基准维度是字符数（TTS）：提交时刻压根没有这个量的来源（见 UsageDim.CHARACTERS）。
        // 这是**结构性**的推不出，不是这次传参的问题 —— 冻上限只会把它掩盖掉
        service(new CompiledRule(UsageDim.CHARACTERS, new BasePriceResolver.Constant(2_000L),
                Map.of(), Map.of(), 1L, 2L, 50L, new RoundingPolicy.HalfUp()));

        Usage.ContractQuantityUnavailableException thrown = catchThrowableOfType(
                () -> hold(Map.of("voice", "female")), Usage.ContractQuantityUnavailableException.class);

        assertThat(thrown.baseUnit()).isEqualTo(UsageDim.CHARACTERS);
        verify(credits, never()).hold(anyLong(), anyString(), anyLong(), anyLong(),
                anyInt(), anyInt(), anyString());
    }

    @Test
    @DisplayName("规格组合查不到价 —— 有上限也不兜底，照原样拒绝")
    void 规格查不到价_不兜底() {
        // 价表只配了 1080p；上限 50 是配了的，所以这条路会走到兜底那一步
        service(new CompiledRule(UsageDim.SECONDS,
                new BasePriceResolver.Table(Map.of("resolution=1080p", 2_000L)),
                Map.of(), Map.of(), 1L, 2L, 50L, new RoundingPolicy.HalfUp()));

        // duration=-1 本会兜到上限，但这个规格组合查不到价：上限算得出来不代表结算算得出来，
        // 冻了钱也结不掉 —— 漏配必须当场暴露（与常规计价同一立场）
        BasePriceResolver.UnpriceableSpecException thrown = catchThrowableOfType(
                () -> hold(Map.of("duration", "-1", "resolution", "720p")),
                BasePriceResolver.UnpriceableSpecException.class);

        assertThat(thrown.normalizedKey()).isEqualTo("resolution=720p");
        verify(credits, never()).hold(anyLong(), anyString(), anyLong(), anyLong(),
                anyInt(), anyInt(), anyString());
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
                mock(TransactionRepository.class),
                mock(ReservationRepository.class));
        return service;
    }

    private void hold(Map<String, String> specs) {
        service.hold(new HoldCommand(USER, CMD, JOB, MODEL, TASK, specs, "free",
                "生成任务", Instant.now()));
    }
}
