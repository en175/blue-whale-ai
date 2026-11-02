package com.bluewhale.billing.application;

import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.application.command.ChargeCommand;
import com.bluewhale.billing.application.command.QuoteQuery;
import com.bluewhale.billing.domain.ledger.ChargeResult;
import com.bluewhale.billing.infrastructure.persistence.repository.ReservationRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.TransactionRepository;
import com.bluewhale.billing.domain.pricing.AbstractPricingCalculator;
import com.bluewhale.billing.domain.pricing.BasePriceResolver;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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



























class BillingApplicationServiceTest {

    private static final String MODEL = "seedream-4.0";
    private static final String TASK = "text2image";
    private static final long JOB = 8001L;
    private static final long USER = 43L;
    private static final String CMD = "cmd-8001";

    private final CreditService credits = mock(CreditService.class);
    private final CatalogHolder catalog = mock(CatalogHolder.class);


    private long chargedCredits() {
        ArgumentCaptor<Long> amount = ArgumentCaptor.forClass(Long.class);
        verify(credits).charge(eq(USER), eq(CMD), eq(JOB), amount.capture(),
                anyInt(), anyInt(), anyString(), anyString());
        return amount.getValue();
    }



    @Test
    @DisplayName("★ 按槽计价的规则按契约张数扣款 —— 扣的不是下限")
    void 按槽计价_按契约张数扣款() {

        service();


        charge(Map.of("expected_output_count", "4", "size", "2k"), perSlotRule(3_000L, 1L));

        assertThat(chargedCredits()).isEqualTo(12L);
    }

    @Test
    @DisplayName("按秒计价的规则按契约时长扣款")
    void 按秒计价_按契约时长扣款() {

        service();

        charge(Map.of("duration", "5", "resolution", "1080p"), perSecondRule(2_000L, 2L));

        assertThat(chargedCredits()).isEqualTo(10L);
    }

    @Test
    @DisplayName("constant:1 按次计价的规则不受影响 —— 它本来就不依赖用量")
    void 按次计价_不受影响() {
        service();

        charge(Map.of("resolution", "1080p"), perCallRule(100_000L));

        assertThat(chargedCredits()).isEqualTo(100L);
    }

    @Test
    @DisplayName("规格里的零头写法（5.0）也算得出契约时长")
    void 契约量的零头写法也算得出来() {
        service();



        charge(Map.of("duration", "5.0"), perSecondRule(2_000L, 2L));

        assertThat(chargedCredits()).isEqualTo(10L);
    }

    @Test
    @DisplayName("★ 契约张数取不到 ⇒ 拒绝扣款，不按 0 落到下限")
    void 缺契约张数_拒绝而不是扣下限() {
        service();


        Usage.ContractQuantityUnavailableException thrown = catchThrowableOfType(
                () -> charge(Map.of("size", "2k"), perSlotRule(3_000L, 1L)),
                Usage.ContractQuantityUnavailableException.class);

        assertThat(thrown.baseUnit()).isEqualTo(UsageDim.SUCCEEDED_SLOTS);

        assertThat(thrown).hasMessageContaining("usage.succeededSlots")
                .hasMessageContaining("expected_output_count");


        verify(credits, never()).charge(anyLong(), anyString(), anyLong(), anyLong(),
                anyInt(), anyInt(), anyString(), anyString());
    }

    @Test
    @DisplayName("★ 自适应时长（duration=-1）没配上限 ⇒ 仍拒绝扣款")
    void 自适应时长_没配上限_拒绝而不是扣下限() {
        service();




        Usage.ContractQuantityUnavailableException thrown = catchThrowableOfType(
                () -> charge(Map.of("duration", "-1"), perSecondRule(2_000L, 2L)),
                Usage.ContractQuantityUnavailableException.class);

        assertThat(thrown.baseUnit()).isEqualTo(UsageDim.SECONDS);
        assertThat(thrown).hasMessageContaining("usage.seconds");
    }

    @Test
    @DisplayName("★ 契约张数缺失、规则配了上限 ⇒ 按上限扣款（与 duration=-1 同一判据）")
    void 契约张数缺失_配了上限_按上限扣款() {
        service();




        charge(Map.of("size", "2k"), perSlotRule(3_000L, 1L, 30L));

        assertThat(chargedCredits()).isEqualTo(30L);
    }



