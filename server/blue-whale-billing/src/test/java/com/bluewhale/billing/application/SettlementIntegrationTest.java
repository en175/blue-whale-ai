package com.bluewhale.billing.application;

import com.bluewhale.billing.application.command.HoldCommand;
import com.bluewhale.billing.application.command.SettlementCommand;
import com.bluewhale.billing.application.command.SettlementUsageLine;
import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.adapter.outbound.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.domain.ledger.HoldResult;
import com.bluewhale.billing.adapter.outbound.persistence.repository.LedgerRepository;
import com.bluewhale.billing.domain.ledger.Reservation;
import com.bluewhale.billing.adapter.outbound.persistence.repository.ReservationRepository;
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

/**
 * 结算 / 返还的集成测试（《计费逻辑详细设计》§4.3 / §4.4）。
 *
 * <p>这一刀解决的是「预扣完就没人管了」——任务跑完之后钱一直冻着。
 *
 * <h2>本文件最重要的一条</h2>
 *
 * <b>结算必须用预扣时冻结的规则与折扣，不能用当前值。</b>
 * 它对应的真实场景是：用户看着「夜间 7 折」提交了任务，任务排队十几分钟；
 * 期间运营把活动停了。如果结算按当前折扣重算，用户会被按原价扣——
 * 而系统里没有任何一处能证明当时是 7 折。
 *
 * <p>所以下面有两个测试是**故意在中途改配置/删活动**，再断言结算仍按老值走。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class SettlementIntegrationTest {

    private static final long USER = 9401L;
    private static final String MODEL = "seedance-2.5";
    private static final String TASK = "text2video";

    /**
     * 目录：只有换算率与折扣策略。
     *
     * <p>⚠️ 规则**不在目录里**——它随每次 Hold 请求作为快照送来，冻进预留行。
     */
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

    // ─────────────────────────────────────────────────────────────

    @Test
    void 结算_按预留行冻结的快照复现_每条预留各按各的规则() {
        // 两条预热扣：同一个模型、同一个任务，但**冻结的规则不同**。
        // 这模拟的是「能力行里的价在两次提交之间被改过」——改价不该影响已提交的那一笔。
        HoldResult 老单 = hold("cmd-1", 9_401L, "free", ruleSnapshot(100_000L));
        HoldResult 新单 = hold("cmd-2", 9_402L, "free", ruleSnapshot(200_000L));
        assertThat(老单.reservedCredits()).isEqualTo(100);
        assertThat(新单.reservedCredits()).isEqualTo(200);

        settlement.settle(completedWithUsage(9_401L));
        settlement.settle(completedWithUsage(9_402L));

        // ★ 各自按自己那份快照结算 —— 100 与 200，而不是「都按当前配置」。
        //   若这里读到同一个数，说明它没在读预留行上冻的那份规则。
        assertThat(reservations.findByJobId(9_401L).orElseThrow().actualCredits()).isEqualTo(100L);
        assertThat(reservations.findByJobId(9_402L).orElseThrow().actualCredits()).isEqualTo(200L);
        assertThat(lots.availableCredits(USER)).isEqualTo(700);
    }

    @Test
    void 结算_按冻结的折扣复现_活动停掉后仍按当时折扣() {
        // 提交时是 7 折会员
        jdbc.update("INSERT INTO billing_member_discounts "
                + "(tier, model_pattern, task_pattern, discount_bp, status) "
                + "VALUES ('pro', '*', '*', 7000, 'enabled')");

        HoldResult held = hold("cmd-2", 9_403L, "pro", ruleSnapshot(100_000L));
        assertThat(held.reservedCredits()).isEqualTo(70);

        // ★ 提交后运营把折扣停了
        jdbc.update("DELETE FROM billing_member_discounts");

        settlement.settle(completedWithUsage(9_403L));

        // 用户看着 7 折提交的，就该按 7 折结算 —— 100 × 0.7 = 70，不是原价 100
        assertThat(reservations.findByJobId(9_403L).orElseThrow().actualCredits()).isEqualTo(70L);
    }

    // ─────────────────────────────────────────────────────────────
    // 规则从哪来：只有预留行上的快照（没有回落）
    // ─────────────────────────────────────────────────────────────

    @Test
    void 不带快照_预扣就拒绝_不建预留() {
        // 规则住在能力行、billing 读不到那个库：没有快照就算不出价。
        // 拒在**预扣**这一步——用户还没提交成功，比结不出账早得多。
        assertThatThrownBy(() -> hold("cmd-nosnap", 9_411L, "free", ""))
                .isInstanceOf(CatalogCompiler.CompileException.class)
                .hasMessageContaining("规则快照");

        assertThat(reservations.findByJobId(9_411L)).isEmpty();
        assertThat(lots.availableCredits(USER)).isEqualTo(1_000);
    }

    @Test
    void 老预留_预留行没有快照_结算抛出去重投() {
        hold("cmd-nosnap-2", 9_412L, "free", ruleSnapshot(100_000L));
        // 模拟「本次改动之前提交、预留行上压根没有快照」的行
        jdbc.update("UPDATE billing_cost_reservations SET rule_snapshot = NULL "
                + "WHERE generation_job_id = ?", 9_412L);

        // ★ 没有快照 = 算不出价：抛出去让 MQ 重投 → 死信 → 有人看得见。
        //   既不按 0 结算，也不拿预扣额蒙（那是预估的上限，不是成交价）。
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
        // 把预留行上的快照换成一编不过的（缺 baseUnit）——模拟数据损坏。
        // 若这里静默放过，这次结算会按别的价静默成交，谁都看不出用的是别的规则
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

        // 用量为空的降级路径：worker 报不出 model_id 时才会走到（见 SettlementService#settle）。
        // 此时按预扣额结算——规则本身就是按次计价（constant:1），差额为 0
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

        // MQ 至少一次投递，重复到达是常态
        settlement.settle(completed(9_406L));
        assertThat(ledgerEntryCount()).isEqualTo(entriesAfterFirst);

        // 已结算之后再收到失败事件也不该退款 —— 钱已经花了
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

    // ─────────────────────────────────────────────────────────────

    /**
     * 预扣一次。
     *
     * @param ruleSnapshot 规则快照（JSON 文本）—— 规则的**唯一**来源；空串会被拒
     */
    private HoldResult hold(String commandId, long jobId, String tier, String ruleSnapshot) {
        return billing.hold(new HoldCommand(
                USER, commandId, jobId, MODEL, TASK, Map.of("resolution", "1080p"),
                tier, "视频生成 · 测试", Instant.now(), ruleSnapshot));
    }

    /**
     * 规则快照的 JSON 文本 —— **手写字面量**，与 backend 能力行送来的那串同形
     * （能力行的 {@code generation_model_capability.pricing} 列）。
     */
    private static String ruleSnapshot(long basePrice) {
        return """
                {"baseUnit":"constant:1","basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":1}
                """.formatted(basePrice);
    }

    /** 完成事件；usage 为空 = worker 报不出用量（降级路径，见 SettlementService#settle）。 */
    private SettlementCommand completed(long jobId) {
        return new SettlementCommand(jobId, USER, "succeeded", 1, 1, List.of());
    }

    /**
     * 带一条用量上报的完成事件。
     *
     * <p>⚠️ 必须有这类事件才能验「按冻结的规则/折扣复现」：用量为空时
     * {@code SettlementService} 走的是「按预扣额结算」的兜底，根本不进计价引擎，
     * 于是改没改价、停没停活动都看不出来——测试会假绿。
     */
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
