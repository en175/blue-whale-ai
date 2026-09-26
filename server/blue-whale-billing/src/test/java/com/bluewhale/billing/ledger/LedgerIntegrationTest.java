package com.bluewhale.billing.ledger;

import ch.qos.logback.classic.Level;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 积分账户与账本的**真库集成测试**（《计费逻辑详细设计》§4.2 – §4.4 /《测试策略》I1–I10）。
 *
 * <p>为什么必须真库跑，而不是 mock 掉 Repository：本切片的全部价值都在**跨表的不变量**上——
 * 「冻结没扣 remaining」「结算只扣实际」「返还后有效期没变」。这些性质由 SQL 的
 * {@code FOR UPDATE}、{@code CHECK} 约束与语句本身的语义共同保证，mock 一层就等于
 * 把被测对象换成自己的期望，测试只会复述实现。
 *
 * <p>门控同 {@code CatalogIntegrationTest}：设置 {@code BILLING_DB_PASSWORD} 才跑。
 *
 * <h2>本测试反复验证的核心恒等式</h2>
 * <pre>
 *   balance(wallet) + balance(frozen) == Σ lots.remaining
 * </pre>
 * 左边是账本，右边是余额的唯一权威。两者只要出现一次不一致，就说明某条业务路径
 * 改了批次却没记账（或反过来）。**每个用例结束都验一次**——这是本切片最值钱的一条断言。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class LedgerIntegrationTest {

    private static final long USER = 9001L;
    private static final long JOB = 501L;
    private static final int CATALOG_VERSION = 1;
    /** 原价（万分比）。本测试考的是账本本身，折扣另有专测。 */
    private static final int NO_DISCOUNT = 10_000;
    /** 展示文案快照。本测试考的是账本，文案不参与断言，给个非空值即可。 */
    private static final String TITLE = "视频生成 · 测试";
    /**
     * 规则快照。本测试考的是账本本身，**直接调账本层的 {@code credits.hold}**（不经过计价），
     * 所以这里不需要规则；结算侧读不到快照时的处置是另一回事（见 SettlementServiceTest）。
     */
    private static final String NO_SNAPSHOT = null;

    /** 明天到期——扣减顺序的第一级（先过期先扣）会优先吃掉它。 */
    private static final Instant SOON = Instant.now().plus(1, ChronoUnit.DAYS);
    /** 30 天后到期。 */
    private static final Instant LATER = Instant.now().plus(30, ChronoUnit.DAYS);
    /** 早已过期——只有查询条件排除它，没有定时任务清理它。 */
    private static final Instant PAST = Instant.now().minus(30, ChronoUnit.DAYS);

    @Autowired private JdbcTemplate jdbc;
    @Autowired private CreditService credits;
    @Autowired private CreditLotRepository lots;
    @Autowired private LedgerRepository ledger;
    @Autowired private ReservationRepository reservations;

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM billing_ledger_entries");
        jdbc.update("DELETE FROM billing_cost_reservations");
        jdbc.update("DELETE FROM billing_credit_lots");
    }

    // ─────────────────────────────────────────────────────────────
    // 预扣：扣减顺序（§4.1 三级 tie-break）
    // ─────────────────────────────────────────────────────────────

    @Test
    void 预扣_先耗尽快到期的批次() {
        long daily = grant(CreditSource.DAILY, 100, SOON, "d1");
        long purchased = grant(CreditSource.PURCHASED, 1_000, null, "p1");

        credits.hold(USER, "cmd-1", JOB, 120, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        // 第一级 tie-break：expires_at ASC —— 快到期的那批先被吃完，付费批次只动零头
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

        // 第二级 tie-break：source_priority ASC（gift=30 < purchased=80）。
        // 两级有效期都相同（都是永久）时才轮到这里生效。
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
        // 过期靠 WHERE 排除，不需要（也没有）任何清理任务
        assertThat(lots.availableCredits(USER)).isEqualTo(40);
        assertInvariant();
    }

    // ─────────────────────────────────────────────────────────────
    // 预扣：冻结模型与恒等式
    // ─────────────────────────────────────────────────────────────

    @Test
    void 预扣_只冻结不动remaining() {
        long lot = grant(CreditSource.GIFT, 100, null, "g2");

        credits.hold(USER, "cmd-4", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        // 钱还没花掉，只是不能用了 —— remaining 原封不动
        assertThat(remainingOf(lot)).isEqualTo(100);
        assertThat(frozenOf(lot)).isEqualTo(40);
        // 但用户可用余额已经减少
        assertThat(lots.availableCredits(USER)).isEqualTo(60);
        assertInvariant();
    }

    @Test
    void 预扣_余额不足_抛异常且不留痕迹() {
        grant(CreditSource.GIFT, 10, null, "g3");

        assertThatThrownBy(() -> credits.hold(USER, "cmd-5", JOB, 11, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE))
                .isInstanceOf(InsufficientCreditsException.class)
                .hasMessageContaining("还差 1");

        // 全部回滚：没有冻结、没有预留、没有多余分录
        assertThat(lots.availableCredits(USER)).isEqualTo(10);
        assertThat(reservations.findByJobId(JOB)).isEmpty();
        assertThat(ledgerEntryCount()).isEqualTo(2);   // 只有 grant 那一笔凭证的两条腿
        assertInvariant();
    }

    @Test
    void 预扣_幂等_重复命令不二次冻结() {
        long lot = grant(CreditSource.GIFT, 100, null, "g4");

        HoldResult first = credits.hold(USER, "cmd-6", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        HoldResult second = credits.hold(USER, "cmd-6", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        // ★ 重放要能被识别出来。「返回了相同的数字」不足以区分「刚扣的」与「上次就扣过的」，
        //   而调用方可能需要据此决定要不要再写一次自己的副作用。
        assertThat(first.duplicated()).isFalse();
        assertThat(second.duplicated()).isTrue();
        assertThat(second.reservedCredits()).isEqualTo(first.reservedCredits());
        assertThat(second.catalogVersion()).isEqualTo(first.catalogVersion());

        assertThat(frozenOf(lot)).isEqualTo(40);       // 没有冻结两次
        assertThat(ledgerEntryCount()).isEqualTo(4);   // grant 2 条 + hold 2 条
        assertInvariant();
    }

    // ─────────────────────────────────────────────────────────────
    // 结算
    // ─────────────────────────────────────────────────────────────

    @Test
    void 结算_实际小于预扣_差额回到可用余额() {
        long lot = grant(CreditSource.GIFT, 100, null, "g5");
        credits.hold(USER, "cmd-7", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        credits.settle(JOB, 30);

        // 解冻全部 40，只从 remaining 扣 30 —— 差额 10 自动变回可用
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
        // ★ 这条是线上实测打出来的（jobId=1924，2026-09-25）：视频按 token 计价后，
        //   预扣是**按官方公式估**的、结算用**上游真值**，于是「实际 > 预扣」是常态而不再是
        //   「理论不该发生」。当时 settle 抛 `借贷不平：借 28 / 贷 27` → 事件被 MQ 无限重投，
        //   用户的钱永远冻着。
        long lot = grant(CreditSource.PURCHASED, 100, null, "g-over");
        credits.hold(USER, "cmd-over", JOB, 27, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        credits.settle(JOB, 28);

        // 批次只被扣掉**预扣额**（27）——超出的 1 分不悄悄从余额里多扣用户
        assertThat(remainingOf(lot)).isEqualTo(73);
        assertThat(frozenOf(lot)).isZero();
        assertThat(lots.availableCredits(USER))
                .as("用户实扣仍是**预扣额** 27（不是 28）—— 超出的那 1 分不从他余额里补")
                .isEqualTo(73);
        // 超出的 1 分记应收（平台垫付），收入照记 28 = 27 + 1
        assertThat(ledger.balanceOf(USER, Account.REVENUE)).isEqualTo(28);

        // ── ★ 欠费落成一等列，且与账本那一腿同数（本次改动的核心）───────────────
        Reservation settled = reservations.findByJobId(JOB).orElseThrow();
        assertThat(settled.status()).isEqualTo(Reservation.Status.SETTLED);
        assertThat(settled.actualCredits())
                .as("actual_credits 的语义**不变**：它是真实用量成本，含超出的那 1 分")
                .isEqualTo(28);
        assertThat(settled.receivableCredits())
                .as("欠费 = max(0, 实际 − 预扣) = 28 − 27")
                .isEqualTo(1);
        // ⚠️ RECEIVABLE 的自然方向是**借**（Account.normalDebit=true），超扣走的正是借方：
        //    读出来就是**正数 = 该用户欠多少**，所以取数时不取绝对值。
        //    这条断言同时把符号约定钉死——哪天有人把它改成贷方记账，这里会当场红。
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
        // 两笔：一笔实际 < 预扣，一笔实际 == 预扣 —— 后者是「≤」的边界。
        // 判据写成 `actual < reserved` 而不是 `<=` 时，恰好相等那笔会凭空多记一笔欠费
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
        // 差额那 10 分回到可用：200 − 30 − 40
        assertThat(lots.availableCredits(USER)).isEqualTo(130);
        assertInvariant();
        assertEveryVoucherBalanced();
        assertReceivableColumnMatchesLedgerPerJob();
    }

    /**
     * ★ 欠费列与账本 {@code RECEIVABLE} 那一腿**逐笔**相等 —— 本次改动的核心不变量。
     *
     * <h2>为什么不能只断言「两个 SUM 相等」</h2>
     *
     * 汇总相等可以被一次「两处各错一个方向」的巧合蒙对：列里把 A 的欠费多记了 5、
     * 账本里 B 少记了 5，总和照样相等，而两笔都错。逐笔比对把
     * 「**同一笔**结算里，列里的数与分录里的数来自同一个表达式」这件事钉死——
     * 任何一处写反/写漏/写重，都会在某个 jobId 上当场露出来。
     *
     * <h2>校验方式（两边的权威来源，逐条比对）</h2>
     *
     * <ul>
     *   <li>一边是预留行的 {@code receivable_credits} 列；</li>
     *   <li>另一边是账本里 {@code idempotency_key = settle:{jobId}:receivable} 的那条分录
     *       （键的拼接与生产代码共用 {@link Voucher#legKey}，这里刻意不自己拼字符串——
     *       自己拼一份就等于放一份可能分叉的第二实现进来）；</li>
     *   <li>再各自与「实际 − 预扣（负数归零）」对一次，确保金额本身也不是抄来的。</li>
     * </ul>
     *
     * <p>最后再把 Σ列 与账本 RECEIVABLE 的余额对一次：那是
     * 「按 job 记账」与「按用户汇总」之间唯一能对上的连接点，
     * 也是管理端看到的 {@code receivable_credits} 与账本口径一致的证明。
     */
    @Test
    void 结算_欠费列与账本应收逐笔相等() {
        // 四笔覆盖不同的超扣形态：超 1 / 恰好相等 / 不足 / 超 15
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

    /**
     * 欠费必须从日志里**看得见金额** —— 「先欠费」这个产品口径的全部可观测面。
     *
     * <p>产品已确认不收款、不封禁、不拦截，所以这笔欠费的主动出口就只有这条 WARN：
     * 预留行与账本要有人去查才看得见，而日志是自己报出来的。一条只说「结算超出预扣」、
     * 不带差额的日志，等于把「到底欠了多少」又推回给读日志的人。
     */
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
        long gift = grant(CreditSource.GIFT, 20, null, "g6");            // priority 30，先扣
        long purchased = grant(CreditSource.PURCHASED, 100, null, "p4"); // priority 80，后扣

        credits.hold(USER, "cmd-8", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);   // gift 20 + purchased 20
        credits.settle(JOB, 35);                                 // gift 20 + purchased 15

        assertThat(remainingOf(gift)).isZero();
        assertThat(remainingOf(purchased)).isEqualTo(85);

        // 消耗是**按批次来源逐笔判定**的，不是整单一个科目：
        //   赠送批次消耗 20 → 记成本；付费批次消耗 15 → 记收入
        assertThat(ledger.balanceOf(USER, Account.COST)).isEqualTo(100);      // 120 - 20
        assertThat(ledger.balanceOf(USER, Account.REVENUE)).isEqualTo(15);

        var accounts = ledgerAccountsOfVoucher("settle:" + JOB);
        assertThat(accounts).containsExactlyInAnyOrder("frozen", "cost", "revenue", "wallet");
        assertInvariant();
        assertEveryVoucherBalanced();
    }

    // ─────────────────────────────────────────────────────────────
    // 返还
    // ─────────────────────────────────────────────────────────────

    @Test
    void 返还_批次原封不动_有效期不被重置() {
        long lot = grant(CreditSource.DAILY, 100, LATER, "g7");
        Instant expiresBefore = expiresOf(lot);

        credits.hold(USER, "cmd-9", JOB, 40, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);
        credits.refund(JOB, "上游任务失败");

        assertThat(remainingOf(lot)).isEqualTo(100);
        assertThat(frozenOf(lot)).isZero();
        // ★ 有效期必须是原来那个 —— 「扣掉再新建批次返回」会让用户凭空多一段有效期
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

        // 结算与超时兜底扫描会并发到达，迟到的失败回调必须是无操作
        credits.refund(JOB, "迟到的失败回调");

        assertThat(ledgerEntryCount()).isEqualTo(entriesAfterSettle);
        assertThat(remainingOf(lot)).isEqualTo(60);
        assertThat(frozenOf(lot)).isZero();
        assertThat(reservations.findByJobId(JOB).orElseThrow().status())
                .isEqualTo(Reservation.Status.SETTLED);
        assertInvariant();
    }

    // ─────────────────────────────────────────────────────────────
    // 时区口径（DbTime.ZONE 必须与 datasource 的会话时区一致）
    // ─────────────────────────────────────────────────────────────

    @Test
    void 会话时区已钉成北京时间() {
        // 断言的是**偏移量**而不是 @@session.time_zone 的字面值：
        // forceConnectionTimeZoneToSession 把会话设成命名时区 "Asia/Shanghai"（而非 "+08:00"），
        // 两者都对。真正要钉住的性质是「会话墙钟比 UTC 快 8 小时」——DbTime.ZONE 就按它换算。
        assertThat(jdbc.queryForObject(
                "SELECT TIMESTAMPDIFF(HOUR, UTC_TIMESTAMP(), NOW())", Integer.class))
                .as("NOW() 必须比 UTC_TIMESTAMP() 快 8 小时，与 DbTime.ZONE 一致；"
                        + "否则 DATETIME 的写入口径与 NOW() 的判定口径相差整小时")
                .isEqualTo(8);
    }

    @Test
    void 到期边界_一小时内到期的批次判定正确() {
        // 用 ±1 小时而不是 ±1 天：8 小时的时区偏差在 ±1 天的用例里被掩盖，
        // 在这里会立刻翻车（该过期的那批被当成有效）。
        long expiring = grant(CreditSource.GIFT, 100, Instant.now().plus(1, ChronoUnit.HOURS), "tz-a");
        long expired = grant(CreditSource.GIFT, 100, Instant.now().minus(1, ChronoUnit.HOURS), "tz-b");

        credits.hold(USER, "cmd-tz", JOB, 60, CATALOG_VERSION, NO_DISCOUNT, NO_SNAPSHOT, TITLE);

        assertThat(frozenOf(expiring)).isEqualTo(60);
        assertThat(frozenOf(expired)).isZero();
        assertInvariant();
    }

    // ─────────────────────────────────────────────────────────────
    // 断言工具
    // ─────────────────────────────────────────────────────────────

    private long grant(CreditSource source, long amount, Instant expiresAt, String grantKey) {
        return credits.grant(USER, source, amount, expiresAt, "grant", grantKey, grantKey);
    }

    /**
     * 核心恒等式：账本两侧 == 批次总量。
     *
     * <p>它钉住三件事：①每笔批次变动都有对应分录；②分录方向没写反；
     * ③wallet 记的确实是**可用**（remaining − frozen）而不是 remaining。
     *
     * <h2>为什么第二行要带上「已过期未核销」</h2>
     *
     * 批次过期**不是自动的**：过期的批次只是被查询条件排除，它账上的积分
     * （{@code remaining − frozen}）在**过期核销分录**（§3 分录 10，{@code expire:{lotId}}）
     * 落库之前，仍然计入账本的 wallet 余额。
     *
     * <p>所以真正恒成立的是：
     * <pre>
     *   wallet == 未过期可用 + 已过期未核销
     * </pre>
     * 本切片没做核销，等式右边第二项非零——**这个非零值本身就是待办的可见证据**。
     * 若哪天它不再为 0，说明核销落地了，这条断言要跟着改。
     */
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

    /** 已过期但**尚未写下核销分录**的积分（{@code remaining − frozen}）。 */
    private long expiredAvailable() {
        Long sum = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining - frozen), 0) FROM billing_credit_lots "
                        + "WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at <= NOW()",
                Long.class, USER);
        return sum == null ? 0L : sum;
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

    private List<String> ledgerAccountsOfVoucher(String idempotencyBase) {
        return jdbc.queryForList(
                "SELECT account FROM billing_ledger_entries WHERE idempotency_key LIKE ?",
                String.class, idempotencyBase + ":%");
    }

    // ─────────────────────────────────────────────────────────────
    // 欠费（receivable_credits，见 V9 迁移）
    // ─────────────────────────────────────────────────────────────

    /**
     * 欠费列与账本应收那一腿**逐笔**相等。
     *
     * <p>两个来源都取自库：预留行的 {@code receivable_credits} 列，与账本里
     * {@code settle:{jobId}:receivable} 那条分录。逐条比而不是比总和——理由见
     * {@link #结算_欠费列与账本应收逐笔相等()}。
     *
     * <p>另外把每一笔与「实际 − 预扣（负数归零）」对一次：只比「列 == 分录」是不够的，
     * 两处一起写错（比如都写成 actual_credits）时两边照样相等。三方对上才算真对。
     */
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

    /**
     * 该 job 在账本上那一腿应收的金额；没有这一腿（未超扣）时为 0。
     *
     * <p>分录键由 {@link Voucher#legKey}（基础键 + 科目）推导，这里直接按它查——
     * 不自己拼一份「另一个实现」，那正是判重失效的经典成因。
     */
    private long receivableLegOfJob(long jobId) {
        List<Long> amounts = jdbc.queryForList(
                "SELECT amount FROM billing_ledger_entries WHERE idempotency_key = ?",
                Long.class, Voucher.legKey("settle:" + jobId, Account.RECEIVABLE));
        return amounts.isEmpty() ? 0L : amounts.get(0);
    }

    /** 该 job 的「实际 − 预扣」（负数归零）—— 与生产侧那个表达式的口径一致。 */
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

    private Instant expiresOf(long lotId) {
        var timestamp = jdbc.queryForObject(
                "SELECT expires_at FROM billing_credit_lots WHERE id = ?",
                java.sql.Timestamp.class, lotId);
        return timestamp == null ? null : timestamp.toInstant();
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
