package com.bluewhale.billing.application;

import com.bluewhale.billing.domain.ledger.Reservation;
import com.bluewhale.billing.adapter.outbound.persistence.repository.ReservationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
import java.util.stream.Collectors;

@Component
public class ReservationSweeper {

    private static final Logger log = LoggerFactory.getLogger(ReservationSweeper.class);

    private final ReservationRepository reservations;
    private final CreditService credits;

    private final Duration warnAfter;

    private final Duration releaseAfter;

    private final boolean autoRelease;

    private final int batchSize;

    private final int sampleSize;

    private final String releaseReason;

    public ReservationSweeper(ReservationRepository reservations,
                              CreditService credits,
                              @Value("${billing.reconciliation.sweeper.warn-after:PT2H}") Duration warnAfter,
                              @Value("${billing.reconciliation.sweeper.release-after:PT24H}") Duration releaseAfter,
                              @Value("${billing.reconciliation.sweeper.auto-release:true}") boolean autoRelease,
                              @Value("${billing.reconciliation.sweeper.batch-size:200}") int batchSize,
                              @Value("${billing.reconciliation.sweeper.sample-size:10}") int sampleSize) {
        if (releaseAfter.compareTo(warnAfter) <= 0) {
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

    @Scheduled(fixedDelayString = "${billing.reconciliation.sweeper.fixed-delay:PT10M}",
            initialDelayString = "${billing.reconciliation.sweeper.initial-delay:PT1M}")
    void sweep() {
        try {
            sweepOnce();
        } catch (Exception e) {
            log.error("预留兜底扫描失败：本轮未得出任何结论（**不代表没有超时预留**）", e);
        }
    }

    public SweepResult sweepOnce() {
        List<ReservationRepository.StaleHold> stale =
                reservations.listStaleHeld(warnAfter, batchSize);

        if (!stale.isEmpty()) {
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
            log.warn("预留兜底：已有超过 {}未终态的预留，但自动释放被关闭（billing.reconciliation.sweeper.auto-release=false），"
                    + "这些钱会一直冻着，需要人工处置", humanize(releaseAfter));
        }

        int released = 0;
        int untouched = 0;
        int failed = 0;
        for (ReservationRepository.StaleHold hold : releasable) {
            try {
                credits.refund(hold.jobId(), releaseReason);
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
                log.error("预留兜底释放失败（下一轮会重试）：jobId={} userId={} 冻结={}",
                        hold.jobId(), hold.userId(), hold.reservedCredits(), e);
            }
        }

        if (!stale.isEmpty() || released > 0 || failed > 0) {
            log.info("预留兜底本轮完成：扫描 {} 条超时（阈值 {}），其中超{}的 {} 条 → 释放 {}、无操作 {}、失败 {}",
                    stale.size(), humanize(warnAfter), humanize(releaseAfter), releasable.size(),
                    released, untouched, failed);
        } else {
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

    private static String humanize(Duration duration) {
        if (duration.toMinutes() < 60) {
            return duration.toMinutes() + " 分钟";
        }
        if (duration.toHours() < 48) {
            return duration.toHours() + " 小时";
        }
        return duration.toDays() + " 天";
    }

    public record SweepResult(List<ReservationRepository.StaleHold> stale, boolean windowFull,
                              int released, int untouched, int failed) {
    }
}