    @Test
    @DisplayName("★ 自适应时长（duration=-1）配了上限 ⇒ 按上限扣款，不再拒绝提交")
    void 自适应时长_配了上限_按上限扣款() {


        service();

        charge(Map.of("duration", "-1", "resolution", "1080p"), perSecondRule(2_000L, 2L, 50L));

        assertThat(chargedCredits()).isEqualTo(50L);
    }

    @Test
    @DisplayName("★ 上限扣款与预览同价 —— 预览 50，实扣也是 50")
    void 上限扣款_报价与扣款同价() {
        BillingApplicationService service = service();
        Map<String, String> specs = Map.of("duration", "-1", "resolution", "1080p");
        String rule = perSecondRule(2_000L, 2L, 50L);


        long preview = service.quote(new QuoteQuery(USER, MODEL, TASK, specs, "free",
                Usage.empty(), LocalDateTime.now(), rule)).credits();
        charge(specs, rule);

        assertThat(preview).isEqualTo(50L).isEqualTo(chargedCredits());
    }

    @Test
    @DisplayName("没有契约量来源的维度不兜底 —— 配了上限也拒绝")
    void 没有契约量来源_不兜底() {


        service();

        Usage.ContractQuantityUnavailableException thrown = catchThrowableOfType(
                () -> charge(Map.of("voice", "female"), perPromptTokensRule(2_000L, 50L)),
                Usage.ContractQuantityUnavailableException.class);

        assertThat(thrown.baseUnit()).isEqualTo(UsageDim.PROMPT_TOKENS);
        verify(credits, never()).charge(anyLong(), anyString(), anyLong(), anyLong(),
                anyInt(), anyInt(), anyString(), anyString());
    }

    @Test
    @DisplayName("规格组合查不到价 —— 有上限也不兜底，照原样拒绝")
    void 规格查不到价_不兜底() {

        service();



        BasePriceResolver.UnpriceableSpecException thrown = catchThrowableOfType(
                () -> charge(Map.of("duration", "-1", "resolution", "720p"), """
                        {"baseUnit":"usage.seconds",
                         "basePrice":{"kind":"table","table":{"resolution=1080p":2000}},
                         "unitDenominator":1,"minCredits":2,"maxCredits":50}
                        """),
                BasePriceResolver.UnpriceableSpecException.class);

        assertThat(thrown.normalizedKey()).isEqualTo("resolution=720p");
        verify(credits, never()).charge(anyLong(), anyString(), anyLong(), anyLong(),
                anyInt(), anyInt(), anyString(), anyString());
    }



    @Test
    @DisplayName("价格预览与扣款按同一份契约用量 —— 预览价 = 会扣的钱")
    void 报价与扣款同一份契约用量() {
        service();
        Map<String, String> specs = Map.of("expected_output_count", "4", "size", "2k");
        String rule = perSlotRule(3_000L, 1L);


        long preview = service.quote(new QuoteQuery(USER, MODEL, TASK, specs, "free",
                Usage.empty(), LocalDateTime.now(), rule)).credits();
        charge(specs, rule);

        assertThat(preview).isEqualTo(chargedCredits());
    }



    @Test
    @DisplayName("★ 请求带规则快照 ⇒ 按快照计价")
    void 带快照_按快照计价() {
        service();
        Map<String, String> specs = Map.of("expected_output_count", "4", "size", "2k");

        charge(specs, snapshotJson("usage.succeededSlots", 5_000L));


        assertThat(chargedCredits()).isEqualTo(20L);
    }

    @Test
    @DisplayName("★ 快照与预览同源 —— 预览多少就扣多少")
    void 快照_预览与扣款同价() {
        service();
        Map<String, String> specs = Map.of("expected_output_count", "4", "size", "2k");
        String snapshot = snapshotJson("usage.succeededSlots", 5_000L);

        long preview = service.quote(new QuoteQuery(USER, MODEL, TASK, specs, "free",
                Usage.empty(), LocalDateTime.now(), snapshot)).credits();
        charge(specs, snapshot);


        assertThat(preview).isEqualTo(20L).isEqualTo(chargedCredits());
    }

