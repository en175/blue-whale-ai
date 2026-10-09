package com.bluewhale.billing.application;

import com.bluewhale.billing.application.command.HoldCommand;
import com.bluewhale.billing.application.command.SettlementCommand;
import com.bluewhale.billing.application.command.SettlementUsageLine;
import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.domain.ledger.HoldResult;
import com.bluewhale.billing.infrastructure.persistence.repository.LedgerRepository;
import com.bluewhale.billing.domain.ledger.Reservation;
import com.bluewhale.billing.infrastructure.persistence.repository.ReservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class SettlementIntegrationTest {

    private static final long USER = 9401L;
    private static final String MODEL = "seedance-2.5";
    private static final String TASK = "text2video";

    private static String catalog() {
        return """
                {"schemaVersion":1,"currency":"CNY","creditsPerYuan":15,
                 "discountPolicy":{"stackMode":"multiply","floorFactorBp":3000}}
                """;
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private CatalogPublisher publisher;
    @Autowired private BillingApplicationService billing;
    @Autowired private SettlementService settlement;
    @Autowired private CreditService credits;
    @Autowired private CreditLotRepository lots;
    @Autowired private LedgerRepository ledger;
    @Autowired private ReservationRepository reservations;

    private long lot;

    @BeforeEach
    void setUp() {
        jdbc.update("DELETE FROM billing_ledger_entries");
        jdbc.update("DELETE FROM billing_cost_reservations");
        jdbc.update("DELETE FROM billing_credit_lots");
        jdbc.update("DELETE FROM billing_member_discounts");
        jdbc.update("DELETE FROM billing_promotions");
        jdbc.update("DELETE FROM billing_pricing_catalogs");

        publisher.publish(catalog(), "test", "v1");
        lot = credits.grant(USER, CreditSource.GIFT, 1_000, null, "grant", "seed", "seed-1");
    }


    @Test
    void 结算_按预留行冻结的快照复现_每条预留各按各的规则() {
        HoldResult 老单 = hold("cmd-1", 9_401L, "free", ruleSnapshot(100_000L));
        HoldResult 新单 = hold("cmd-2", 9_402L, "free", ruleSnapshot(200_000L));
        assertThat(老单.reservedCredits()).isEqualTo(100);
        assertThat(新单.reservedCredits()).isEqualTo(200);

        settlement.settle(completedWithUsage(9_401L));
        settlement.settle(completedWithUsage(9_402L));

        assertThat(reservations.findByJobId(9_401L).orElseThrow().actualCredits()).isEqualTo(100L);
        assertThat(reservations.findByJobId(9_402L).orElseThrow().actualCredits()).isEqualTo(200L);
        assertThat(lots.availableCredits(USER)).isEqualTo(700);
    }

    @Test
    void 结算_按冻结的折扣复现_活动停掉后仍按当时折扣() {
        jdbc.update("INSERT INTO billing_member_discounts "
                + "(tier, model_pattern, task_pattern, discount_bp, status) "
                + "VALUES ('pro', '*', '*', 7000, 'enabled')");

        HoldResult held = hold("cmd-2", 9_403L, "pro", ruleSnapshot(100_000L));
        assertThat(held.reservedCredits()).isEqualTo(70);

        jdbc.update("DELETE FROM billing_member_discounts");

        settlement.settle(completedWithUsage(9_403L));

        assertThat(reservations.findByJobId(9_403L).orElseThrow().actualCredits()).isEqualTo(70L);
    }


    @Test
    void 不带快照_预扣就拒绝_不建预留() {
        assertThatThrownBy(() -> hold("cmd-nosnap", 9_411L, "free", ""))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("规则快照");

        assertThat(reservations.findByJobId(9_411L)).isEmpty();
        assertThat(lots.availableCredits(USER)).isEqualTo(1_000);
    }

    @Test
    void 老预留_预留行没有快照_结算抛出去重投() {
        hold("cmd-nosnap-2", 9_412L, "free", ruleSnapshot(100_000L));
        jdbc.update("UPDATE billing_cost_reservations SET rule_snapshot = NULL "
                + "WHERE generation_job_id = ?", 9_412L);

        assertThatThrownBy(() -> settlement.settle(completedWithUsage(9_412L)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("规则快照");

        assertThat(reservations.findByJobId(9_412L).orElseThrow().status())
                .isEqualTo(Reservation.Status.HELD);
        assertThat(lots.availableCredits(USER)).isEqualTo(900);
    }

    @Test
    void 预留行快照编不过_抛出去重投而不是按0结算() {
        hold("cmd-bad", 9_413L, "free", ruleSnapshot(100_000L));
        jdbc.update("UPDATE billing_cost_reservations SET rule_snapshot = ? WHERE generation_job_id = ?",
                "{\"basePrice\":{\"kind\":\"const\",\"value\":100000}}", 9_413L);

        assertThatThrownBy(() -> settlement.settle(completedWithUsage(9_413L)))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("baseUnit");

        assertThat(reservations.findByJobId(9_413L).orElseThrow().status())
                .isEqualTo(Reservation.Status.HELD);
    }

    @Test
    void 结算_用量为空时价与预扣相同() {
        hold("cmd-3", 9_404L, "free", ruleSnapshot(100_000L));
        settlement.settle(completed(9_404L));

        assertThat(lots.availableOf(lot)).isEqualTo(900);
        assertThat(remainingFrozen(lot)).isZero();
        assertInvariant();
    }

    @Test
    void 返还_全额解冻且批次有效期不被重置() {
        Instant expiresBefore = expiresOf(lot);
        hold("cmd-4", 9_405L, "free", ruleSnapshot(100_000L));

        settlement.refund(9_405L, "上游任务失败");

        assertThat(lots.availableOf(lot)).isEqualTo(1_000);
        assertThat(remainingFrozen(lot)).isZero();
        assertThat(expiresOf(lot)).isEqualTo(expiresBefore);
        assertThat(reservations.findByJobId(9_405L).orElseThrow().status())
                .isEqualTo(Reservation.Status.RELEASED);
        assertInvariant();
    }

    @Test
    void 重复投递_第二次是无操作() {
        hold("cmd-5", 9_406L, "free", ruleSnapshot(100_000L));
        settlement.settle(completed(9_406L));
        int entriesAfterFirst = ledgerEntryCount();

        settlement.settle(completed(9_406L));
        assertThat(ledgerEntryCount()).isEqualTo(entriesAfterFirst);

        settlement.refund(9_406L, "迟到的失败回调");
        assertThat(ledgerEntryCount()).isEqualTo(entriesAfterFirst);
        assertThat(lots.availableCredits(USER)).isEqualTo(900);
    }

    @Test
    void 没走过预扣的任务_结算与返还都是无操作() {
        settlement.settle(completed(9_499L));
        settlement.refund(9_499L, "随便");

        assertThat(reservations.findByJobId(9_499L)).isEmpty();
        assertThat(lots.availableCredits(USER)).isEqualTo(1_000);
    }


    private HoldResult hold(String commandId, long jobId, String tier, String ruleSnapshot) {
        return billing.hold(new HoldCommand(
                USER, commandId, jobId, MODEL, TASK, Map.of("resolution", "1080p"),
                tier, "视频生成 · 测试", Instant.now(), ruleSnapshot));
    }

    private static String ruleSnapshot(long basePrice) {
        return """
                {"baseUnit":"constant:1","basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":1}
                """.formatted(basePrice);
    }

    private SettlementCommand completed(long jobId) {
        return new SettlementCommand(jobId, USER, "succeeded", 1, 1, List.of());
    }

    private SettlementCommand completedWithUsage(long jobId) {
        return new SettlementCommand(jobId, USER, "succeeded", 1, 1,
                List.of(new SettlementUsageLine(MODEL, TASK,
                        Map.of(), Map.of("resolution", "1080p"))));
    }

    private long remainingFrozen(long lotId) {
        return jdbc.queryForObject(
                "SELECT frozen FROM billing_credit_lots WHERE id = ?", Long.class, lotId);
    }

    private Instant expiresOf(long lotId) {
        var ts = jdbc.queryForObject(
                "SELECT expires_at FROM billing_credit_lots WHERE id = ?",
                java.sql.Timestamp.class, lotId);
        return ts == null ? null : ts.toInstant();
    }

    private int ledgerEntryCount() {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_ledger_entries WHERE user_id = ?", Integer.class, USER);
        return count == null ? 0 : count;
    }

    private void assertInvariant() {
        long wallet = ledger.balanceOf(USER, Account.WALLET);
        long frozen = ledger.balanceOf(USER, Account.FROZEN);
        Long remaining = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining), 0) FROM billing_credit_lots WHERE user_id = ?",
                Long.class, USER);
        assertThat(wallet + frozen).isEqualTo(remaining);
    }
}
