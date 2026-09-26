package com.bluewhale.billing.application;

import com.bluewhale.billing.adapter.outbound.persistence.repository.ReconciliationRepository;
import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.adapter.outbound.persistence.repository.LedgerRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * ① 账本自检（《计费逻辑详细设计》§9 层次①）——每日一次，验一条恒等式：
 *
 * <pre>
 *   Σ lots.remaining  ==  ledger(wallet) + ledger(frozen)
 * </pre>
 *
 * <h2>它为什么必须存在</h2>
 *
 * 左边是**余额的唯一权威**（批次表），右边是复式账本。两侧由同一段代码在同一个事务里写，
 * 正常情况下永远相等——所以它平时是一条「本来就该成立」的断言。它存在的意义在于
 * **哪一天它不成立了**：批次被绕过账本直接改过、某条写路径漏记了一腿、
 * 人工调过数据。这类错误不会让任何请求失败、不会让任何接口报错，
 * 唯一的症状就是「钱对不上」——而它只在有人真去算的时候才被看见。
 *
 * <h2>不平之后：只报不动</h2>
 *
 * 打 ERROR + 结构化明细（差额、不平的用户、按 {@code balance_after} 定位到的分录 id），
 * **绝不自动补账**。自动补一条「调平分录」看起来贴心，实际是把证据抹掉：
 * 差额是怎么来的、漏了哪一笔，从此再也查不出来，而钱已经被「调平」了。
 * 对账的第一价值是**定位**，第二才是平账；顺序反了等于什么都没做。
 *
 * <h2>为什么不抛异常</h2>
 *
 * 抛出去会炸掉这一次调度，而 Spring 的定时任务在下次触发前不会重试——
 * 结果是**日志里只留下一个堆栈，没有任何一条说明账怎么样了**。
 * 而且失败的那一轮会不会在下次被覆盖掉？会。所以这里把异常收成 ERROR 日志：
 * 不平是**业务事实**，不是「本次执行失败」。
 *
 * <p>⚠️ 但执行失败（DB 连不上、SQL 超时）**也是 ERROR 且必须与「平」区分开**：
 * 把「没跑成」显示成绿色，是审计类任务最坏的失败模式——绿灯亮着，没人再看。
 *
 * <h2>不在扣费路径上</h2>
 *
 * 本类的三条查询都是全表聚合（{@code Σ remaining}、各用户最近余额、按用户分组比对），
 * 代价以秒计。它们只由这里的每日调度调用，绝不进入 Hold 的事务预算（< 5ms）。
 */
@Component
public class LedgerSelfCheck {

    private static final Logger log = LoggerFactory.getLogger(LedgerSelfCheck.class);

    /**
     * 调度的时区。**必须与 {@code DbTime.ZONE} 一致**。
     *
     * <p>容器里默认是 UTC，若不写这一行，「每天 3 点」会变成北京时间上午 11 点跑——
     * 那时正是任务高峰，全表聚合与所有用户的请求抢资源。写死字符串而不是做成配置项：
     * 它是与 {@code DbTime.ZONE} 绑定的正确性常量，可配只会让人把它配歪。
     */
    static final String CRON_ZONE = "Asia/Shanghai";

    private final ReconciliationRepository audit;
    private final LedgerRepository ledger;

    /** 不平的用户最多报几个（不平可能有几千个，全量打印等于没打印）。 */
    private final int userLimit;

    /** 每个用户的断裂点最多打几行（同一处断裂会连带后面若干笔都报，前几条足够定位）。 */
    private final int breakSample;

    /** 每个用户最多回看多少条分录（快照自洽性是相邻两条的性质，不必从头读）。 */
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

    /**
     * 每日自检入口（默认 03:00 北京时间，见 application.yml 的取值理由）。
     *
     * <p>{@code @Scheduled} 的方法按约定返回 void，所以这里只把
     * {@link #check()} 的报告落到日志上；测试与将来的管理端「立即对一次账」
     * 直接调 {@link #check()}——**两者走的是同一条路径**，不存在「定时那套没测到」。
     */
    @Scheduled(cron = "${billing.reconciliation.self-check.cron:0 0 3 * * *}", zone = CRON_ZONE)
    void runDaily() {
        try {
            report(check());
        } catch (Exception e) {
            // ⚠️ 与「不平」分开说：这一条代表**本轮没有得出任何结论**，不等于账是平的
            log.error("账本自检执行失败：本轮未得出任何结论（**不等于账是平的**），下一轮为次日同一时刻", e);
        }
    }

    /**
     * 跑一次自检并返回报告。**只读**：不改任何一行数据。
     *
     * <p>为什么把报告返回出来而不是只在内部打日志：它是一份可以被检查的结论
     * （平的 / 不平且差多少 / 差在谁身上 / 断在哪条分录），
     * 测试要钉的正是这份结论，而不是「日志里出现过某个词」。
     *
     * @throws RuntimeException 底层查询失败（DB 不可用、SQL 出错）——
     *                          此时**没有结论**，调用方不得当作「平」
     */
    public Report check() {
        ReconciliationRepository.GlobalTotals totals = audit.globalTotals();
        if (totals.balanced()) {
            return Report.balanced(totals);
        }

        // 不平：先按用户定位，再对这几个用户走一遍 balance_after 链
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

    /** 把报告落成日志（ERROR + 结构化明细）。 */
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

    /**
     * 一次自检的结论。
     *
     * @param totals    全库两侧合计（判定的权威依据）
     * @param users     不平的用户明细；平的时候为空
     * @param truncated 不平用户已达上报上限，还有人没列出来
     */
    public record Report(ReconciliationRepository.GlobalTotals totals,
                         List<UserFinding> users,
                         boolean truncated) {

        static Report balanced(ReconciliationRepository.GlobalTotals totals) {
            return new Report(totals, List.of(), false);
        }

        public boolean balanced() {
            return totals.balanced();
        }

        /** 批次侧 − 账本侧。 */
        public long diff() {
            return totals.diff();
        }
    }

    /**
     * 一个不平用户的明细。
     *
     * @param lotsRemaining  该用户 Σ 批次 remaining
     * @param ledgerTotal    该用户账本侧 wallet + frozen
     * @param walletBalance  账本 wallet 的最近快照（用于指出差在哪个科目上）
     * @param frozenBalance  账本 frozen 的最近快照
     * @param scan           按 balance_after 走链的结果（断裂点为空 = 差异在批次侧）
     */
    public record UserFinding(long userId, long lotsRemaining, long ledgerTotal,
                              long walletBalance, long frozenBalance,
                              LedgerRepository.BreakScan scan) {

        public long diff() {
            return lotsRemaining - ledgerTotal;
        }

        public List<LedgerRepository.BreakPoint> breaks() {
            return scan.breaks();
        }

        /** 审计窗口是否取满：满 = 「没断裂」只代表窗口内没断裂。 */
        public boolean windowFull() {
            return scan.windowFull();
        }
    }
}
