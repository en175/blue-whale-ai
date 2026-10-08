package com.bluewhale.billing.application;

import com.bluewhale.billing.application.command.SettlementCommand;
import com.bluewhale.billing.application.command.SettlementUsageLine;
import com.bluewhale.billing.domain.ledger.Reservation;
import com.bluewhale.billing.adapter.outbound.persistence.repository.ReservationRepository;
import com.bluewhale.billing.domain.pricing.CompiledRule;
import com.bluewhale.billing.domain.pricing.DiscountResolver;
import com.bluewhale.billing.domain.pricing.MediaPricingCalculator;
import com.bluewhale.billing.domain.pricing.PricingEngine;
import com.bluewhale.billing.domain.pricing.PricingRequest;
import com.bluewhale.billing.domain.pricing.Usage;
import com.bluewhale.billing.domain.pricing.UsageDim;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;

@Service
public class SettlementService {

    private static final Logger log = LoggerFactory.getLogger(SettlementService.class);

    private final ReservationRepository reservations;
    private final CreditService credits;

    public SettlementService(ReservationRepository reservations, CreditService credits) {
        this.reservations = reservations;
        this.credits = credits;
    }

    public void settle(SettlementCommand event) {
        Reservation reservation = reservations.findByJobId(event.jobId()).orElse(null);
        if (reservation == null) {
            log.info("跳过结算：jobId={} 无预留（未预扣的任务，或预扣未落库）", event.jobId());
            return;
        }
        if (!reservation.isPending()) {
            if (reservation.status() == Reservation.Status.RELEASED) {
                log.warn("⚠️ 终态事件晚于兜底释放：jobId={} 预留已按 {} 积分释放，本单**未收费**。"
                                + "若由自动释放造成，说明该 job 的真实耗时超过了释放阈值"
                                + "（billing.reconciliation.sweeper.release-after），需上调阈值或人工补收。",
                        event.jobId(), reservation.reservedCredits());
                return;
            }
            log.info("跳过结算：jobId={} 预留已结算（重复投递）", event.jobId());
            return;
        }

        FrozenRules frozen = rulesAtHoldTime(reservation);
        PricingEngine frozenEngine = engineAtHoldTime(frozen, reservation);
        Instant completedAt = Instant.now();

        long actualCredits;
        if (event.usage().isEmpty()) {
            actualCredits = reservation.reservedCredits();
            if ("partially_succeeded".equals(event.status())) {
                log.warn("部分成功但结算事件未带用量，按全额预扣结算（偏平台）："
                                + "jobId={} 预扣={} 成功槽={}",
                        event.jobId(), actualCredits, event.succeededSlots());
            }
        } else {
            actualCredits = 0;
            for (SettlementUsageLine line : event.usage()) {
                Usage usage = line.toUsage();
                requireBaseUnitReported(frozen, line, usage);
                PricingRequest request = new PricingRequest(
                        event.userId(), line.modelId(), line.taskType(), line.specs(),
                        "free");
                actualCredits += frozenEngine.compute(request, usage, completedAt).credits();
            }
        }

        log.info("结算 jobId={}：预扣 {} 实际 {}（目录 v{}，折扣 {}bp，成功槽 {}，{} 条用量）",
                event.jobId(), reservation.reservedCredits(), actualCredits,
                reservation.catalogVersion(), reservation.discountBp(),
                event.succeededSlots(), event.usage().size());

        credits.settle(event.jobId(), actualCredits);
    }

    private static void requireBaseUnitReported(FrozenRules frozen,
                                                SettlementUsageLine line, Usage usage) {
        CompiledRule rule = frozen.lookup(line.modelId(), line.taskType());
        if (rule == null) {
            return;
        }
        if (rule.baseUnit() == UsageDim.CONSTANT_ONE || usage.quantities().containsKey(rule.baseUnit())) {
            return;
        }
        throw new IllegalStateException("用量行缺少基准维度："
                + line.modelId() + "/" + line.taskType() + " 的规则以 " + rule.baseUnit().key()
                + " 为基准，而 worker 只报了 "
                + usage.quantities().keySet().stream().map(UsageDim::key).toList()
                + " —— 按 0 计价会让这次生成变成免费，故拒绝");
    }

    public void refund(long jobId, String reason) {
        Reservation reservation = reservations.findByJobId(jobId).orElse(null);
        if (reservation == null || !reservation.isPending()) {
            log.info("跳过返还：jobId={} 无待结算预留", jobId);
            return;
        }
        log.info("返还 jobId={}：{} 积分（原因：{}）", jobId, reservation.reservedCredits(), reason);
        credits.refund(jobId, reason);
    }

    private FrozenRules rulesAtHoldTime(Reservation reservation) {
        String snapshotJson = reservation.ruleSnapshot();
        if (snapshotJson == null || snapshotJson.isBlank()) {
            throw new IllegalStateException(
                    "预留行上没有规则快照：jobId=" + reservation.jobId()
                            + "（catalog v" + reservation.catalogVersion() + "）"
                            + " —— 规则住在模型能力行、只在预扣时随请求冻一次，"
                            + "没有快照就无法复现定价，故拒绝结算（不按 0 也不按预扣额蒙）");
        }
        return new FrozenRules(CatalogCompiler.compileRuleSnapshot(snapshotJson));
    }

    private static PricingEngine engineAtHoldTime(FrozenRules frozen, Reservation reservation) {
        DiscountResolver frozenDiscount = DiscountResolver.frozen(reservation.discountBp());
        return new PricingEngine(frozen, new MediaPricingCalculator(frozenDiscount));
    }

    private record FrozenRules(CompiledRule snapshotRule) implements PricingEngine.CatalogLookup {

        @Override
        public CompiledRule lookup(String modelId, String taskType) {
            return snapshotRule;
        }
    }
}
