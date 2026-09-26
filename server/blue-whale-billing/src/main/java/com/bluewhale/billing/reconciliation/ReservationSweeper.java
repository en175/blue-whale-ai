package com.bluewhale.billing.reconciliation;

import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.Reservation;
import com.bluewhale.billing.ledger.ReservationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.stream.Collectors;

/**
 * ② 预留兜底（《计费逻辑详细设计》§9 层次②）——每 10 分钟扫一次
 * 「{@code status=held} 且长期未终态」的预留。
 *
 * <h2>它为什么是必需的，而不是可选</h2>
 *
 * 结算 / 返全靠 MQ 事件触发，而 RocketMQ 的重投有次数上限（18 次进死信）。
 * 超过上限之后**再没有任何人会去解冻那笔钱**：用户看到「处理中」永不结束，
 * 余额里有一块再也用不了，而所有健康检查都是绿的。billing 扫自己的表，
 * 不依赖 worker / backend / 上游任何一方。
 *
 * <h2>★ 与设计文档的一处正面冲突：billing 看不到 job 表</h2>
 *
 * 文档写的是「查 job 实际状态 → 补 settle / refund」。**这一步 billing 做不到**：
 * 按 ADR-0114 它不共享 backend 的库，{@code generation_jobs} 对它不存在，
 * 它也无权去问（那会把「数据私有」变成一次 RPC 依赖，且 worker 侧还得为此开接口）。
 *
 * <p>所以这里用**持有时间**代替「job 实际状态」，并且明确分两档处置：
 * <ul>
 *   <li><b>超 {@code warn-after}（默认 2h）：只报不动。</b>
 *       2h 足够覆盖正常的 MQ 重投窗口与长任务排队；超过它说明「出事了，但还不能断言是哪种」。
 *       这一档**只打结构化 WARN**（条数 + 前若干条的 jobId/userId/冻结额/持有秒数），
 *       让人能看见、能人工处置。自动动作留给下一档。</li>
 *   <li><b>超 {@code release-after}（默认 24h）：自动释放（走 {@link CreditService#refund}），
 *       并打 WARN。</b>理由是两种可能性都不支持继续冻着：
 *       要么 job 早就终态而事件丢了，要么它永远不会终态。继续冻着 = **用户的钱被永久锁死**，
 *       而这是确定发生的损失；相比之下「极少数丢事件场景下平台少收一笔」是小得多的代价。
 *       24h 也长于任何正常任务与 MQ 重投的总时长。</li>
 * </ul>
 *
 * <h2>为什么自动释放是安全的</h2>
 *
 * <ul>
 *   <li><b>幂等</b>：走的是 {@code CreditService.refund}，它有
 *       {@code refund:{jobId}} 幂等键、{@code FOR UPDATE} 行锁与
 *       「只有 held 才能被释放」的状态判据。与 MQ 回调并发到达时，
 *       只有一个赢——**重复执行不会退两遍钱**。</li>
 *   <li><b>单条一个事务</b>：{@code refund} 是 {@code @Transactional} 的独立 bean，
 *       本类**刻意不加 {@code @Transactional}**——加了就会把一整批释放合成一个巨型事务，
 *       一条失败连坐全部。这里反过来：逐条 try/catch，一条炸了继续下一条。</li>
 *   <li><b>不是扣费路径</b>：跑在 Spring 的调度线程上，与 Hold 的 < 5ms 事务预算无关。</li>
 * </ul>
 *
 * <h2>残留风险（写在类注释里，因为它是个真口子）</h2>
 *
 * 释放之后 job 若**真的**终态了（丢的事件又被补投），结算会因「已 released」而无操作 →
 * 那一单不再收费。这是本策略明码标价的代价，不是 bug。要收缩它只能拿到 job 真实状态，
 * 而那需要一个新的跨服务契约（见上）。
 */
@Component
public class ReservationSweeper {

    private static final Logger log = LoggerFactory.getLogger(ReservationSweeper.class);

    private final ReservationRepository reservations;
    private final CreditService credits;

    /** 超过它 → WARN（不动作）。 */
    private final Duration warnAfter;

    /** 超过它 → 自动释放。 */
    private final Duration releaseAfter;

    /** 自动释放开关（默认开）。关掉后退回「只报不动」，见 application.yml。 */
    private final boolean autoRelease;

    /** 每轮最多处理几条。 */
    private final int batchSize;

    /** 日志里每档最多列几条明细。 */
    private final int sampleSize;

