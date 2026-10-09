package com.bluewhale.billing.application;

import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.testsupport.LogCapture;
import ch.qos.logback.classic.Level;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

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


    @Test
    void 平的账本_自检通过() {
        credits.grant(USER, CreditSource.GIFT, 100, null, "grant", "self-check", "self-check-a");
        credits.hold(USER, "cmd-a", 701L, 40, CATALOG_VERSION, NO_DISCOUNT, null, "视频生成 · 自检");

        LedgerSelfCheck.Report report = selfCheck.check();

        assertThat(report.balanced()).isTrue();
        assertThat(report.diff()).isZero();
        assertThat(report.users()).isEmpty();
        assertThat(report.truncated()).isFalse();
    }


    @Test
    void 批次被绕过账本改动_检出用户且指出差异在批次侧() {
        long lot = grant("self-check-break-lot", 100);
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


    @Test
    void 分录被改过_按balance_after断裂点定位到具体分录并落成ERROR明细() {
        grant("self-check-b", 100);
        long walletLeg = jdbc.queryForObject(
                "SELECT id FROM billing_ledger_entries WHERE idempotency_key = 'grant:self-check-b:wallet'",
                Long.class);
        jdbc.update("UPDATE billing_ledger_entries SET balance_after = balance_after + 7 WHERE id = ?", walletLeg);
        int entriesBefore = entryCount();

        String errors;
        try (LogCapture logs = LogCapture.of(LedgerSelfCheck.class)) {
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

        assertThat(entryCount()).isEqualTo(entriesBefore);
        assertThat(remainingOf()).isEqualTo(100);
    }


    private long grant(String grantKey, long amount) {
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
