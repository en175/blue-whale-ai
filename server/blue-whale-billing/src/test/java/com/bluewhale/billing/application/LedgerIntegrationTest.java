package com.bluewhale.billing.application;

import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.LedgerRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.ReservationRepository;
import com.bluewhale.billing.application.view.BalanceView;
import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.domain.ledger.Allocation;
import com.bluewhale.billing.domain.ledger.ChargeResult;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.domain.ledger.InsufficientCreditsException;
import com.bluewhale.billing.domain.ledger.Reservation;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

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
    void 扣款_先耗尽快到期的批次() {
        long daily = grant(CreditSource.DAILY, 100, SOON, "d1");
        long purchased = grant(CreditSource.PURCHASED, 1_000, null, "p1");

        credits.charge(USER, "cmd-1", JOB, 120, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(remainingOf(daily)).isZero();
        assertThat(remainingOf(purchased)).isEqualTo(980);

        var allocation = reservations.findByJobId(JOB).orElseThrow().allocations();
        assertThat(allocation).extracting(Allocation::lotId).containsExactly(daily, purchased);
        assertInvariant();
    }

    @Test
    void 扣款_同为永久时按来源优先级_先扣赠送后扣付费() {
        long gift = grant(CreditSource.GIFT, 100, null, "g1");
        long purchased = grant(CreditSource.PURCHASED, 1_000, null, "p2");

        credits.charge(USER, "cmd-2", JOB, 60, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(remainingOf(gift)).isEqualTo(40);
        assertThat(remainingOf(purchased)).isEqualTo(1_000);
        assertInvariant();
    }

    @Test
    void 扣款_已过期批次不参与_且不留下任何痕迹() {
        long expired = grant(CreditSource.DAILY, 100, PAST, "e1");
        long purchased = grant(CreditSource.PURCHASED, 100, null, "p3");

        credits.charge(USER, "cmd-3", JOB, 60, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(remainingOf(expired)).isEqualTo(100);
        assertThat(remainingOf(purchased)).isEqualTo(40);
        assertThat(lots.availableCredits(USER)).isEqualTo(40);
        assertInvariant();
    }


    @Test
    void 扣款_直接从批次剩余里扣减() {
        long lot = grant(CreditSource.GIFT, 100, null, "g2");

        credits.charge(USER, "cmd-4", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(remainingOf(lot)).isEqualTo(60);
        assertThat(lots.availableCredits(USER)).isEqualTo(60);
        assertInvariant();
    }

    @Test
    void 扣款_余额不足_抛异常且不留痕迹() {
        grant(CreditSource.GIFT, 10, null, "g3");

        assertThatThrownBy(() -> credits.charge(USER, "cmd-5", JOB, 11, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE))
                .isInstanceOf(InsufficientCreditsException.class)
                .hasMessageContaining("还差 1");

        assertThat(lots.availableCredits(USER)).isEqualTo(10);
        assertThat(reservations.findByJobId(JOB)).isEmpty();
        assertThat(ledgerEntryCount()).isEqualTo(2);
        assertInvariant();
    }

    @Test
    void 扣款_幂等_同一个任务重复投递不二次扣款() {
        long lot = grant(CreditSource.GIFT, 100, null, "g4");

        ChargeResult first = credits.charge(USER, "cmd-6", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        ChargeResult second = credits.charge(USER, "cmd-6-retry", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(first.duplicated()).isFalse();
        assertThat(second.duplicated()).isTrue();
        assertThat(second.chargedCredits()).isEqualTo(first.chargedCredits());
        assertThat(second.catalogVersion()).isEqualTo(first.catalogVersion());

        assertThat(remainingOf(lot)).isEqualTo(60);
        assertThat(ledgerEntryCount()).isEqualTo(4);
        assertInvariant();
    }


    @Test
    void 扣款_同用户并发_批次行锁串行化_不会透支() throws Exception {
        long lot = grant(CreditSource.GIFT, 10, null, "g-concurrent");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CyclicBarrier barrier = new CyclicBarrier(2);
        try {
            List<Future<Boolean>> results = new ArrayList<>();
            for (long jobId : new long[]{601L, 602L}) {
                results.add(pool.submit(() -> {
                    barrier.await(10, TimeUnit.SECONDS);
                    try {
                        credits.charge(USER, "cmd-concurrent-" + jobId, jobId, 8,
                                CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
                        return true;
                    } catch (InsufficientCreditsException error) {
                        return false;
                    }
                }));
            }
            long succeeded = 0;
            for (Future<Boolean> result : results) {
                if (result.get(30, TimeUnit.SECONDS)) {
                    succeeded++;
                }
            }
            assertThat(succeeded)
                    .as("同一用户两笔并发扣费只能成功一笔")
                    .isEqualTo(1);
            assertThat(remainingOf(lot)).isEqualTo(2);
            assertInvariant();
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void 返还_没有扣款记录的任务_无操作() {
        credits.refund(999_001L, "免费任务入队失败");

        assertThat(reservations.findByJobId(999_001L)).isEmpty();
        assertThat(ledgerEntryCount()).isZero();
    }

    @Test
    void 返还_把扣掉的量还回原批次_有效期不被重置() {
        long lot = grant(CreditSource.DAILY, 100, LATER, "g7");
        LocalDateTime expiresBefore = expiresOf(lot);

        credits.charge(USER, "cmd-9", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        credits.refund(JOB, "上游任务失败");

        assertThat(remainingOf(lot)).isEqualTo(100);
        assertThat(expiresOf(lot)).isEqualTo(expiresBefore);

        var reservation = reservations.findByJobId(JOB).orElseThrow();
        assertThat(reservation.status()).isEqualTo(Reservation.Status.REFUNDED);
        assertThat(reservation.releaseNote()).isEqualTo("上游任务失败");
        assertInvariant();
        assertEveryVoucherBalanced();
    }

    @Test
    void 返还之后再次返还_无操作() {
        long lot = grant(CreditSource.GIFT, 100, null, "g8");
        credits.charge(USER, "cmd-10", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        credits.refund(JOB, "上游任务失败");
        int entriesAfterRefund = ledgerEntryCount();

        credits.refund(JOB, "迟到的失败回调");

        assertThat(ledgerEntryCount()).isEqualTo(entriesAfterRefund);
        assertThat(remainingOf(lot)).isEqualTo(100);
        assertThat(reservations.findByJobId(JOB).orElseThrow().status())
                .isEqualTo(Reservation.Status.REFUNDED);
        assertInvariant();
    }

    @Test
    void 跨来源批次_收入与成本分别记账() {
        long gift = grant(CreditSource.GIFT, 20, null, "g6");
        long purchased = grant(CreditSource.PURCHASED, 100, null, "p4");

        credits.charge(USER, "cmd-8", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(remainingOf(gift)).isZero();
        assertThat(remainingOf(purchased)).isEqualTo(80);

        assertThat(ledger.balanceOf(USER, Account.COST)).isEqualTo(100);
        assertThat(ledger.balanceOf(USER, Account.REVENUE)).isEqualTo(20);

        var accounts = ledgerAccountsOfVoucher("charge:" + JOB);
        assertThat(accounts).containsExactlyInAnyOrder("wallet", "cost", "revenue");
        assertInvariant();
        assertEveryVoucherBalanced();
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

        credits.charge(USER, "cmd-tz", JOB, 60, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(remainingOf(expiring)).isEqualTo(40);
        assertThat(remainingOf(expired)).isEqualTo(100);
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
        assertThat(wallet)
                .as("账本 wallet(%s) 应等于 Σ remaining", wallet)
                .isEqualTo(totalRemaining());
        assertThat(lots.availableCredits(USER) + expiredAvailable())
                .as("未过期可用 + 已过期未核销 应等于账本 wallet(%s)", wallet)
                .isEqualTo(wallet);
    }

    private long expiredAvailable() {
        Long sum = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining), 0) FROM billing_credit_lots "
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

    private long remainingOf(long lotId) {
        return jdbc.queryForObject(
                "SELECT remaining FROM billing_credit_lots WHERE id = ?", Long.class, lotId);
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
