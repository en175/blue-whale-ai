package com.bluewhale.billing.application;

import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.adapter.outbound.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.adapter.outbound.persistence.repository.LedgerRepository;
import com.bluewhale.billing.domain.ledger.Reservation;
import com.bluewhale.billing.adapter.outbound.persistence.repository.ReservationRepository;
import com.bluewhale.billing.testsupport.LogCapture;
import ch.qos.logback.classic.Level;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class ReservationSweeperIntegrationTest {

    private static final long USER = 9701L;
    private static final int CATALOG_VERSION = 1;
    private static final int NO_DISCOUNT = 10_000;
    private static final long GRANTED = 1_000;

    @Autowired private JdbcTemplate jdbc;
    @Autowired private CreditService credits;
    @Autowired private ReservationSweeper sweeper;
    @Autowired private ReservationRepository reservations;
    @Autowired private CreditLotRepository lots;
    @Autowired private LedgerRepository ledger;

    private long lot;

    @BeforeEach
    void setUp() {
        jdbc.update("DELETE FROM billing_ledger_entries");
        jdbc.update("DELETE FROM billing_cost_reservations");
        jdbc.update("DELETE FROM billing_credit_lots");
        lot = credits.grant(USER, CreditSource.PURCHASED, GRANTED, null,
                "grant", "sweeper-fixture", "sweeper-fixture");
    }


    @Test
    void 超过释放阈值_自动全额解冻且钱回到可用余额() {
        long jobId = 8801L;
        hold(jobId, 120);
        backdate(jobId, Duration.ofHours(30));

        ReservationSweeper.SweepResult result;
        String warns;
        try (LogCapture logs = LogCapture.of(ReservationSweeper.class)) {
            result = sweeper.sweepOnce();
            warns = logs.text(Level.WARN);
        }

        assertThat(result.stale()).extracting(ReservationRepository.StaleHold::jobId).containsExactly(jobId);
        assertThat(result.released()).as("超 24h 的那条应被释放").isEqualTo(1);
        assertThat(result.failed()).isZero();

        assertThat(warns)
                .contains("jobId=" + jobId)
                .contains("userId=" + USER)
                .contains("冻结=120")
                .contains("持有=")
                .contains("兜底");

        Reservation reservation = reservations.findByJobId(jobId).orElseThrow();
        assertThat(reservation.status()).isEqualTo(Reservation.Status.RELEASED);
        assertThat(reservation.releaseNote())
                .as("兜底释放必须留痕：否则事后无法解释「这笔钱是谁放回去的」")
                .contains("兜底");

        assertThat(frozenOf(lot)).isZero();
        assertThat(remainingOf(lot)).isEqualTo(GRANTED);
        assertThat(lots.availableCredits(USER)).isEqualTo(GRANTED);

        assertThat(voucherLegs("refund:" + jobId + ":%")).isEqualTo(2);
        assertInvariant();
    }

    @Test
    void 重复扫描_不会二次退款() {
        long jobId = 8802L;
        hold(jobId, 120);
        backdate(jobId, Duration.ofHours(30));

        sweeper.sweepOnce();
        int entriesAfterFirst = ledgerEntryCount();

        ReservationSweeper.SweepResult second = sweeper.sweepOnce();

        assertThat(second.released()).as("已经是 released 的预留不再是 held，扫不到了").isZero();
        assertThat(second.stale()).isEmpty();
        assertThat(ledgerEntryCount())
                .as("没有第二条 refund 凭证 —— 同一笔钱退了两次")
                .isEqualTo(entriesAfterFirst);
        assertThat(frozenOf(lot)).isZero();
        assertThat(lots.availableCredits(USER)).isEqualTo(GRANTED);
        assertInvariant();
    }


    @Test
    void 超过告警阈值但未到释放阈值_只告警不动钱() {
        long jobId = 8803L;
        hold(jobId, 120);
        backdate(jobId, Duration.ofHours(2));

        ReservationSweeper.SweepResult result;
        String warns;
        try (LogCapture logs = LogCapture.of(ReservationSweeper.class)) {
            result = sweeper.sweepOnce();
            warns = logs.text(Level.WARN);
        }

        assertThat(result.stale()).extracting(ReservationRepository.StaleHold::jobId).containsExactly(jobId);
        ReservationRepository.StaleHold stale = result.stale().get(0);
        assertThat(stale.reservedCredits()).isEqualTo(120);
        assertThat(stale.heldSeconds()).isGreaterThanOrEqualTo(Duration.ofHours(2).getSeconds() - 5);
        assertThat(warns)
                .as("这一档的全部价值就是「让人看见」——没有日志等于没有这一档")
                .contains("jobId=" + jobId)
                .contains("冻结=120")
                .contains("持有=")
                .doesNotContain("预留兜底释放");

        assertThat(result.released()).isZero();
        assertThat(reservations.findByJobId(jobId).orElseThrow().status())
                .isEqualTo(Reservation.Status.HELD);
        assertThat(frozenOf(lot)).isEqualTo(120);
        assertThat(lots.availableCredits(USER)).isEqualTo(GRANTED - 120);
        assertThat(refundVoucherCount()).isZero();
        assertInvariant();
    }

    @Test
    void 未超告警阈值_完全不进入视野() {
        long jobId = 8804L;
        hold(jobId, 120);

        ReservationSweeper.SweepResult result = sweeper.sweepOnce();

        assertThat(result.stale()).isEmpty();
        assertThat(result.released()).isZero();
        assertThat(reservations.findByJobId(jobId).orElseThrow().status())
                .isEqualTo(Reservation.Status.HELD);
        assertThat(frozenOf(lot)).isEqualTo(120);
        assertThat(refundVoucherCount()).isZero();
    }


    @Test
    void 同时存在两条超时_只释放超过释放阈值的那条() {
        long ancient = 8805L;
        long recent = 8806L;
        hold(ancient, 120);
        hold(recent, 80);
        backdate(ancient, Duration.ofHours(30));
        backdate(recent, Duration.ofHours(2));

        ReservationSweeper.SweepResult result = sweeper.sweepOnce();

        assertThat(result.stale()).extracting(ReservationRepository.StaleHold::jobId)
                .containsExactlyInAnyOrder(ancient, recent);
        assertThat(result.released()).isEqualTo(1);

        assertThat(reservations.findByJobId(ancient).orElseThrow().status())
                .isEqualTo(Reservation.Status.RELEASED);
        assertThat(reservations.findByJobId(recent).orElseThrow().status())
                .as("2 小时的那条只该被看见，不该被动")
                .isEqualTo(Reservation.Status.HELD);

        assertThat(frozenOf(lot)).isEqualTo(80);
        assertThat(lots.availableCredits(USER)).isEqualTo(GRANTED - 80);
        assertInvariant();
    }


    @Test
    void 释放阈值不晚于告警阈值_启动即失败() {
        assertThatThrownBy(() -> new ReservationSweeper(reservations, credits,
                Duration.ofHours(2), Duration.ofHours(2), true, 10, 10))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("释放阈值");

        assertThatThrownBy(() -> new ReservationSweeper(reservations, credits,
                Duration.ofHours(2), Duration.ofHours(1), true, 10, 10))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("释放阈值");
    }


    private void hold(long jobId, long amount) {
        credits.hold(USER, "cmd-" + jobId, jobId, amount, CATALOG_VERSION, NO_DISCOUNT,
                null, "视频生成 · 兜底测试");
    }

    private void backdate(long jobId, Duration ago) {
        jdbc.update("UPDATE billing_cost_reservations "
                        + "SET gmt_modified = NOW() - INTERVAL ? SECOND "
                        + "WHERE generation_job_id = ?",
                ago.getSeconds(), jobId);
    }

    private long frozenOf(long lotId) {
        return jdbc.queryForObject("SELECT frozen FROM billing_credit_lots WHERE id = ?", Long.class, lotId);
    }

    private long remainingOf(long lotId) {
        return jdbc.queryForObject("SELECT remaining FROM billing_credit_lots WHERE id = ?", Long.class, lotId);
    }

    private int refundVoucherCount() {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_ledger_entries WHERE idempotency_key LIKE 'refund:%'",
                Integer.class);
        return count == null ? 0 : count;
    }

    private int voucherLegs(String idempotencyKeyPattern) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_ledger_entries WHERE idempotency_key LIKE ?",
                Integer.class, idempotencyKeyPattern);
        return count == null ? 0 : count;
    }

    private int ledgerEntryCount() {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_ledger_entries", Integer.class);
        return count == null ? 0 : count;
    }

    private void assertInvariant() {
        Long remaining = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining), 0) FROM billing_credit_lots WHERE user_id = ?",
                Long.class, USER);
        long wallet = ledger.balanceOf(USER, Account.WALLET);
        long frozen = ledger.balanceOf(USER, Account.FROZEN);
        assertThat(wallet + frozen)
                .as("释放是「冻结 → 可用」的搬运，不得改变两侧合计（wallet=%s frozen=%s）", wallet, frozen)
                .isEqualTo(remaining);
    }
}
