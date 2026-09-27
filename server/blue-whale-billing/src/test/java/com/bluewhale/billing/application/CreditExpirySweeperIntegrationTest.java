package com.bluewhale.billing.application;

import ch.qos.logback.classic.Level;
import com.bluewhale.billing.adapter.outbound.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.adapter.outbound.persistence.repository.LedgerRepository;
import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.testsupport.LogCapture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 过期核销的真库集成测试（《通用积分卡 PRD》§9.5「过期处理」/§9.6「积分过期」）。
 *
 * <p>为什么必须真库跑：这一层的全部价值都在**三张表的最终状态**上——
 * 批次 remaining 落到多少、账本落没落 {@code expire:} 凭证、wallet 与 cost 同额减少。
 * mock 掉 Repository 就等于把被测对象换成自己的期望，测试只会复述实现。
 *
 * <p>门控同其它集成测试：设置 {@code BILLING_DB_PASSWORD} 才跑；
 * {@code BillingTestDatabaseGate} 另外保证它只落在 {@code bw_billing_test*} 上。
 *
 * <h2>本文件钉住的三条口径</h2>
 *
 * <ol>
 *   <li><b>核销额 = remaining − frozen</b>，冻结部分不过期（§10 决策 7）——
 *       在途任务仍要能结算成功，所以它锁着的那部分不跟着到期；</li>
 *   <li><b>核销要动批次也要动账本</b>：批次扣 remaining、账本记
 *       {@code 借 wallet / 贷 cost}，两侧等量减少，每日自检的
 *       {@code Σ lots.remaining == ledger(wallet) + ledger(frozen)} 核销前后都成立；</li>
 *   <li><b>幂等键带批次版本号</b>——同一批次的「冻结解冻回来又到期」必须能再核销一次，
 *       用 {@code expire:{lotId}} 做键会把第二次静默吞掉（见
 *       {@link CreditService#expireLot}）。</li>
 * </ol>
 *
 * <h2>定时入口怎么测</h2>
 *
 * <p>测试直接调 {@link CreditExpirySweeper#sweepOnce()}，它是 {@code @Scheduled} 入口
 * 调用的**同一个方法**（见 {@code sweep()}）。测试线程里没有调度器，
 * 也就不存在「后台把我造的夹具先核销掉」这种看运气的失败——
 * 测试配置把首次执行推到了 24 小时后（见 {@code src/test/resources/application.properties}）。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class CreditExpirySweeperIntegrationTest {

    private static final long USER = 9801L;
    /** 目录版本与折扣：本测试考的是核销，不考计价，给一组合法值即可。 */
    private static final int CATALOG_VERSION = 1;
    private static final int NO_DISCOUNT = 10_000;

    /** 早已到期——核销扫描的取样条件。 */
    private static final Instant PAST = Instant.now().minus(1, ChronoUnit.HOURS);
    /** 还没到期——不该被碰。 */
    private static final Instant FUTURE = Instant.now().plus(30, ChronoUnit.DAYS);

    @Autowired private JdbcTemplate jdbc;
    @Autowired private CreditService credits;
    @Autowired private CreditExpirySweeper sweeper;
    @Autowired private CreditLotRepository lots;
    @Autowired private LedgerRepository ledger;

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM billing_ledger_entries");
        jdbc.update("DELETE FROM billing_cost_reservations");
        jdbc.update("DELETE FROM billing_credit_lots");
    }

    // ─────────────────────────────────────────────────────────────
    // 到期即核销
    // ─────────────────────────────────────────────────────────────

    @Test
    void 到期批次_核销可用量并落expire凭证() {
        long lot = grant(CreditSource.GIFT, 500, PAST, "exp-1");

        CreditExpirySweeper.SweepResult result = sweeper.sweepOnce();

        assertThat(result.due()).extracting(CreditLotRepository.Lot::id).containsExactly(lot);
        assertThat(result.expired()).isEqualTo(1);
        assertThat(result.expiredCredits()).isEqualTo(500);
        assertThat(result.failed()).isZero();

        // ① 批次：可用量清零（frozen 本来就是 0，所以 remaining 归零）
        assertThat(remainingOf(lot)).isZero();
        assertThat(lots.availableCredits(USER)).isZero();

        // ② 账本：借 wallet / 贷 cost，两条腿同额。方向反了会让用户余额凭空变大，
        //    所以不只断言「有两条分录」，而是断言两个余额各减 500
        assertThat(ledger.balanceOf(USER, Account.WALLET)).isZero();
        assertThat(ledger.balanceOf(USER, Account.COST)).isZero();   // 发放时 +500，核销冲回
        assertThat(ledgerAccountsOfExpireVoucher()).containsExactlyInAnyOrder("wallet", "cost");

        assertInvariant();
        assertEveryVoucherBalanced();
    }

    @Test
    void 未到期批次_不被核销() {
        long lot = grant(CreditSource.GIFT, 500, FUTURE, "exp-2");

        CreditExpirySweeper.SweepResult result = sweeper.sweepOnce();

        assertThat(result.due()).isEmpty();
        assertThat(result.expired()).isZero();
        assertThat(remainingOf(lot)).isEqualTo(500);
        assertThat(lots.availableCredits(USER)).isEqualTo(500);
        assertThat(expireLegCount()).isZero();
    }

    @Test
    void 永久批次_不被核销() {
        long lot = grant(CreditSource.PURCHASED, 500, null, "exp-3");

        CreditExpirySweeper.SweepResult result = sweeper.sweepOnce();

        // NULL = 永久。这不是「有效期很长」，而是**没有有效期**——
        // 扫描语句的 expires_at IS NOT NULL 让它根本不进候选集
        assertThat(result.due()).isEmpty();
        assertThat(remainingOf(lot)).isEqualTo(500);
        assertThat(expireLegCount()).isZero();
    }

    @Test
    void 提前核销_被拒绝() {
        long lot = grant(CreditSource.GIFT, 500, FUTURE, "exp-4");
        int entriesBefore = ledgerEntryCount();

        // 直接调核销入口（管理端/运维也会直接调）——少一道到期判据就多一条
        // 「提前把用户还不能用的钱作废掉」的路径
        long amount = credits.expireLot(lot);

        assertThat(amount)
                .as("未到期的批次不该被核销：核销的是「已经作废」的积分，不是「将要作废」的")
                .isZero();
        assertThat(remainingOf(lot)).isEqualTo(500);
        assertThat(ledgerEntryCount()).isEqualTo(entriesBefore);
    }

    // ─────────────────────────────────────────────────────────────
    // 幂等
    // ─────────────────────────────────────────────────────────────

    @Test
    void 重复扫描_不二次核销() {
        long lot = grant(CreditSource.GIFT, 500, PAST, "exp-5");

        sweeper.sweepOnce();
        int entriesAfterFirst = ledgerEntryCount();

        // 每轮扫描都会重新读到同一批（扣过的批次 available 归零，但语句筛的是
        // remaining > frozen，已归零的自然不再入选）。真正的保护是幂等键那一层：
        // 即便同一批次被读到两次（并发轮次），也只记一次
        CreditExpirySweeper.SweepResult second = sweeper.sweepOnce();

        assertThat(second.expired()).isZero();
        assertThat(second.due()).isEmpty();
        assertThat(ledgerEntryCount())
                .as("没有第二条 expire 凭证 —— 同一笔积分被核销了两次")
                .isEqualTo(entriesAfterFirst);
        assertThat(remainingOf(lot)).isZero();
        assertInvariant();
    }

    @Test
    void 同一批次被直接核销两次_第二次无操作() {
        long lot = grant(CreditSource.GIFT, 500, PAST, "exp-6");

        assertThat(credits.expireLot(lot)).isEqualTo(500);
        int entriesAfterFirst = ledgerEntryCount();

        assertThat(credits.expireLot(lot)).as("第二次没有可核销量").isZero();
        assertThat(ledgerEntryCount()).isEqualTo(entriesAfterFirst);
        assertInvariant();
    }

    // ─────────────────────────────────────────────────────────────
    // 冻结部分不过期（§10 决策 7）
    // ─────────────────────────────────────────────────────────────

    @Test
    void 冻结部分不过期_解冻后下一轮再核销() {
        long jobId = 9901L;
        // 起手是有效批次：预扣只从**未过期**的批次里锁（lockActiveLots 的 WHERE 条件），
        // 所以「到期时还冻着钱」只能这样造——先扣，再让它到期
        long lot = grant(CreditSource.GIFT, 500, FUTURE, "exp-7");
        credits.hold(USER, "cmd-exp-7", jobId, 200, CATALOG_VERSION, NO_DISCOUNT, null, "视频生成 · 过期测试");
        backdateExpiry(lot, 1);

        CreditExpirySweeper.SweepResult first = sweeper.sweepOnce();

        // ① 只销可用部分 300，冻结的 200 原封不动：
        //    在途任务仍要能结算成功（用户为已经发生的生成付费）
        assertThat(first.expiredCredits()).isEqualTo(300);
        assertThat(remainingOf(lot)).isEqualTo(200);
        assertThat(frozenOf(lot)).isEqualTo(200);
        assertThat(lots.availableCredits(USER)).isZero();
        assertInvariant();

        // ② 任务失败全额返还：钱回到可用余额——但它仍然是**已过期**的积分
        credits.refund(jobId, "上游任务失败");
        assertThat(frozenOf(lot)).isZero();
        assertThat(remainingOf(lot)).isEqualTo(200);

        // ③ 下一轮必须能把它再核销一次。这就是幂等键要带版本号的原因：
        //    用 expire:{lotId} 做键时，这一次会被判成重放**静默跳过**，
        //    200 积分永远留在批次与账本里（而对账恒等式仍然成立，不会有任何告警响）
        CreditExpirySweeper.SweepResult second = sweeper.sweepOnce();

        assertThat(second.expiredCredits())
                .as("解冻回来的那部分仍是已过期积分，必须在下一轮被核销")
                .isEqualTo(200);
        assertThat(remainingOf(lot)).isZero();
        assertThat(lots.availableCredits(USER)).isZero();
        assertThat(expireLegCount()).as("两次核销 = 两张凭证（每张两条腿），不是一张").isEqualTo(4);
        assertInvariant();
        assertEveryVoucherBalanced();
    }

    @Test
    void 全部冻结的到期批次_本轮核销不动_也不占用下一轮的判断() {
        long jobId = 9902L;
        long lot = grant(CreditSource.GIFT, 500, FUTURE, "exp-8");
        credits.hold(USER, "cmd-exp-8", jobId, 500, CATALOG_VERSION, NO_DISCOUNT, null, "视频生成 · 全冻测试");
        backdateExpiry(lot, 1);

        // 可用量为 0 → 扫描语句的 remaining > frozen 直接把它挡在候选集之外
        CreditExpirySweeper.SweepResult result = sweeper.sweepOnce();

        assertThat(result.due()).isEmpty();
        assertThat(result.expired()).isZero();
        assertThat(remainingOf(lot)).isEqualTo(500);
        assertThat(frozenOf(lot)).isEqualTo(500);
        assertInvariant();
    }

    // ─────────────────────────────────────────────────────────────
    // 可观测性
    // ─────────────────────────────────────────────────────────────

    @Test
    void 每轮都留下一行日志_无到期批次时也不例外() {
        // 定时任务最怕的不是报错，是**静默没跑**：没有这一行就无从回答「它还在跑吗」
        try (LogCapture logs = LogCapture.of(CreditExpirySweeper.class)) {
            sweeper.sweepOnce();

            assertThat(logs.text(Level.INFO)).contains("无到期批次");
        }
    }

    @Test
    void 核销明细_日志里带得出批次与金额() {
        long lot = grant(CreditSource.GIFT, 500, PAST, "exp-9");

        try (LogCapture logs = LogCapture.of(CreditExpirySweeper.class)) {
            sweeper.sweepOnce();

            // 它改的是数据，但「为什么改、改了多少」只在日志里。缺了 these，
            // 事后只能靠翻库把「这 500 分是怎么没的」重新拼一遍
            assertThat(logs.text(Level.INFO))
                    .contains("lotId=" + lot)
                    .contains("userId=" + USER)
                    .contains("核销=500");
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 夹具与断言工具
    // ─────────────────────────────────────────────────────────────

    /** 走真实的发放路径造一条批次（账本那两条腿也是真的）。 */
    private long grant(CreditSource source, long amount, Instant expiresAt, String grantKey) {
        return credits.grant(USER, source, amount, expiresAt, "grant", grantKey, grantKey);
    }

    /**
     * 把批次的到期时刻拨到过去。
     *
     * <p>只有这一条路能造出「到期时还冻着钱」：预扣只从有效批次里锁（见
     * {@link CreditLotRepository#lockActiveLots}），所以必须**先扣再让它到期**。
     * 拨库里的那一列而不是在 Java 侧算：扫描判的是库里的墙钟（{@code NOW()}）。
     */
    private void backdateExpiry(long lotId, int hoursAgo) {
        jdbc.update("UPDATE billing_credit_lots "
                + "SET expires_at = NOW() - INTERVAL ? HOUR WHERE id = ?", hoursAgo, lotId);
    }

    private long expireLegCount() {
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_ledger_entries WHERE idempotency_key LIKE 'expire:%'",
                Long.class);
        return count == null ? 0L : count;
    }

    /** 该用户所有 expire 凭证涉及的科目（每张凭证两条腿：用户侧一条、平台侧一条）。 */
    private List<String> ledgerAccountsOfExpireVoucher() {
        return jdbc.queryForList(
                "SELECT DISTINCT account FROM billing_ledger_entries "
                        + "WHERE user_id = ? AND biz_type = 'expire' ORDER BY account",
                String.class, USER);
    }

    /** 每条凭证（按幂等键去掉科目后缀归组）借贷合计必须相等。 */
    private void assertEveryVoucherBalanced() {
        Map<String, long[]> byVoucher = new LinkedHashMap<>();
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT idempotency_key, direction, amount FROM billing_ledger_entries WHERE user_id = ?",
                USER);
        for (Map<String, Object> row : rows) {
            String key = (String) row.get("idempotency_key");
            String base = key.substring(0, key.lastIndexOf(':'));
            long amount = ((Number) row.get("amount")).longValue();
            boolean isDebit = "debit".equals(row.get("direction"));
            byVoucher.computeIfAbsent(base, ignored -> new long[2])[isDebit ? 0 : 1] += amount;
        }
        assertThat(byVoucher).as("应至少记过一笔凭证").isNotEmpty();
        byVoucher.forEach((base, sums) -> assertThat(sums[0])
                .as("凭证 %s 借贷不平：借 %s / 贷 %s", base, sums[0], sums[1])
                .isEqualTo(sums[1]));
    }

    /**
     * 核心恒等式（与 {@code LedgerIntegrationTest} 同一口径）：
     * {@code wallet + frozen == Σ lots.remaining}。
     *
     * <p>核销**两侧同时减**，所以它在核销前后都成立——这正是「只写账本不改批次」
     * 那种做法会当场露馅的地方。
     */
    private void assertInvariant() {
        Long remaining = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining), 0) FROM billing_credit_lots WHERE user_id = ?",
                Long.class, USER);
        long wallet = ledger.balanceOf(USER, Account.WALLET);
        long frozen = ledger.balanceOf(USER, Account.FROZEN);
        assertThat(wallet + frozen)
                .as("核销是两侧等量减少，不得打破 Σ remaining == wallet + frozen"
                        + "（wallet=%s frozen=%s）", wallet, frozen)
                .isEqualTo(remaining);
    }

    private long remainingOf(long lotId) {
        return jdbc.queryForObject(
                "SELECT remaining FROM billing_credit_lots WHERE id = ?", Long.class, lotId);
    }

    private long frozenOf(long lotId) {
        return jdbc.queryForObject(
                "SELECT frozen FROM billing_credit_lots WHERE id = ?", Long.class, lotId);
    }

    private int ledgerEntryCount() {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_ledger_entries WHERE user_id = ?", Integer.class, USER);
        return count == null ? 0 : count;
    }
}