    /** 落进 {@code release_note} 的原因——人工查库时要能一眼分清「兜底释放」与「失败返还」。 */
    private final String releaseReason;

    public ReservationSweeper(ReservationRepository reservations,
                              CreditService credits,
                              @Value("${billing.reconciliation.sweeper.warn-after:PT2H}") Duration warnAfter,
                              @Value("${billing.reconciliation.sweeper.release-after:PT24H}") Duration releaseAfter,
                              @Value("${billing.reconciliation.sweeper.auto-release:true}") boolean autoRelease,
                              @Value("${billing.reconciliation.sweeper.batch-size:200}") int batchSize,
                              @Value("${billing.reconciliation.sweeper.sample-size:10}") int sampleSize) {
        if (releaseAfter.compareTo(warnAfter) <= 0) {
            // 释放阈值必须严格晚于告警阈值：①否则「先告警、后释放」的两档退化成同一档，
            // 人还没来得及看见就已经动了钱；②扫描只跑一次（按告警阈值取数、再按持有秒数
            // 分流释放），这个包含关系是那次优化的前提。启动即失败，别让它悄悄错着跑。
            throw new IllegalStateException(
                    "释放阈值必须大于告警阈值：release-after=" + releaseAfter + " warn-after=" + warnAfter);
        }
        if (batchSize <= 0) {
            throw new IllegalStateException("batch-size 必须为正：" + batchSize);
        }
        this.reservations = reservations;
        this.credits = credits;
        this.warnAfter = warnAfter;
        this.releaseAfter = releaseAfter;
        this.autoRelease = autoRelease;
        this.batchSize = batchSize;
        this.sampleSize = sampleSize;
        this.releaseReason = "超时兜底自动释放：持有超过 " + humanize(releaseAfter)
                + " 未收到终态事件（MQ 重投超限或任务永不终态）";
    }

    /**
     * 定时入口（默认每 10 分钟一轮，启动 1 分钟后先跑一轮以覆盖「重启期间攒下的」）。
     *
     * <p>{@code @Scheduled} 的方法按约定返回 void；本方法只是把
     * {@link #sweepOnce()} 的结果落进日志。测试与将来的管理端「立刻扫一轮」直接调
     * {@code sweepOnce()}——**同一条路径**，不存在「定时那套没测到」。
     */
    @Scheduled(fixedDelayString = "${billing.reconciliation.sweeper.fixed-delay:PT10M}",
            initialDelayString = "${billing.reconciliation.sweeper.initial-delay:PT1M}")
    void sweep() {
        try {
            sweepOnce();
        } catch (Exception e) {
            // 兜底任务自己炸了不能连累下一轮：fixedDelay 的语义是「上一轮结束后再等一个间隔」，
            // 异常会让本轮无结果但不影响下次触发；这里收成日志，不让它冒到线程池。
            log.error("预留兜底扫描失败：本轮未得出任何结论（**不代表没有超时预留**）", e);
        }
    }

