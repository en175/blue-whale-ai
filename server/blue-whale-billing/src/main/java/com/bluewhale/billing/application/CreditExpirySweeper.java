package com.bluewhale.billing.application;

import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class CreditExpirySweeper {

    private static final Logger log = LoggerFactory.getLogger(CreditExpirySweeper.class);

    private final CreditLotRepository lots;
    private final CreditService credits;

    private final boolean enabled;

    private final int batchSize;

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

    @Scheduled(fixedDelayString = "${billing.expiry.sweep.fixed-delay:PT1H}",
            initialDelayString = "${billing.expiry.sweep.initial-delay:PT1M}")
    void sweep() {
        try {
            sweepOnce();
        } catch (Exception e) {
            log.error("过期核销扫描失败：本轮未核销任何批次（**不代表没有到期的积分**）", e);
        }
    }

    public SweepResult sweepOnce() {
        if (!enabled) {
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
                    untouched++;
                }
            } catch (Exception e) {
                failed++;
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
            log.warn("过期核销本轮取满 {} 条却一条也没核销掉：这些批次的可用量都被冻结占着"
                    + "（或已被并发核销），下一轮仍会取到它们", batchSize);
        } else {
            log.info("过期核销本轮完成：无到期批次");
        }

        return new SweepResult(due, windowFull, expired, untouched, failed, expiredCredits);
    }

    public record SweepResult(List<CreditLotRepository.Lot> due, boolean windowFull,
                              int expired, int untouched, int failed, long expiredCredits) {
    }
}
