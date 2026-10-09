package com.bluewhale.billing.application;

import ch.qos.logback.classic.Level;
import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.LedgerRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.ReservationRepository;
import com.bluewhale.billing.application.view.BalanceView;
import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.domain.ledger.Allocation;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.testsupport.LogCapture;
import com.bluewhale.billing.domain.ledger.HoldResult;
import com.bluewhale.billing.domain.ledger.InsufficientCreditsException;
import com.bluewhale.billing.domain.ledger.Reservation;
import com.bluewhale.billing.domain.ledger.Voucher;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class LedgerIntegrationTest {

    private static final long USER = 9001L;
    private static final long JOB = 501L;
    private static final int CATALOG_VERSION = 1;
    private static final int NO_DISCOUNT = 10_000;
    private static final String TITLE = "视频生成 · 测试";
    private static final String NO_SNAPSHOT = null;

    private static final LocalDateTime SOON = LocalDateTime.now().plus(1, ChronoUnit.DAYS);
    private static final LocalDateTime LATER = LocalDateTime.now().plus(30, ChronoUnit.DAYS);
    private static final LocalDateTime PAST = LocalDateTime.now().minus(30, ChronoUnit.DAYS);

    @Autowired private JdbcTemplate jdbc;
    @Autowired private CreditService credits;
    @Autowired private BillingApplicationService billing;
    @Autowired private CreditLotRepository lots;
    @Autowired private LedgerRepository ledger;
    @Autowired private ReservationRepository reservations;

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM billing_ledger_entries");
        jdbc.update("DELETE FROM billing_cost_reservations");
        jdbc.update("DELETE FROM billing_credit_lots");
    }


    @Test
    void 预扣_先耗尽快到期的批次() {
        long daily = grant(CreditSource.DAILY, 100, SOON, "d1");
        long purchased = grant(CreditSource.PURCHASED, 1_000, null, "p1");

        credits.hold(USER, "cmd-1", JOB, 120, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(frozenOf(daily)).isEqualTo(100);
        assertThat(frozenOf(purchased)).isEqualTo(20);

        var allocation = reservations.findByJobId(JOB).orElseThrow().allocations();
        assertThat(allocation).extracting(Allocation::lotId).containsExactly(daily, purchased);
        assertInvariant();
    }

    @Test
    void 预扣_同为永久时按来源优先级_先扣赠送后扣付费() {
        long gift = grant(CreditSource.GIFT, 100, null, "g1");
        long purchased = grant(CreditSource.PURCHASED, 1_000, null, "p2");

        credits.hold(USER, "cmd-2", JOB, 60, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(frozenOf(gift)).isEqualTo(60);
        assertThat(frozenOf(purchased)).isZero();
        assertInvariant();
    }

    @Test
    void 预扣_已过期批次不参与_且不留下任何痕迹() {
        long expired = grant(CreditSource.DAILY, 100, PAST, "e1");
        long purchased = grant(CreditSource.PURCHASED, 100, null, "p3");

        credits.hold(USER, "cmd-3", JOB, 60, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(frozenOf(expired)).isZero();
        assertThat(frozenOf(purchased)).isEqualTo(60);
        assertThat(lots.availableCredits(USER)).isEqualTo(40);
        assertInvariant();
    }


    @Test
    void 预扣_只冻结不动remaining() {
        long lot = grant(CreditSource.GIFT, 100, null, "g2");

        credits.hold(USER, "cmd-4", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(remainingOf(lot)).isEqualTo(100);
        assertThat(frozenOf(lot)).isEqualTo(40);
        assertThat(lots.availableCredits(USER)).isEqualTo(60);
        assertInvariant();
    }

    @Test
    void 预扣_余额不足_抛异常且不留痕迹() {
        grant(CreditSource.GIFT, 10, null, "g3");

        assertThatThrownBy(() -> credits.hold(USER, "cmd-5", JOB, 11, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE))
                .isInstanceOf(InsufficientCreditsException.class)
                .hasMessageContaining("还差 1");

        assertThat(lots.availableCredits(USER)).isEqualTo(10);
        assertThat(reservations.findByJobId(JOB)).isEmpty();
        assertThat(ledgerEntryCount()).isEqualTo(2);
        assertInvariant();
    }

    @Test
    void 预扣_幂等_重复命令不二次冻结() {
        long lot = grant(CreditSource.GIFT, 100, null, "g4");

        HoldResult first = credits.hold(USER, "cmd-6", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        HoldResult second = credits.hold(USER, "cmd-6", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(first.duplicated()).isFalse();
        assertThat(second.duplicated()).isTrue();
        assertThat(second.reservedCredits()).isEqualTo(first.reservedCredits());
        assertThat(second.catalogVersion()).isEqualTo(first.catalogVersion());

        assertThat(frozenOf(lot)).isEqualTo(40);
        assertThat(ledgerEntryCount()).isEqualTo(4);
        assertInvariant();
    }


    @Test
    void 结算_实际小于预扣_差额回到可用余额() {
        long lot = grant(CreditSource.GIFT, 100, null, "g5");
        credits.hold(USER, "cmd-7", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        credits.settle(JOB, 30);

        assertThat(remainingOf(lot)).isEqualTo(70);
        assertThat(frozenOf(lot)).isZero();
        assertThat(lots.availableCredits(USER)).isEqualTo(70);
        assertThat(reservations.findByJobId(JOB).orElseThrow().status())
                .isEqualTo(Reservation.Status.SETTLED);
        assertInvariant();
        assertEveryVoucherBalanced();
    }

    @Test
    void 结算_实际大于预扣_分录仍然平_超出部分挂应收() {
        long lot = grant(CreditSource.PURCHASED, 100, null, "g-over");
        credits.hold(USER, "cmd-over", JOB, 27, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        credits.settle(JOB, 28);

        assertThat(remainingOf(lot)).isEqualTo(73);
        assertThat(frozenOf(lot)).isZero();
        assertThat(lots.availableCredits(USER))
                .as("用户实扣仍是**预扣额** 27（不是 28）—— 超出的那 1 分不从他余额里补")
                .isEqualTo(73);
        assertThat(ledger.balanceOf(USER, Account.REVENUE)).isEqualTo(28);

        Reservation settled = reservations.findByJobId(JOB).orElseThrow();
        assertThat(settled.status()).isEqualTo(Reservation.Status.SETTLED);
        assertThat(settled.actualCredits())
                .as("actual_credits 的语义**不变**：它是真实用量成本，含超出的那 1 分")
                .isEqualTo(28);
        assertThat(settled.receivableCredits())
                .as("欠费 = max(0, 实际 − 预扣) = 28 − 27")
                .isEqualTo(1);
        assertThat(ledger.balanceOf(USER, Account.RECEIVABLE))
                .as("借方余额 = 用户欠多少（正数）。若这里读到负数，说明符号约定被改反了")
                .isEqualTo(1);

        assertInvariant();
        assertEveryVoucherBalanced();
        assertReceivableColumnMatchesLedgerPerJob();
    }

    @Test
    void 结算_实际未超预扣_欠费列为零且账本无应收() {
        grant(CreditSource.PURCHASED, 200, null, "g-noover");
        long less = 511L;
        long equal = 512L;

        credits.hold(USER, "cmd-less", less, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        credits.hold(USER, "cmd-equal", equal, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        credits.settle(less, 30);
        credits.settle(equal, 40);

        for (long jobId : new long[]{less, equal}) {
            assertThat(reservations.findByJobId(jobId).orElseThrow().receivableCredits())
                    .as("jobId=%s：实际 ≤ 预扣 → 一分不欠（不是 null、不是实际值）", jobId)
                    .isZero();
            assertThat(receivableLegOfJob(jobId))
                    .as("jobId=%s：账本上根本不该出现应收这一腿", jobId)
                    .isZero();
        }
        assertThat(ledger.balanceOf(USER, Account.RECEIVABLE))
                .as("整个账户的应收余额应为 0 —— 有超扣才该非零")
                .isZero();
        assertThat(lots.availableCredits(USER)).isEqualTo(130);
        assertInvariant();
        assertEveryVoucherBalanced();
        assertReceivableColumnMatchesLedgerPerJob();
    }

    @Test
    void 结算_欠费列与账本应收逐笔相等() {
        long over1 = 521L;
        long exact = 522L;
        long under = 523L;
        long over15 = 524L;

        grant(CreditSource.PURCHASED, 500, null, "g-recv");
        credits.hold(USER, "cmd-r1", over1, 27, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        credits.hold(USER, "cmd-r2", exact, 50, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        credits.hold(USER, "cmd-r3", under, 60, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        credits.hold(USER, "cmd-r4", over15, 30, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        credits.settle(over1, 28);
        credits.settle(exact, 50);
        credits.settle(under, 10);
        credits.settle(over15, 45);

        assertThat(receivableColumnOf(over1)).isEqualTo(1);
        assertThat(receivableColumnOf(exact)).isZero();
        assertThat(receivableColumnOf(under)).isZero();
        assertThat(receivableColumnOf(over15)).isEqualTo(15);

        assertEveryVoucherBalanced();
        assertReceivableColumnMatchesLedgerPerJob();
    }

    @Test
    void 结算_超预扣_warn里带出欠费额() {
        grant(CreditSource.PURCHASED, 100, null, "g-warn");
        credits.hold(USER, "cmd-warn", JOB, 27, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        try (LogCapture logs = LogCapture.of(CreditService.class)) {
            credits.settle(JOB, 28);

            assertThat(logs.text(Level.WARN))
                    .as("这条 WARN 是欠费的唯一主动出口；缺了金额就只剩翻库")
                    .contains("jobId=" + JOB)
                    .contains("预扣=27")
                    .contains("实际=28")
                    .contains("欠费=1");
        }
        assertInvariant();
    }

    @Test
    void 结算_跨来源批次_收入与成本分别记账() {
        long gift = grant(CreditSource.GIFT, 20, null, "g6");
        long purchased = grant(CreditSource.PURCHASED, 100, null, "p4");

        credits.hold(USER, "cmd-8", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        credits.settle(JOB, 35);

        assertThat(remainingOf(gift)).isZero();
        assertThat(remainingOf(purchased)).isEqualTo(85);

        assertThat(ledger.balanceOf(USER, Account.COST)).isEqualTo(100);
        assertThat(ledger.balanceOf(USER, Account.REVENUE)).isEqualTo(15);

        var accounts = ledgerAccountsOfVoucher("settle:" + JOB);
        assertThat(accounts).containsExactlyInAnyOrder("frozen", "cost", "revenue", "wallet");
        assertInvariant();
        assertEveryVoucherBalanced();
    }


    @Test
    void 返还_批次原封不动_有效期不被重置() {
        long lot = grant(CreditSource.DAILY, 100, LATER, "g7");
        LocalDateTime expiresBefore = expiresOf(lot);

        credits.hold(USER, "cmd-9", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        credits.refund(JOB, "上游任务失败");

        assertThat(remainingOf(lot)).isEqualTo(100);
        assertThat(frozenOf(lot)).isZero();
        assertThat(expiresOf(lot)).isEqualTo(expiresBefore);

        var reservation = reservations.findByJobId(JOB).orElseThrow();
        assertThat(reservation.status()).isEqualTo(Reservation.Status.RELEASED);
        assertThat(reservation.releaseNote()).isEqualTo("上游任务失败");
        assertInvariant();
        assertEveryVoucherBalanced();
    }

    @Test
    void 结算之后再返还_无操作() {
        long lot = grant(CreditSource.GIFT, 100, null, "g8");
        credits.hold(USER, "cmd-10", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        credits.settle(JOB, 40);
        int entriesAfterSettle = ledgerEntryCount();

        credits.refund(JOB, "迟到的失败回调");

        assertThat(ledgerEntryCount()).isEqualTo(entriesAfterSettle);
        assertThat(remainingOf(lot)).isEqualTo(60);
        assertThat(frozenOf(lot)).isZero();
        assertThat(reservations.findByJobId(JOB).orElseThrow().status())
                .isEqualTo(Reservation.Status.SETTLED);
        assertInvariant();
    }


    @Test
    void 会话时区已钉成北京时间() {
        assertThat(jdbc.queryForObject(
                "SELECT TIMESTAMPDIFF(HOUR, UTC_TIMESTAMP(), NOW())", Integer.class))
                .as("NOW() 必须比 UTC_TIMESTAMP() 快 8 小时；"
                        + "否则 DATETIME 的写入口径与 NOW() 的判定口径相差整小时")
                .isEqualTo(8);
    }

    @Test
    void 到期边界_一小时内到期的批次判定正确() {
        long expiring = grant(CreditSource.GIFT, 100, LocalDateTime.now().plus(1, ChronoUnit.HOURS), "tz-a");
        long expired = grant(CreditSource.GIFT, 100, LocalDateTime.now().minus(1, ChronoUnit.HOURS), "tz-b");

        credits.hold(USER, "cmd-tz", JOB, 60, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(frozenOf(expiring)).isEqualTo(60);
        assertThat(frozenOf(expired)).isZero();
        assertInvariant();
    }


    @Test
    void 可用积分按来源拆分_各分量之和等于总额() {
        grant(CreditSource.PURCHASED, 1_500, null, "bs-purchased");
        grant(CreditSource.BONUS, 1_000, LocalDateTime.now().plus(30, ChronoUnit.DAYS), "bs-bonus");
        grant(CreditSource.DAILY, 777, LocalDateTime.now().minus(1, ChronoUnit.HOURS), "bs-expired");

        BalanceView balance = billing.balance(USER);

        assertThat(balance.availableCredits()).isEqualTo(2_500);

        Map<String, Long> bySource = new LinkedHashMap<>();
        for (BalanceView.SourceCredits item : balance.bySource()) {
            bySource.put(item.source(), item.credits());
        }
        assertThat(bySource)
                .containsEntry(CreditSource.PURCHASED.key(), 1_500L)
                .containsEntry(CreditSource.BONUS.key(), 1_000L)
                .doesNotContainKey(CreditSource.DAILY.key());

        assertThat(balance.bySource().stream().mapToLong(BalanceView.SourceCredits::credits).sum())
                .as("Σ 各来源 == 可用总额")
                .isEqualTo(balance.availableCredits());
    }


    private long grant(CreditSource source, long amount, LocalDateTime expiresAt, String grantKey) {
        return credits.grant(USER, source, amount, expiresAt, "grant", grantKey, grantKey);
    }

    private void assertInvariant() {
        long wallet = ledger.balanceOf(USER, Account.WALLET);
        long frozen = ledger.balanceOf(USER, Account.FROZEN);
        assertThat(wallet + frozen)
                .as("wallet(%s) + frozen(%s) 应等于 Σ remaining", wallet, frozen)
                .isEqualTo(totalRemaining());
        assertThat(lots.availableCredits(USER) + expiredAvailable())
                .as("未过期可用 + 已过期未核销 应等于账本 wallet(%s)", wallet)
                .isEqualTo(wallet);
    }

    private long expiredAvailable() {
        Long sum = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining - frozen), 0) FROM billing_credit_lots "
                        + "WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at <= NOW()",
                Long.class, USER);
        return sum == null ? 0L : sum;
    }

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

    private List<String> ledgerAccountsOfVoucher(String idempotencyBase) {
        return jdbc.queryForList(
                "SELECT account FROM billing_ledger_entries WHERE idempotency_key LIKE ?",
                String.class, idempotencyBase + ":%");
    }


    private void assertReceivableColumnMatchesLedgerPerJob() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT generation_job_id, receivable_credits FROM billing_cost_reservations "
                        + "WHERE user_id = ? AND status = 'settled' ORDER BY generation_job_id",
                USER);
        assertThat(rows).as("应有已结算的预留可供逐笔比对").isNotEmpty();

        for (Map<String, Object> row : rows) {
            long jobId = ((Number) row.get("generation_job_id")).longValue();
            long column = ((Number) row.get("receivable_credits")).longValue();
            assertThat(column)
                    .as("jobId=%s：欠费列(%s) 必须与账本 settle:%s:receivable 那一腿(%s) 相等"
                                    + " —— 两者由同一次结算、同一个表达式写下",
                            jobId, column, jobId, receivableLegOfJob(jobId))
                    .isEqualTo(receivableLegOfJob(jobId));
            assertThat(column)
                    .as("jobId=%s：欠费列也必须等于「实际 − 预扣」（负数归零）"
                            + " —— 只比「列 == 分录」不够，两处一起写错时照样相等", jobId)
                    .isEqualTo(overageOf(jobId));
        }

        assertThat(sumReceivableColumn())
                .as("Σ 预留行欠费列 应等于账本 RECEIVABLE 余额 —— 这是「按 job 记账」"
                        + "与「按用户汇总」之间唯一能对上的连接点")
                .isEqualTo(ledger.balanceOf(USER, Account.RECEIVABLE));
    }

    private long receivableLegOfJob(long jobId) {
        List<Long> amounts = jdbc.queryForList(
                "SELECT amount FROM billing_ledger_entries WHERE idempotency_key = ?",
                Long.class, Voucher.legKey("settle:" + jobId, Account.RECEIVABLE));
        return amounts.isEmpty() ? 0L : amounts.get(0);
    }

    private long overageOf(long jobId) {
        Long overage = jdbc.queryForObject(
                "SELECT GREATEST(actual_credits - reserved_credits, 0) "
                        + "FROM billing_cost_reservations WHERE generation_job_id = ?",
                Long.class, jobId);
        return overage == null ? 0L : overage;
    }

    private long receivableColumnOf(long jobId) {
        Long credits = jdbc.queryForObject(
                "SELECT receivable_credits FROM billing_cost_reservations WHERE generation_job_id = ?",
                Long.class, jobId);
        return credits == null ? 0L : credits;
    }

    private long sumReceivableColumn() {
        Long sum = jdbc.queryForObject(
                "SELECT COALESCE(SUM(receivable_credits), 0) FROM billing_cost_reservations "
                        + "WHERE user_id = ? AND status = 'settled'",
                Long.class, USER);
        return sum == null ? 0L : sum;
    }

    private long remainingOf(long lotId) {
        return jdbc.queryForObject(
                "SELECT remaining FROM billing_credit_lots WHERE id = ?", Long.class, lotId);
    }

    private long frozenOf(long lotId) {
        return jdbc.queryForObject(
                "SELECT frozen FROM billing_credit_lots WHERE id = ?", Long.class, lotId);
    }

    private LocalDateTime expiresOf(long lotId) {
        return jdbc.queryForObject(
                "SELECT expires_at FROM billing_credit_lots WHERE id = ?",
                LocalDateTime.class, lotId);
    }

    private long totalRemaining() {
        Long sum = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining), 0) FROM billing_credit_lots WHERE user_id = ?",
                Long.class, USER);
        return sum == null ? 0L : sum;
    }

    private int ledgerEntryCount() {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_ledger_entries WHERE user_id = ?", Integer.class, USER);
        return count == null ? 0 : count;
    }
}
