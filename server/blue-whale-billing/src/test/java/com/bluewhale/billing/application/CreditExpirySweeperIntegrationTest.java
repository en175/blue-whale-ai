package com.bluewhale.billing.application;

import ch.qos.logback.classic.Level;
import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.LedgerRepository;
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

@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class CreditExpirySweeperIntegrationTest {

    private static final long USER = 9801L;
    private static final int CATALOG_VERSION = 1;
    private static final int NO_DISCOUNT = 10_000;

    private static final Instant PAST = Instant.now().minus(1, ChronoUnit.HOURS);
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


    @Test
    void 到期批次_核销可用量并落expire凭证() {
        long lot = grant(CreditSource.GIFT, 500, PAST, "exp-1");

        CreditExpirySweeper.SweepResult result = sweeper.sweepOnce();

        assertThat(result.due()).extracting(CreditLotRepository.Lot::id).containsExactly(lot);
        assertThat(result.expired()).isEqualTo(1);
        assertThat(result.expiredCredits()).isEqualTo(500);
        assertThat(result.failed()).isZero();

        assertThat(remainingOf(lot)).isZero();
        assertThat(lots.availableCredits(USER)).isZero();

        assertThat(ledger.balanceOf(USER, Account.WALLET)).isZero();
        assertThat(ledger.balanceOf(USER, Account.COST)).isZero();
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

        assertThat(result.due()).isEmpty();
        assertThat(remainingOf(lot)).isEqualTo(500);
        assertThat(expireLegCount()).isZero();
    }

    @Test
    void 提前核销_被拒绝() {
        long lot = grant(CreditSource.GIFT, 500, FUTURE, "exp-4");
        int entriesBefore = ledgerEntryCount();

        long amount = credits.expireLot(lot);

        assertThat(amount)
                .as("未到期的批次不该被核销：核销的是「已经作废」的积分，不是「将要作废」的")
                .isZero();
        assertThat(remainingOf(lot)).isEqualTo(500);
        assertThat(ledgerEntryCount()).isEqualTo(entriesBefore);
    }


    @Test
    void 重复扫描_不二次核销() {
        long lot = grant(CreditSource.GIFT, 500, PAST, "exp-5");

        sweeper.sweepOnce();
        int entriesAfterFirst = ledgerEntryCount();

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


    @Test
    void 冻结部分不过期_解冻后下一轮再核销() {
        long jobId = 9901L;
        long lot = grant(CreditSource.GIFT, 500, FUTURE, "exp-7");
        credits.hold(USER, "cmd-exp-7", jobId, 200, CATALOG_VERSION, NO_DISCOUNT, null, "视频生成 · 过期测试");
        backdateExpiry(lot, 1);

        CreditExpirySweeper.SweepResult first = sweeper.sweepOnce();

        assertThat(first.expiredCredits()).isEqualTo(300);
        assertThat(remainingOf(lot)).isEqualTo(200);
        assertThat(frozenOf(lot)).isEqualTo(200);
        assertThat(lots.availableCredits(USER)).isZero();
        assertInvariant();

        credits.refund(jobId, "上游任务失败");
        assertThat(frozenOf(lot)).isZero();
        assertThat(remainingOf(lot)).isEqualTo(200);

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

        CreditExpirySweeper.SweepResult result = sweeper.sweepOnce();

        assertThat(result.due()).isEmpty();
        assertThat(result.expired()).isZero();
        assertThat(remainingOf(lot)).isEqualTo(500);
        assertThat(frozenOf(lot)).isEqualTo(500);
        assertInvariant();
    }


    @Test
    void 每轮都留下一行日志_无到期批次时也不例外() {
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

            assertThat(logs.text(Level.INFO))
                    .contains("lotId=" + lot)
                    .contains("userId=" + USER)
                    .contains("核销=500");
        }
    }


    private long grant(CreditSource source, long amount, Instant expiresAt, String grantKey) {
        return credits.grant(USER, source, amount, expiresAt, "grant", grantKey, grantKey);
    }

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

    private List<String> ledgerAccountsOfExpireVoucher() {
        return jdbc.queryForList(
                "SELECT DISTINCT account FROM billing_ledger_entries "
                        + "WHERE user_id = ? AND biz_type = 'expire' ORDER BY account",
                String.class, USER);
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
