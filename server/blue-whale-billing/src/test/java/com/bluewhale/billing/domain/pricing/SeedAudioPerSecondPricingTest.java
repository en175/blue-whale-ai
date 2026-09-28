package com.bluewhale.billing.domain.pricing;

import com.bluewhale.billing.application.CatalogCompiler;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 音频（Seed Audio 1.0）按产出秒数计价的**金额**核对。
 *
 * <h2>为什么这条要用真实规则文本</h2>
 *
 * 别处测计价都是手搭一个 {@link CompiledRule}，检的是「引擎会不会算」。
 * 这条要检的是**另一件事**：迁移 043 写进库里的那段 JSON，经
 * {@link CatalogCompiler#compileRuleSnapshot} 编译之后，**算出来的钱是不是官方那个数**。
 * 用手搭的规则测不出这个 —— 那正好绕开了唯一可能出错的一段（JSON 的形态与单位）。
 *
 * <p>所以下面的 {@link #RULE_JSON} 是**从迁移里逐字抄下来的**，不是等价改写：
 * 改一处数字要三处同改（迁移三轨 + 这里），这条测试才有可能拦住错误。
 *
 * <h2>官方口径</h2>
 *
 * 火山方舟：Seed Audio 1.0 **0.3 元/分钟**，按模型**原始输出时长**计费、精确至秒；
 * 单次输出上限 2 分钟。
 * 换算：{@code 0.3 元/分 ÷ 60 = 0.005 元/秒}；{@code × 15 积分/元 = 0.075 积分/秒}；
 * {@code × 1000 = 75 mc/秒}（规则里 {@code basePrice.value} 的单位是 mc）。
 *
 * <p>1 积分 = 1/15 元 ≈ 0.0667 元，所以**最短约 13.3 秒以下的音频都收 1 积分**（下限兜底）——
 * 这是整数积分这个货币粒度的固有结果，不是配错。
 */
class SeedAudioPerSecondPricingTest {

    /**
     * 迁移 043 写下的规则，**逐字**。
     * 改动它等于改动线上收多少钱 —— 不会报错，只会收错。
     */
    private static final String RULE_JSON = """
            {"baseUnit":"usage.seconds",
             "basePrice":{"kind":"const","value":75},
             "unitDenominator":1,
             "minCredits":1,
             "maxCredits":12}
            """;

    private static final Instant T = Instant.parse("2026-09-26T15:00:00+08:00");

    /** 官方单价：0.3 元/分钟；1 元 = 15 积分。 */
    private static final double OFFICIAL_YUAN_PER_MINUTE = 0.3;
    private static final double CREDITS_PER_YUAN = 15.0;

    private static final CompiledRule RULE = CatalogCompiler.compileRuleSnapshot(RULE_JSON);

    private static PricingEngine engine() {
        return PricingEngine.forMedia((model, task) -> RULE, DiscountResolver.NONE);
    }

    private static PricingRequest req() {
        return new PricingRequest(42L, "seed-audio-1.0", "audio", Map.of(), "free");
    }

    /** 按 worker 上报的真实用量计价（结算路径）。 */
    private static long settledWithSeconds(long seconds) {
        Usage usage = Usage.ofKeys("seed-audio-1.0", "audio", Map.of("usage.seconds", seconds));
        return engine().compute(req(), usage, T).credits();
    }

    /** 该秒数在官方价目下的**应付元**（用于把「我们收的积分」换算回来对账）。 */
    private static double officialYuan(long seconds) {
        return OFFICIAL_YUAN_PER_MINUTE / 60.0 * seconds;
    }

    @Test
    @DisplayName("★ 规则文本本身能编译 —— 迁移里那段 JSON 不是脏配置")
    void 规则可编译() {
        // 编译不过 ⇒ backend 在 Hold 时送的快照被 billing 以 UNPRICEABLE 拒单，
        // 表现是这个模型**每次提交都失败**。这条先于任何金额断言。
        assertThat(RULE.baseUnit()).isEqualTo(UsageDim.SECONDS);
        assertThat(RULE.maxCredits()).isEqualTo(12L);
    }

    @Test
    @DisplayName("★ 单价就是官方的 0.3 元/分钟：120 秒 = 0.6 元（整数积分为 9）")
    void 上限档与官方完全一致() {
        // 120 s 是官方单次输出上限，也是这条规则最贵的一单。
        // 9 积分 ÷ 15 积分/元 = 0.6 元 —— 与 0.3 元/分 × 2 分**逐分不差**。
        assertThat(settledWithSeconds(120)).isEqualTo(9L);
        assertThat(9L / CREDITS_PER_YUAN).isEqualTo(officialYuan(120));
    }

    @Test
    @DisplayName("★ 按真实秒数线性计费（不是按次 —— 这正是这次改动要修的那个错）")
    void 按时长线性变化() {
        // 原规则是 constant:1 / 1.33 元/次：3 秒和 120 秒一个价。现在必须拉开。
        assertThat(settledWithSeconds(120)).isGreaterThan(settledWithSeconds(60));
        assertThat(settledWithSeconds(60)).isGreaterThan(settledWithSeconds(30));
        // 30 × 75 = 2250 mc = 2.25 积分 → halfUp → 2 积分（≈0.133 元）
        assertThat(settledWithSeconds(30)).isEqualTo(2L);
        // ⚠️ 与官方 30 s = 0.1 元的差来自「积分是整数」这一层粒度（1 积分 ≈ 0.0667 元），
        //    不是单价配错 —— 单价的正确性由下面「换算回官方口径」那条钉住。
    }

    @Test
    @DisplayName("★ 60 秒那一档与官方价逐一对齐（1 分钟 = 0.3 元 = 4.5 积分 → 进位 5）")
    void 一分钟档() {
        long credits = settledWithSeconds(60);
        // 60 × 75 mc = 4500 mc = 4.5 积分；rounding 默认 halfUp → 5 积分 ≈ 0.333 元。
        // 与官方 0.3 元的差来自「积分是整数」这一层粒度，不是单价配错 ——
        // 单价本身的正确性由下面那条「换算回来」的断言钉住。
        assertThat(credits).isEqualTo(5L);
        assertThat(60L * 75.0 / 1000.0).isEqualTo(4.5);
    }

    @Test
    @DisplayName("★ 反推：我们自己实现的 mc/秒 × 60 ÷ 1000 ÷ 15 必须等于 0.3 元/分钟")
    void 单价换算回官方口径() {
        // 这条是**唯一**直接检「75 这个数对不对」的断言：把规则里的单价按
        // mc → 积分 → 元倒推回每分钟，必须与官方文档上的 0.3 一模一样。
        long mcPerSecond = 75L; // = RULE_JSON 里的 basePrice.value
        double yuanPerMinute = mcPerSecond * 60.0 / 1000.0 / CREDITS_PER_YUAN;
        assertThat(yuanPerMinute).isEqualTo(OFFICIAL_YUAN_PER_MINUTE);
    }

    @Test
    @DisplayName("★ 极短音频被下限兜到 1 积分（货币粒度，不是配错）")
    void 极短音频兜下限() {
        // 3 × 75 = 225 mc = 0.225 积分 → halfUp → 0 → 被 minCredits=1 兜住。
        assertThat(settledWithSeconds(3)).isEqualTo(1L);
        assertThat(RULE.minCredits()).isEqualTo(1L);
    }

    @Test
    @DisplayName("★ 超出上限的输出被 maxCredits 封顶（不会因为上游多吐几秒就超收）")
    void 封顶() {
        // 官方单次上限 120 s；真出现 200 s（上游异常），收 12 积分封顶，
        // 超出部分不进用户账单 —— 封顶是对**用户**的保护。
        assertThat(settledWithSeconds(200)).isEqualTo(12L);
    }

    @Test
    @DisplayName("★ 提交时刻没有 duration → 契约量取不到（这正是 maxCredits 必须存在的原因）")
    void 提交时刻取不到契约量() {
        // Seed Audio 是 TTS：时长由文案决定，请求里根本没有 duration，
        // 所以 specs 里永远不会有 `duration` 这个键。
        // billing 的立场是「拒绝，而不是按 0 冻」—— 除非规则配了 maxCredits，
        // 由 BillingApplicationService#priceAtCap 转成「按上限冻结、结算按实际重算」。
        assertThatThrownBy(() -> Usage.contractFrom(RULE, Map.of()))
                .isInstanceOf(Usage.ContractQuantityUnavailableException.class)
                .hasMessageContaining("usage.seconds");

        // 而 maxCredits 确实配了，所以预扣走的是「冻 12、按真实秒数收、差额退回」
        assertThat(RULE.maxCredits()).isNotNull();
        assertThat(engine().computeAtCap(req(), T).credits()).isEqualTo(12L);
    }

    @Test
    @DisplayName("★ 预扣 ≥ 实收：官方整个取值区间内都不会出现「结算超出预扣」（那笔钱会记成应收=真少收）")
    void 预扣不小于实收() {
        // 这是这条规则**最要紧**的不变式。billing 的 CreditService#settle 里
        // `consumed = min(actualCredits, reserved)` —— 实际超过预扣的那部分**不会向用户收**，
        // 只记一笔应收 + 一条 WARN。也就是说「预扣配小了」= 静默亏损，且账面上只是一条告警。
        //
        // 官方上限 120 s，这里把 1…120 全扫一遍：任何一秒都不允许 settle > cap。
        long cap = engine().computeAtCap(req(), T).credits();
        for (long seconds = 1; seconds <= 120; seconds++) {
            assertThat(settledWithSeconds(seconds))
                    .as("第 %d 秒的实收超过了预扣上限 %d", seconds, cap)
                    .isLessThanOrEqualTo(cap);
        }
    }
}
