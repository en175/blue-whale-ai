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

/**
 * 预留兜底的真库集成测试（《计费逻辑详细设计》§9 层次②）。
 *
 * <p>为什么必须真库跑：这一层的全部行为都落在**三张表的最终状态**上——
 * 预留改为 released、批次 frozen 归零、账本落一条 {@code refund:} 凭证。
 * mock 掉 Repository 就等于把被测对象换成自己的期望，测试只会复述实现。
 *
 * <p>门控同其它集成测试：设置 {@code BILLING_DB_PASSWORD} 才跑；
 * {@code BillingTestDatabaseGate} 另外保证它只落在 {@code bw_billing_test*} 上。
 *
 * <h2>阈值来自默认值（2h 告警 / 24h 释放）</h2>
 *
 * 本文件不覆盖配置，用的是 application.yml 的默认值——这是**故意的**：
 * 默认值就是线上要跑的那套策略，测它才有意义。改了默认值，
 * 下面几条用例会立刻告诉你「策略变了，来确认一遍」。
 *
 * <h2>定时入口怎么测</h2>
 *
 * 测试直接调 {@link ReservationSweeper#sweepOnce()}，它是 {@code @Scheduled} 入口
 * 调用的**同一个方法**（见 {@code sweep()}）。测试线程里没有调度器，
 * 也就不存在「后台把我造的夹具先处理掉」这种看运气的失败——
 * 测试配置把首次执行推到了 24 小时后（见 {@code src/test/resources/application.properties}）。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class ReservationSweeperIntegrationTest {

    private static final long USER = 9701L;
    /** 目录版本与折扣：本测试考的是兜底释放，不考计价，给一组合法值即可。 */
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

    // ─────────────────────────────────────────────────────────────
    // 超释放阈值：自动释放
    // ─────────────────────────────────────────────────────────────

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

        // ④ ★ 日志是这条路径唯一的可观测面（它改的是数据，但「为什么改」只在日志里）。
        //    WARN 必须能回答：几条、谁的、冻了多少、冻了多久 —— 否则接手的人得再查一遍库
        assertThat(warns)
                .contains("jobId=" + jobId)
                .contains("userId=" + USER)
                .contains("冻结=120")
                .contains("持有=")
                .contains("兜底");

        // ① 预留终态：released，且原因能让人一眼区分「兜底释放」与「任务失败返还」
        Reservation reservation = reservations.findByJobId(jobId).orElseThrow();
        assertThat(reservation.status()).isEqualTo(Reservation.Status.RELEASED);
        assertThat(reservation.releaseNote())
                .as("兜底释放必须留痕：否则事后无法解释「这笔钱是谁放回去的」")
                .contains("兜底");

        // ② 批次：只解冻、不动 remaining —— 与失败返还是同一条路径
        assertThat(frozenOf(lot)).isZero();
        assertThat(remainingOf(lot)).isEqualTo(GRANTED);
        assertThat(lots.availableCredits(USER)).isEqualTo(GRANTED);

        // ③ 账本：走了既有的幂等返还凭证（refund:{jobId} 的两条腿）
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

        // ★ 兜底扫描每 10 分钟一轮，与 MQ 回调、与自身的历史轮次都会重叠——
        //   「重复执行安全」不是加分项，是这条路径能不能上线的前提。
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

    // ─────────────────────────────────────────────────────────────
    // 超告警阈值但未到释放阈值：只报不动
    // ─────────────────────────────────────────────────────────────

    @Test
    void 超过告警阈值但未到释放阈值_只告警不动钱() {
        long jobId = 8803L;
        hold(jobId, 120);
        // ⚠️ 取 2h：必须**落在两条阈值之间**（默认 warn=1h、release=3h）。
        //    改任一条阈值时这条夹具要跟着挪，否则它会以「钱被释放了」的形式红
        //    ——那是好事（说明有人动过阈值），但别把它当偶发。
        backdate(jobId, Duration.ofHours(2));

        ReservationSweeper.SweepResult result;
        String warns;
        try (LogCapture logs = LogCapture.of(ReservationSweeper.class)) {
            result = sweeper.sweepOnce();
            warns = logs.text(Level.WARN);
        }

        // 看得见：进入告警窗口，且能报出冻结额与持有秒数（人能拿它去查这笔任务）
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

        // 不动钱：这一档的意义就是「先让人看一眼」，自动动作留在 24h 那一档
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

    // ─────────────────────────────────────────────────────────────
    // 两档混在一起：只动该动的那条
    // ─────────────────────────────────────────────────────────────

    @Test
    void 同时存在两条超时_只释放超过释放阈值的那条() {
        long ancient = 8805L;
        long recent = 8806L;
        hold(ancient, 120);
        hold(recent, 80);
        backdate(ancient, Duration.ofHours(30));
        // ⚠️ 取 2h：必须落在两条阈值**之间**（默认 warn=1h、release=3h）。
        //    取在释放线之上时这条测试会以「两条都被释放」的形式红。
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

        // 冻结额：120 已解冻，80 仍冻着 → 可用 = 1000 - 80
        assertThat(frozenOf(lot)).isEqualTo(80);
        assertThat(lots.availableCredits(USER)).isEqualTo(GRANTED - 80);
        assertInvariant();
    }

    // ─────────────────────────────────────────────────────────────
    // 配置守卫
    // ─────────────────────────────────────────────────────────────

    @Test
    void 释放阈值不晚于告警阈值_启动即失败() {
        // 若允许 release <= warn，「先告警、后释放」两档退化成同一档：钱在被看见之前就动了。
        // 这种错配置必须当场炸，而不是悄悄按错误策略跑一整年
        assertThatThrownBy(() -> new ReservationSweeper(reservations, credits,
                Duration.ofHours(2), Duration.ofHours(2), true, 10, 10))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("释放阈值");

        assertThatThrownBy(() -> new ReservationSweeper(reservations, credits,
                Duration.ofHours(2), Duration.ofHours(1), true, 10, 10))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("释放阈值");
    }

    // ─────────────────────────────────────────────────────────────
    // 夹具与断言工具
    // ─────────────────────────────────────────────────────────────

    /** 走真实的预扣路径造一条 held 预留（这样冻结与账本都是真的）。 */
    private void hold(long jobId, long amount) {
        credits.hold(USER, "cmd-" + jobId, jobId, amount, CATALOG_VERSION, NO_DISCOUNT,
                null, "视频生成 · 兜底测试");
    }

    /**
     * 把预留「拨老」。
     *
     * <p>只有这一条路能造出超时样本：{@code gmt_modified} 由 MySQL 在预扣时写死，
     * 测试不能等 24 小时。显式赋值会**覆盖** {@code ON UPDATE CURRENT_TIMESTAMP}
     * 的自动行为（自动行为只在语句没显式写这一列时生效），所以这个 UPDATE 生效。
     *
     * <p>用 {@code INTERVAL ? SECOND} 而不是 Java 算好的时间点：兜底扫描判的是
     * 库里的墙钟，夹具也必须拨库里的那一列。
     */
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

    /** 恒等式：wallet + frozen == Σ lots.remaining（同 LedgerIntegrationTest 的口径）。 */
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
