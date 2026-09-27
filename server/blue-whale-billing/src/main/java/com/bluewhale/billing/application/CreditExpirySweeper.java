package com.bluewhale.billing.application;

import com.bluewhale.billing.adapter.outbound.persistence.repository.CreditLotRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * ③ 过期核销（《通用积分卡 PRD》§9.5「过期处理」/§9.6「积分过期」）——每小时扫一次
 * 已到期、仍有可用量的批次，逐条写核销分录。
 *
 * <h2>它补的是「余额已经变了、但没人记账」这一段</h2>
 *
 * <p>积分的**能不能用**是**查询条件**派生的：{@code expires_at <= NOW()} 的批次早就被
 * {@code lockActiveLots} / {@code sumAvailable} 排除，用户在那一天起就用不了了。
 * 所以本任务**不是**过期生效的开关，它只做一件查询条件做不到的事：
 * <b>留痕</b>——写 {@code expire:{lotId}:{version}} 分录，让用户流水里出现一行
 * 「积分过期」，让报表能回答「这个月有多少积分自然消亡」。
 *
 * <h2>为什么查询条件派生不够，还要这一刀</h2>
 *
 * <p>不记账的那部分积分在账上一直挂在用户 wallet 里：账本说他有、余额说他没有。
 * 每日自检（{@link LedgerSelfCheck}）钉的是
 * {@code Σ lots.remaining == ledger(wallet) + ledger(frozen)}，而「已过期未核销」
 * 恰好落在等式两边之差上——这不是账不平，是一段**尚未发生的事件**。
 * 本任务把它发生掉。
 *
 * <h2>频率只决定「流水晚多久出现」</h2>
 *
 * <p>每小时一轮，是因为余额的可用性早已由查询条件即时生效，本任务只影响流水与分录的
 * 出现时点。小时级意味着用户最坏晚一小时在积分记录里看到那行「积分过期」——
 * 而这对账目完整性没有任何影响（自检的恒等式在核销前后都成立，见的
 * {@link CreditService#expireLot}）。
 *
 * <h2>异常必须吞掉</h2>
 *
 * <p>与 {@link CatalogReloadTask} / {@link ReservationSweeper} 同一条纪律：
 * 异常逃出 {@code @Scheduled} 方法会让 Spring 把这个任务**永久停掉**，
 * 而那时服务看起来一切正常，只是再也没有积分被核销过流水。
 * 逐条也各包一层 try/catch：一条坏数据不能让同批其余到期批次这轮白扫。
 */
@Component
public class CreditExpirySweeper {

    private static final Logger log = LoggerFactory.getLogger(CreditExpirySweeper.class);

    private final CreditLotRepository lots;
    private final CreditService credits;

    /** 总开关（默认开）。关掉后余额不受影响（查询条件照旧排除过期批次），只是不再写核销流水。 */
    private final boolean enabled;

    /** 每轮最多处理几条。 */
    private final int batchSize;

    /** 日志里最多列几条明细。 */
    private final int sampleSize;

    public CreditExpirySweeper(CreditLotRepository lots,
                               CreditService credits,
                               @Value("${billing.expiry.sweep.enabled:true}") boolean enabled,
                               @Value("${billing.expiry.sweep.batch-size:500}") int batchSize,
                               @Value("${billing.expiry.sweep.sample-size:10}") int sampleSize) {
        if (batchSize <= 0) {
            throw new IllegalStateException("batch-size 必须为正：" + batchSize);
        }
        this.lots = lots;
        this.credits = credits;
        this.enabled = enabled;
        this.batchSize = batchSize;
        this.sampleSize = sampleSize;
    }

    /**
     * 定时入口（默认每小时一轮，启动 1 分钟后先跑一轮以覆盖「重启期间攒下的」）。
     *
     * <p>{@code @Scheduled} 的方法按约定返回 void；本方法只是把 {@link #sweepOnce()}
     * 的结果落进日志。测试与将来的管理端「立刻核销一轮」直接调 {@code sweepOnce()}——
     * **同一条路径**，不存在「定时那套没测到」。
     */
    @Scheduled(fixedDelayString = "${billing.expiry.sweep.fixed-delay:PT1H}",
            initialDelayString = "${billing.expiry.sweep.initial-delay:PT1M}")
    void sweep() {
        try {
            sweepOnce();
        } catch (Exception e) {
            // 收成日志，不让它冒到调度线程（见类注释「异常必须吞掉」）
            log.error("过期核销扫描失败：本轮未核销任何批次（**不代表没有到期的积分**）", e);
        }
    }

    /**
     * 扫一轮并返回本轮结果。**日志由本方法自己打**（定时与手动触发看到的一样）。
     *
     * <p>逐条独立事务（{@code credits.expireLot} 是 {@code @Transactional} 的独立 bean）：
     * 本类**刻意不加 {@code @Transactional}**——加了就会把一整批核销合成一个巨型事务，
     * 一条失败连坐全部。这里反过来：一条炸了继续下一条，下一轮重扫到它。
     */
    public SweepResult sweepOnce() {
        if (!enabled) {
            // 关掉时也要说一声：否则「扫描在跑、日志也有」会让人以为核销在进行
            log.warn("过期核销已关闭（billing.expiry.sweep.enabled=false）：到期的积分不会被写下核销流水，"
                    + "余额侧不受影响（过期批次本来就被查询条件排除）");
            return new SweepResult(List.of(), false, 0, 0, 0, 0);
        }

        List<CreditLotRepository.Lot> due = lots.listDueLots(batchSize);

        int expired = 0;
        int untouched = 0;
        int failed = 0;
        long expiredCredits = 0;
        for (CreditLotRepository.Lot lot : due) {
            try {
                long amount = credits.expireLot(lot.id());
                if (amount > 0) {
                    expired++;
                    expiredCredits += amount;
                    if (expired <= sampleSize) {
                        log.info("积分过期核销：lotId={} userId={} 来源={} 核销={} 积分"
                                        + "（该批次到期于 {}，冻结部分 {} 不受过期影响，留在批次里等结算/返还）",
                                lot.id(), lot.userId(), lot.source().key(), amount,
                                lot.expiresAt(), lot.frozen());
                    }
                } else {
                    // 走到这里只可能是并发下的重判（另一轮/人工已核销，或可核销量被结算清零）。
                    // 记下来而不是丢掉：本轮计数与实际核销数不等的唯一合法解释就是它。
                    untouched++;
                }
            } catch (Exception e) {
                failed++;
                // 逐条兜住：一条失败不能让同批其余到期积分这轮白扫。下一轮会重扫到它。
                log.error("积分过期核销失败（下一轮会重试）：lotId={} userId={} 到期于={}",
                        lot.id(), lot.userId(), lot.expiresAt(), e);
            }
        }

        boolean windowFull = due.size() >= batchSize;
        if (expired > 0 || failed > 0) {
            log.info("过期核销本轮完成：取到 {} 条到期批次{} → 核销 {} 条 / 共 {} 积分、无操作 {}、失败 {}",
                    due.size(), windowFull ? "【已达取数上限 " + batchSize + "，剩下的下一轮继续（按最久到期优先）】" : "",
                    expired, expiredCredits, untouched, failed);
        } else if (windowFull) {
            // 取满却没核销掉任何一条：到期的批次全都核销不动（多半是全部处于冻结），
            // 而它们会一直占着这个窗口——不吭声的话，看起来就像任务没跑
            log.warn("过期核销本轮取满 {} 条却一条也没核销掉：这些批次的可用量都被冻结占着"
                    + "（或已被并发核销），下一轮仍会取到它们", batchSize);
        } else {
            // 全绿的每轮一行：定时任务最怕的不是报错，是**静默没跑**——
            // 有这一行才能从日志回答「它还在跑吗」
            log.info("过期核销本轮完成：无到期批次");
        }

        return new SweepResult(due, windowFull, expired, untouched, failed, expiredCredits);
    }

    /**
     * 一轮扫描的结果。
     *
     * <p>它给日志与测试用；**积分的权威始终是批次表与账本**，不是这里的计数——
     * 计数只是「本轮做了什么」的快照，两者不一致时以后者为准。
     *
     * @param due            本轮取到的到期批次（最久到期在前；可能因 batchSize 被截断）
     * @param windowFull     取数是否已达 batchSize（还有更多没看到）
     * @param expired        本轮**确认核销**的条数（expireLot 返回了正数）
     * @param untouched      伸手了但无操作的条数（并发下已被核销 / 可用量被结算清零）
     * @param failed         核销抛错的条数（下一轮重扫会重试）
     * @param expiredCredits 本轮核销的积分合计
     */
    public record SweepResult(List<CreditLotRepository.Lot> due, boolean windowFull,
                              int expired, int untouched, int failed, long expiredCredits) {
    }
}