    /**
     * 扫一轮并返回本轮结果。**日志由本方法自己打**（定时与手动触发看到的一样）。
     *
     * <p>只做一次取数：按 {@code warnAfter} 取「超时窗口」的预留（最久优先），
     * 再按持有秒数从中分流「只告警」与「要释放」两档。这一次取数成立的原因是构造器
     * 强制了 {@code releaseAfter > warnAfter}——释放集合必然是告警集合的子集，
     * 而排序是「最久的在前」，所以 limit 截断时先丢的只会是较新的那些，不会漏掉该释放的。
     */
    public SweepResult sweepOnce() {
        List<ReservationRepository.StaleHold> stale =
                reservations.listStaleHeld(warnAfter, batchSize);

        if (!stale.isEmpty()) {
            // 结构化明细：条数 + 前若干条的身份与金额。有数字、有对象，
            // 拿到日志的人才能直接去查这几笔，而不是只知道「有一批超时了」。
            log.warn("预留兜底扫描：{} 条 held 已超过 {}未终态（本档只告警、不动钱）{}{}",
                    stale.size(), humanize(warnAfter),
                    stale.size() >= batchSize
                            ? "【本轮取数已达上限 " + batchSize + "，剩下的下一轮继续（按最久优先，不会饥饿）】" : "",
                    "；明细：" + describe(stale));
        }

        long releaseSeconds = releaseAfter.getSeconds();
        List<ReservationRepository.StaleHold> releasable = autoRelease
                ? stale.stream().filter(hold -> hold.heldSeconds() >= releaseSeconds).toList()
                : List.of();

        if (!autoRelease && stale.stream().anyMatch(hold -> hold.heldSeconds() >= releaseSeconds)) {
            // 关掉自动释放时也要说一声：否则「扫描在跑、日志也有」会让人以为钱会自动回去
            log.warn("预留兜底：已有超过 {}未终态的预留，但自动释放被关闭（billing.reconciliation.sweeper.auto-release=false），"
                    + "这些钱会一直冻着，需要人工处置", humanize(releaseAfter));
        }

        int released = 0;
        int untouched = 0;
        int failed = 0;
        for (ReservationRepository.StaleHold hold : releasable) {
            try {
                credits.refund(hold.jobId(), releaseReason);
                // 回读确认**动作真的发生过**：refund 是幂等的，与 MQ 回调并发时可能整轮无操作
                // （对方已结算/已释放）。不回读就会把「无操作」报成「已释放」，
                // 而这条日志正是事后唯一能回答「这笔钱是怎么回去的」的东西。
                if (isReleased(hold.jobId())) {
                    released++;
                    log.warn("预留兜底释放：jobId={} userId={} 冻结={} 已持有 {}{} → 已全额解冻回可用余额",
                            hold.jobId(), hold.userId(), hold.reservedCredits(),
                            humanize(Duration.ofSeconds(hold.heldSeconds())),
                            "（超" + humanize(releaseAfter) + "未终态，按 §9 层次② 兜底）");
                } else {
                    untouched++;
                    log.warn("预留兜底释放跳过：jobId={} userId={} 已被结算或已释放（MQ 回调抢先到达），本轮无操作",
                            hold.jobId(), hold.userId());
                }
            } catch (Exception e) {
                failed++;
                // 逐条兜住：一条失败不能让同批其余的钱继续冻着。下一轮会重扫到它。
                log.error("预留兜底释放失败（下一轮会重试）：jobId={} userId={} 冻结={}",
                        hold.jobId(), hold.userId(), hold.reservedCredits(), e);
            }
        }

        if (!stale.isEmpty() || released > 0 || failed > 0) {
            log.info("预留兜底本轮完成：扫描 {} 条超时（阈值 {}），其中超{}的 {} 条 → 释放 {}、无操作 {}、失败 {}",
                    stale.size(), humanize(warnAfter), humanize(releaseAfter), releasable.size(),
                    released, untouched, failed);
        } else {
            // 全绿的每轮一行：定时任务最怕的不是报错，是**静默没跑**——
            // 有这一行才能从日志回答「它还在跑吗」
            log.info("预留兜底本轮完成：无超过 {}的未终态预留", humanize(warnAfter));
        }

        return new SweepResult(stale, stale.size() >= batchSize, released, untouched, failed);
    }

    private boolean isReleased(long jobId) {
        return reservations.findByJobId(jobId)
                .map(reservation -> reservation.status() == Reservation.Status.RELEASED)
                .orElse(false);
    }

    private String describe(List<ReservationRepository.StaleHold> stale) {
        return stale.stream().limit(sampleSize)
                .map(hold -> "jobId=" + hold.jobId() + " userId=" + hold.userId()
                        + " 冻结=" + hold.reservedCredits() + " 持有=" + hold.heldSeconds() + "s")
                .collect(Collectors.joining(" | "));
    }

    /** 人读的时长（日志与 release_note 用）。 */
    private static String humanize(Duration duration) {
        if (duration.toMinutes() < 60) {
            return duration.toMinutes() + " 分钟";
        }
        if (duration.toHours() < 48) {
            return duration.toHours() + " 小时";
        }
        return duration.toDays() + " 天";
    }

    /**
     * 一轮扫描的结果。
     *
     * <p>它给日志与测试用（「看见了哪些、动了哪些」）；**钱的权威始终是
     * {@code billing_cost_reservations} 的状态**，不是这里的计数——
     * 计数只是「本轮做了什么」的快照，两者不一致时以后者为准。
     *
     * @param stale      超告警阈值的预留（最久在前；可能因 batchSize 被截断）
     * @param windowFull 取数是否已达 batchSize（还有更多没看到）
     * @param released   本轮**确认**释放成功的条数（回读过状态）
     * @param untouched  伸手了但无操作的条数（并发下已被结算/释放抢先）
     * @param failed     释放抛错的条数（下一轮重扫会重试）
     */
    public record SweepResult(List<ReservationRepository.StaleHold> stale, boolean windowFull,
                              int released, int untouched, int failed) {
    }
}