    @Test
    @DisplayName("★ 没带快照 ⇒ 拒单（不再回落目录）")
    void 没带快照_拒单() {
        service();

        CatalogCompiler.CompileException thrown = catchThrowableOfType(
                () -> charge(Map.of("expected_output_count", "4", "size", "2k"), ""),
                CatalogCompiler.CompileException.class);

        assertThat(thrown).hasMessageContaining("规则快照");

        verify(credits, never()).charge(anyLong(), anyString(), anyLong(), anyLong(),
                anyInt(), anyInt(), anyString(), anyString());

        assertThatThrownBy(() -> service.quote(new QuoteQuery(USER, MODEL, TASK,
                Map.of("expected_output_count", "4"), "free", Usage.empty(), LocalDateTime.now(), "")))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("规则快照");
    }

    @Test
    @DisplayName("★ 快照编不过 ⇒ 拒单")
    void 快照编不过_拒单() {
        service();


        CatalogCompiler.CompileException thrown = catchThrowableOfType(
                () -> charge(Map.of("expected_output_count", "4", "size", "2k"),
                        "{\"basePrice\":{\"kind\":\"const\",\"value\":5000}}"),
                CatalogCompiler.CompileException.class);

        assertThat(thrown).hasMessageContaining("baseUnit");

        verify(credits, never()).charge(anyLong(), anyString(), anyLong(), anyLong(),
                anyInt(), anyInt(), anyString(), anyString());
    }

    @Test
    @DisplayName("★ 临期批次取数不设时间窗，上限 200")
    void 临期批次_不设时间窗_上限200() {
        CreditLotRepository lots = mock(CreditLotRepository.class);
        BillingApplicationService service = service(lots);

        service.balance(USER);

        verify(lots).listExpiring(USER, 200);
    }






    private static String perSlotRule(long mc, long minCredits) {
        return """
                {"baseUnit":"usage.succeededSlots",
                 "basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":%d}
                """.formatted(mc, minCredits);
    }


    private static String perSlotRule(long mc, long minCredits, long maxCredits) {
        return """
                {"baseUnit":"usage.succeededSlots",
                 "basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":%d,"maxCredits":%d}
                """.formatted(mc, minCredits, maxCredits);
    }


    private static String perSecondRule(long mc, long minCredits) {
        return """
                {"baseUnit":"usage.seconds",
                 "basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":%d}
                """.formatted(mc, minCredits);
    }


    private static String perSecondRule(long mc, long minCredits, long maxCredits) {
        return """
                {"baseUnit":"usage.seconds",
                 "basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":%d,"maxCredits":%d}
                """.formatted(mc, minCredits, maxCredits);
    }


    private static String perCallRule(long mc) {
        return """
                {"baseUnit":"constant:1",
                 "basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":1}
                """.formatted(mc);
    }


    private static String perPromptTokensRule(long mc, long maxCredits) {
        return """
                {"baseUnit":"usage.p",
                 "basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":2,"maxCredits":%d}
                """.formatted(mc, maxCredits);
    }






    private static String snapshotJson(String baseUnit, long mc) {
        return """
                {"baseUnit":"%s",
                 "basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":1}
                """.formatted(baseUnit, mc);
    }

    private BillingApplicationService service;


    private BillingApplicationService service() {
        return service(mock(CreditLotRepository.class));
    }

    private BillingApplicationService service(CreditLotRepository lots) {
        when(catalog.currentVersion()).thenReturn(1);
        when(credits.charge(anyLong(), anyString(), anyLong(), anyLong(), anyInt(), anyInt(),
                any(), any()))
                .thenAnswer(invocation -> ChargeResult.fresh(invocation.getArgument(3),
                        invocation.getArgument(4)));


        AbstractPricingCalculator calculator = new MediaPricingCalculator(DiscountResolver.NONE);
        service = new BillingApplicationService(
                calculator,
                credits,
                lots,
                catalog,
                new GrantPolicy(),
                mock(TransactionRepository.class),
                mock(ReservationRepository.class));
        return service;
    }






    private void charge(Map<String, String> specs, String ruleSnapshot) {
        service.charge(new ChargeCommand(USER, CMD, JOB, MODEL, TASK, specs, "free",
                "生成任务", LocalDateTime.now(), ruleSnapshot));
    }
}
