package com.bluewhale.billing.application;

import com.bluewhale.billing.admin.CatalogPublisher;
import com.bluewhale.billing.infrastructure.mq.JobEventPayload;
import com.bluewhale.billing.ledger.Account;
import com.bluewhale.billing.ledger.CreditLotRepository;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.CreditSource;
import com.bluewhale.billing.ledger.HoldResult;
import com.bluewhale.billing.ledger.LedgerRepository;
import com.bluewhale.billing.ledger.Reservation;
import com.bluewhale.billing.ledger.ReservationRepository;
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

/**
 * 结算 / 返还的集成测试（《计费逻辑详细设计》§4.3 / §4.4）。
 *
 * <p>这一刀解决的是「预扣完就没人管了」——任务跑完之后钱一直冻着。
 *
 * <h2>本文件最重要的一条</h2>
 *
 * <b>结算必须用预扣时冻结的版本与折扣，不能用当前值。</b>
 * 它对应的真实场景是：用户看着「夜间 7 折」提交了任务，任务排队十几分钟；
 * 期间运营把活动停了。如果结算按当前折扣重算，用户会被按原价扣——
 * 而系统里没有任何一处能证明当时是 7 折。
 *
 * <p>所以下面有两个测试是**故意在中途改价/删活动**，再断言结算仍按老值走。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class SettlementIntegrationTest {

    private static final long USER = 9401L;
    private static final String MODEL = "seedance-2.5";
    private static final String TASK = "text2video";

    /** 单价 100000 mc → 100 积分（constant:1 基准，按次）。 */
    private static String catalog(long basePrice) {
        return """
                {"schemaVersion":1,"currency":"CNY","creditsPerYuan":15,
                 "models":{"seedance-2.5":{"text2video":{
                   "baseUnit":"constant:1","basePrice":{"kind":"const","value":%d},
                   "unitDenominator":1,"minCredits":1}}},
                 "discountPolicy":{"stackMode":"multiply","floorFactorBp":3000}}
                """.formatted(basePrice);
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

        publisher.publish(catalog(100_000), "test", "v1");
        lot = credits.grant(USER, CreditSource.GIFT, 1_000, null, "grant", "seed", "seed-1");
    }

    // ─────────────────────────────────────────────────────────────

    @Test
    void 结算_按冻结的版本复现定价_改价后仍按老版本() {
        HoldResult held = hold("cmd-1", 9_401L, "free");
        assertThat(held.reservedCredits()).isEqualTo(100);

        // ★ 中途改价：新版本 200 积分
        publisher.publish(catalog(200_000), "ops", "涨价");
        assertThat(ledger.balanceOf(USER, Account.WALLET)).isEqualTo(1_000 - 100);   // 预扣仍是老价

        settlement.settle(completedWithUsage(9_401L));

        // 结算按 job 冻结的 v1 算 → 100，不是 200
        assertThat(reservations.findByJobId(9_401L).orElseThrow().actualCredits()).isEqualTo(100L);
        assertThat(lots.availableCredits(USER)).isEqualTo(900);
    }

    @Test
    void 结算_按冻结的折扣复现_活动停掉后仍按当时折扣() {
        // 提交时是 7 折会员
        jdbc.update("INSERT INTO billing_member_discounts "
                + "(tier, model_pattern, task_pattern, discount_bp, status) "
                + "VALUES ('pro', '*', '*', 7000, 'enabled')");

        HoldResult held = hold("cmd-2", 9_402L, "pro");
        assertThat(held.reservedCredits()).isEqualTo(70);

        // ★ 提交后运营把折扣停了
        jdbc.update("DELETE FROM billing_member_discounts");

        settlement.settle(completedWithUsage(9_402L));

        // 用户看着 7 折提交的，就该按 7 折结算 —— 100 × 0.7 = 70，不是原价 100
        assertThat(reservations.findByJobId(9_402L).orElseThrow().actualCredits()).isEqualTo(70L);
    }

    @Test
    void 结算_用量为空时价与预扣相同() {
        hold("cmd-3", 9_403L, "free");
        settlement.settle(completed(9_403L));

        // 媒介类的常态：契约用量就是实际用量，差额为 0
        assertThat(lots.availableOf(lot)).isEqualTo(900);
        assertThat(remainingFrozen(lot)).isZero();
        assertInvariant();
    }

    @Test
    void 返还_全额解冻且批次有效期不被重置() {
        Instant expiresBefore = expiresOf(lot);
        hold("cmd-4", 9_404L, "free");

        settlement.refund(9_404L, "上游任务失败");

        assertThat(lots.availableOf(lot)).isEqualTo(1_000);
        assertThat(remainingFrozen(lot)).isZero();
        assertThat(expiresOf(lot)).isEqualTo(expiresBefore);
        assertThat(reservations.findByJobId(9_404L).orElseThrow().status())
                .isEqualTo(Reservation.Status.RELEASED);
        assertInvariant();
    }

    @Test
    void 重复投递_第二次是无操作() {
        hold("cmd-5", 9_405L, "free");
        settlement.settle(completed(9_405L));
        int entriesAfterFirst = ledgerEntryCount();

        // MQ 至少一次投递，重复到达是常态
        settlement.settle(completed(9_405L));
        assertThat(ledgerEntryCount()).isEqualTo(entriesAfterFirst);

        // 已结算之后再收到失败事件也不该退款 —— 钱已经花了
        settlement.refund(9_405L, "迟到的失败回调");
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

    // ─────────────────────────────────────────────────────────────

    private HoldResult hold(String commandId, long jobId, String tier) {
        return billing.hold(new HoldCommand(
                USER, commandId, jobId, MODEL, TASK, Map.of("resolution", "1080p"),
                tier, Instant.now()));
    }

    /** 完成事件；usage 为空 = worker 没有上报额外用量（媒介类的常态）。 */
    private JobEventPayload.JobCompleted completed(long jobId) {
        return new JobEventPayload.JobCompleted(jobId, USER, "succeeded", 1, 1, List.of());
    }

    /**
     * 带一条用量上报的完成事件。
     *
     * <p>⚠️ 必须有这类事件才能验「按冻结版本/折扣复现」：用量为空时
     * {@code SettlementService} 走的是「按预扣额结算」的兜底，根本不进计价引擎，
     * 于是改没改价、停没停活动都看不出来——测试会假绿。
     */
    private JobEventPayload.JobCompleted completedWithUsage(long jobId) {
        return new JobEventPayload.JobCompleted(jobId, USER, "succeeded", 1, 1,
                List.of(new JobEventPayload.UsageLine(MODEL, TASK,
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

    /** wallet + frozen == Σ remaining：账本与批次必须始终互相印证。 */
    private void assertInvariant() {
        long wallet = ledger.balanceOf(USER, Account.WALLET);
        long frozen = ledger.balanceOf(USER, Account.FROZEN);
        Long remaining = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining), 0) FROM billing_credit_lots WHERE user_id = ?",
                Long.class, USER);
        assertThat(wallet + frozen).isEqualTo(remaining);
    }
}
