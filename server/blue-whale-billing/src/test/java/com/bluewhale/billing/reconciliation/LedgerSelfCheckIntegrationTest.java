package com.bluewhale.billing.reconciliation;

import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.CreditSource;
import com.bluewhale.billing.testsupport.LogCapture;
import ch.qos.logback.classic.Level;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 账本自检的真库集成测试（《计费逻辑详细设计》§9 层次①）。
 *
 * <h2>本文件最重要的不是「平的没问题」，而是「不平能被抓到、能定位」</h2>
 *
 * 恒等式平时永远成立（两侧由同一段代码在同一事务里写），所以「平」的用例只能证明
 * 自检不会误报——它证明不了自检有用。真正的价值在**故意造一个不平**：
 * 批次被绕过账本直接改过（ADR-0115 决策 9 明文禁止的那件事），
 * 或者账本被账本之外的写法改过。两条用例分别钉这两种情形，
 * 并断言自检能说出**差在谁身上、差在哪条分录上**——
 * 「总数不平」是最难查的错误，只知道整体错了、不知道错在哪。
 *
 * <p>门控同其它集成测试：设置 {@code BILLING_DB_PASSWORD} 才跑，且只落在
 * {@code bw_billing_test*}（{@code BillingTestDatabaseGate}）。
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class LedgerSelfCheckIntegrationTest {

    private static final long USER = 9801L;
    private static final int CATALOG_VERSION = 1;
    private static final int NO_DISCOUNT = 10_000;

    @Autowired private JdbcTemplate jdbc;
    @Autowired private CreditService credits;
    @Autowired private LedgerSelfCheck selfCheck;

    @BeforeEach
    void setUp() {
        jdbc.update("DELETE FROM billing_ledger_entries");
        jdbc.update("DELETE FROM billing_cost_reservations");
        jdbc.update("DELETE FROM billing_credit_lots");
    }

    // ─────────────────────────────────────────────────────────────
    // 平：不该误报
    // ─────────────────────────────────────────────────────────────

    @Test
    void 平的账本_自检通过() {
        // 发放 + 预扣（钱从可用挪到冻结）走一遍真实路径
        credits.grant(USER, CreditSource.GIFT, 100, null, "grant", "self-check", "self-check-a");
        credits.hold(USER, "cmd-a", 701L, 40, CATALOG_VERSION, NO_DISCOUNT, null, "视频生成 · 自检");

        LedgerSelfCheck.Report report = selfCheck.check();

        assertThat(report.balanced()).isTrue();
        assertThat(report.diff()).isZero();
        assertThat(report.users()).isEmpty();
        assertThat(report.truncated()).isFalse();
    }

    // ─────────────────────────────────────────────────────────────
    // 不平之一：批次侧被动过（账本自洽）
    // ─────────────────────────────────────────────────────────────

    @Test
    void 批次被绕过账本改动_检出用户且指出差异在批次侧() {
        long lot = grant("self-check-break-lot", 100);
        // 模拟「有人直接改了批次余量」：扣掉 7 分却不记账
        jdbc.update("UPDATE billing_credit_lots SET remaining = remaining - 7 WHERE id = ?", lot);

        LedgerSelfCheck.Report report = selfCheck.check();

        assertThat(report.balanced())
                .as("批次少了 7 分而账本没动 —— 这正是自检存在的理由")
                .isFalse();
        assertThat(report.diff()).isEqualTo(-7);
        assertThat(report.users()).hasSize(1);

        LedgerSelfCheck.UserFinding finding = report.users().get(0);
        assertThat(finding.userId()).isEqualTo(USER);
        assertThat(finding.lotsRemaining()).isEqualTo(93);
        assertThat(finding.ledgerTotal()).isEqualTo(100);
        assertThat(finding.walletBalance()).isEqualTo(100);
        assertThat(finding.frozenBalance()).isZero();
        assertThat(finding.breaks())
                .as("账本自身没被改过 → 没有 balance_after 断裂；差异只可能在批次侧。"
                        + "日志必须把这两种原因分开说，处置动作完全不同")
                .isEmpty();
    }

    // ─────────────────────────────────────────────────────────────
    // 不平之二：账本侧被改过（按 balance_after 断裂点定位）
    // ─────────────────────────────────────────────────────────────

    @Test
    void 分录被改过_按balance_after断裂点定位到具体分录并落成ERROR明细() {
        grant("self-check-b", 100);
        long walletLeg = jdbc.queryForObject(
                "SELECT id FROM billing_ledger_entries WHERE idempotency_key = 'grant:self-check-b:wallet'",
                Long.class);
        // 模拟「账本被账本之外的写法改过」：把 wallet 那一笔的余额快照改大 7 分
        jdbc.update("UPDATE billing_ledger_entries SET balance_after = balance_after + 7 WHERE id = ?", walletLeg);
        int entriesBefore = entryCount();

        String errors;
        try (LogCapture logs = LogCapture.of(LedgerSelfCheck.class)) {
            // ★ 走定时入口（报告 → 日志）。检查的产物就是这条 ERROR：
            //   人要拿它去接手，所以「差多少、差在谁身上、断在哪条分录」一个都不能少
            selfCheck.runDaily();
            errors = logs.text(Level.ERROR);
        }

        LedgerSelfCheck.Report report = selfCheck.check();

        assertThat(report.balanced()).isFalse();
        assertThat(report.diff()).as("Σremaining=100 − ledger(wallet)=107").isEqualTo(-7);

        LedgerSelfCheck.UserFinding finding = report.users().get(0);
        assertThat(finding.walletBalance()).isEqualTo(107);
        assertThat(finding.frozenBalance()).isZero();

        assertThat(finding.breaks()).hasSize(1);
        var breakPoint = finding.breaks().get(0);
        assertThat(breakPoint.entryId()).as("★ 定位到具体分录 —— 这是这一层最值钱的输出").isEqualTo(walletLeg);
        assertThat(breakPoint.account()).isEqualTo("wallet");
        assertThat(breakPoint.previousBalance()).isZero();
        assertThat(breakPoint.expectedBalance()).isEqualTo(100);
        assertThat(breakPoint.actualBalance()).isEqualTo(107);

        assertThat(errors)
                .contains("账本自检不平")
                .contains("差=-7")
                .contains("用户 " + USER)
                .contains("balance_after 断裂")
                .contains("分录 id=" + walletLeg);

        // 只报不动：自检**不得**写下任何「调平分录」，否则证据被抹掉、差额怎么来的不可考
        assertThat(entryCount()).isEqualTo(entriesBefore);
        assertThat(remainingOf()).isEqualTo(100);
    }

    // ─────────────────────────────────────────────────────────────
    // 夹具与断言工具
    // ─────────────────────────────────────────────────────────────

    private long grant(String grantKey, long amount) {
        // bizId 与 grantKey 逐字相同（同 LedgerIntegrationTest 的写法）：
        // 凭证的幂等基础键是 grant:{grantKey}，测试要按它去点某一条分录
        return credits.grant(USER, CreditSource.GIFT, amount, null, "grant", grantKey, grantKey);
    }

    private int entryCount() {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM billing_ledger_entries", Integer.class);
        return count == null ? 0 : count;
    }

    private long remainingOf() {
        Long sum = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining), 0) FROM billing_credit_lots", Long.class);
        return sum == null ? 0L : sum;
    }
}
