package com.bluewhale.billing.application;

import com.bluewhale.billing.infrastructure.persistence.repository.ReconciliationRepository;
import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.infrastructure.persistence.repository.LedgerRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Component
public class LedgerSelfCheck {

    private static final Logger log = LoggerFactory.getLogger(LedgerSelfCheck.class);

    static final String CRON_ZONE = "Asia/Shanghai";

    private final ReconciliationRepository audit;
    private final LedgerRepository ledger;

    private final int userLimit;

    private final int breakSample;

    private final int entryWindow;

    public LedgerSelfCheck(ReconciliationRepository audit,
                           LedgerRepository ledger,
                           @Value("${billing.reconciliation.self-check.user-limit:20}") int userLimit,
                           @Value("${billing.reconciliation.self-check.break-sample:10}") int breakSample,
                           @Value("${billing.reconciliation.self-check.entry-window:500}") int entryWindow) {
        this.audit = audit;
        this.ledger = ledger;
        this.userLimit = userLimit;
        this.breakSample = breakSample;
        this.entryWindow = entryWindow;
    }

    @Scheduled(cron = "${billing.reconciliation.self-check.cron:0 0 3 * * *}", zone = CRON_ZONE)
    void runDaily() {
        try {
            report(check());
        } catch (Exception e) {
            log.error("账本自检执行失败：本轮未得出任何结论（**不等于账是平的**），下一轮为次日同一时刻", e);
        }
    }

    public Report check() {
        ReconciliationRepository.GlobalTotals totals = audit.globalTotals();
        if (totals.balanced()) {
            return Report.balanced(totals);
        }

        List<ReconciliationRepository.UserImbalance> imbalances = audit.imbalancedUsers(userLimit);
        List<UserFinding> findings = new ArrayList<>(imbalances.size());
        for (ReconciliationRepository.UserImbalance imbalance : imbalances) {
            LedgerRepository.BreakScan scan = ledger.findBalanceBreaks(imbalance.userId(), entryWindow);
            findings.add(new UserFinding(
                    imbalance.userId(), imbalance.lotsRemaining(), imbalance.ledgerTotal(),
                    ledger.balanceOf(imbalance.userId(), Account.WALLET),
                    ledger.balanceOf(imbalance.userId(), Account.FROZEN),
                    scan));
        }
        return new Report(totals, findings, imbalances.size() >= userLimit);
    }

    private void report(Report report) {
        ReconciliationRepository.GlobalTotals totals = report.totals();
        if (report.balanced()) {
            log.info("账本自检通过：Σ lots.remaining = ledger(wallet+frozen) = {}", totals.ledgerTotal());
            return;
        }

        log.error("账本自检不平：Σ lots.remaining={} vs ledger(wallet+frozen)={}，差={}（正=批次多/账本少记）；"
                        + "不平的用户 {} 个{}",
                totals.lotsRemaining(), totals.ledgerTotal(), totals.diff(),
                report.users().size(), report.truncated() ? "（已达上报上限，" + userLimit + " 个以外的未列出）" : "");
        for (UserFinding finding : report.users()) {
            log.error("  用户 {}：批次 Σremaining={} / 账本 wallet+frozen={}（wallet={} frozen={}），差={}",
                    finding.userId(), finding.lotsRemaining(), finding.ledgerTotal(),
                    finding.walletBalance(), finding.frozenBalance(), finding.diff());
            if (finding.breaks().isEmpty()) {
                log.error("    账本链自洽（审计窗口{}内无 balance_after 断裂）→ 差异在**批次侧**："
                                + "批次被绕过账本直接改过（ADR-0115 决策 9 禁止的那件事），或某条写路径漏记了一腿",
                        finding.windowFull() ? "【已取满，仅覆盖最近 " + entryWindow + " 条】" : "");
            } else {
                finding.breaks().stream().limit(breakSample).forEach(breakPoint -> log.error(
                        "    balance_after 断裂：分录 id={} 科目={}，上笔 {} + 本笔增减 = 应为 {}，实际 {}（差 {}）",
                        breakPoint.entryId(), breakPoint.account(), breakPoint.previousBalance(),
                        breakPoint.expectedBalance(), breakPoint.actualBalance(),
                        breakPoint.actualBalance() - breakPoint.expectedBalance()));
                if (finding.breaks().size() > breakSample) {
                    log.error("    （该用户共 {} 处断裂，此处只列前 {} 处）",
                            finding.breaks().size(), breakSample);
                }
            }
        }
        log.error("⚠️ 自检只报不动：差异要么来自漏记的分录、要么来自被改过的批次行。"
                + "自动补一条「调平分录」会把证据一起抹掉——差额怎么来的从此不可考。"
                + "请人工核查上面定位到的用户/分录，处置走冲正分录（append-only，不改进历史）。");
    }

    public record Report(ReconciliationRepository.GlobalTotals totals,
                         List<UserFinding> users,
                         boolean truncated) {

        static Report balanced(ReconciliationRepository.GlobalTotals totals) {
            return new Report(totals, List.of(), false);
        }

        public boolean balanced() {
            return totals.balanced();
        }

        public long diff() {
            return totals.diff();
        }
    }

    public record UserFinding(long userId, long lotsRemaining, long ledgerTotal,
                              long walletBalance, long frozenBalance,
                              LedgerRepository.BreakScan scan) {

        public long diff() {
            return lotsRemaining - ledgerTotal;
        }

        public List<LedgerRepository.BreakPoint> breaks() {
            return scan.breaks();
        }

        public boolean windowFull() {
            return scan.windowFull();
        }
    }
}
