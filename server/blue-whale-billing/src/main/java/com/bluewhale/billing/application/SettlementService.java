package com.bluewhale.billing.application;

import com.bluewhale.billing.catalog.CatalogCompiler;
import com.bluewhale.billing.catalog.CatalogRepository;
import com.bluewhale.billing.infrastructure.mq.JobEventPayload;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.Reservation;
import com.bluewhale.billing.ledger.ReservationRepository;
import com.bluewhale.billing.pricing.DiscountResolver;
import com.bluewhale.billing.pricing.MediaPricingCalculator;
import com.bluewhale.billing.pricing.PricingEngine;
import com.bluewhale.billing.pricing.PricingRequest;
import com.bluewhale.billing.pricing.Usage;
import com.bluewhale.billing.pricing.UsageDim;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 结算与返还（《计费逻辑详细设计》§4.3 / §4.4），由 MQ 事件触发。
 *
 * <h2>为什么结算必须用「冻结的版本 + 冻结的折扣」</h2>
 *
 * 结算发生在预扣之后几分钟到几十分钟，期间运营可能改了价、停了活动。
 * 若按**当前**的目录与折扣重算，就会出现「提交时看到 7 折、结算按原价扣」——
 * 用户认为被多扣了，而系统里没有任何一处记录能证明当时是 7 折。
 *
 * <p>两样东西在预扣时都已冻结在预留行上：
 * <ul>
 *   <li>{@code catalog_version} —— 用哪套计价规则</li>
 *   <li>{@code discount_bp} —— 当时打了多少折</li>
 * </ul>
 * 本类只负责把它们还原出来，**不做任何重新解析**。
 *
 * <h2>actualCredits 从哪来</h2>
 *
 * 事件里带的是 worker 上报的**原始用量**（token / 秒 / 张数），不是积分——
 * 价格是 billing 的事（{@code usage.proto} 的注释）。
 * 所以这里按事件里的用量逐条计价再求和。用量为空时价与预扣相同，
 * 那意味着契约用量就是实际用量（媒介类的常态）。
 */
@Service
public class SettlementService {

    private static final Logger log = LoggerFactory.getLogger(SettlementService.class);

    private final CatalogRepository catalogRepository;
    private final ReservationRepository reservations;
    private final CreditService credits;

    public SettlementService(CatalogRepository catalogRepository,
                             ReservationRepository reservations,
                             CreditService credits) {
        this.catalogRepository = catalogRepository;
        this.reservations = reservations;
        this.credits = credits;
    }

    /**
     * 结算一个已完成的任务。
     *
     * <p>无预留（任务没走过预扣）或预留已终结（重复投递）时是**无操作**，不是错误——
     * MQ 至少一次投递，重复到达是常态。
     *
     * @throws IllegalStateException 目录版本读不回来（数据被删）或计价规则缺失——
     *         **抛出去让 MQ 重投**，不要静默按 0 结算：钱少收比暂时不结算更难发现
     */
    public void settle(JobEventPayload.JobCompleted event) {
        Reservation reservation = reservations.findByJobId(event.jobId()).orElse(null);
        if (reservation == null || !reservation.isPending()) {
            log.info("跳过结算：jobId={} 无待结算预留（未预扣，或已被结算/返还）", event.jobId());
            return;
        }

        PricingEngine frozenEngine = engineAtHoldTime(reservation);
        Instant completedAt = Instant.now();

        long actualCredits;
        if (event.usage().isEmpty()) {
            // ⚠️ 事件没带用量 —— 无法重算，按**预扣额**结算（契约用量即实际用量）。
            //
            // 为什么不能让它算成 0：初次实现是把用量逐条累加，没有用量就是 0，
            // 于是每一个媒介类任务都会被**免费结算**。测试 `结算_用量为空时价与预扣相同`
            // 就是钉这条的。
            //
            // 为什么也不做别的猜测：这是唯一一个「不比契约多收、也不比契约少收」的取值。
            //
            // ⚠️ 残留缺口：对 partially_succeeded 而言这条兜底**偏平台**——
            //    worker 只成功了一部分却没报用量时，用户会被按全额结算。
            //    所以打 WARN 让漏报可观测，而不是默默多收。
            actualCredits = reservation.reservedCredits();
            // ⚠️ **只在部分成功时报警**。worker 按设计对**所有**成功任务都发 `usage: []`
            //    （契约用量即实际用量，见 JobSettlementPublisher 的注释），所以无条件 WARN
            //    等于 100% 的成功结算都带一条告警——真正该看的那条会被淹掉。
            //
            //    只有 partially_succeeded 才是注释里说的那个「偏平台」场景：
            //    只成功了一部分、却没报用量，用户会被按全额结算。
            if ("partially_succeeded".equals(event.status())) {
                log.warn("部分成功但结算事件未带用量，按全额预扣结算（偏平台）："
                                + "jobId={} 预扣={} 成功槽={}",
                        event.jobId(), actualCredits, event.succeededSlots());
            }
        } else {
            actualCredits = 0;
            for (JobEventPayload.UsageLine line : event.usage()) {
                Usage usage = line.toUsage();
                PricingRequest request = new PricingRequest(
                        event.userId(), line.modelId(), line.taskType(), line.specs(),
                        // tier 只在解析折扣时用，而折扣已冻结 —— 这里传什么都不影响结果
                        "free");
                actualCredits += frozenEngine.compute(request, usage, completedAt).credits();
            }
        }

        log.info("结算 jobId={}：预扣 {} 实际 {}（目录 v{}，折扣 {}bp，{} 条用量）",
                event.jobId(), reservation.reservedCredits(), actualCredits,
                reservation.catalogVersion(), reservation.discountBp(), event.usage().size());

        credits.settle(event.jobId(), actualCredits);
    }

    /**
     * 全额返还一个失败的任务。
     *
     * <p>不动 remaining、不新建批次——批次连同有效期原封不动回到可用。
     */
    public void refund(long jobId, String reason) {
        Reservation reservation = reservations.findByJobId(jobId).orElse(null);
        if (reservation == null || !reservation.isPending()) {
            log.info("跳过返还：jobId={} 无待结算预留", jobId);
            return;
        }
        log.info("返还 jobId={}：{} 积分（原因：{}）", jobId, reservation.reservedCredits(), reason);
        credits.refund(jobId, reason);
    }

    /**
     * 还原预扣时的计价环境：**冻结的目录版本 + 冻结的折扣**。
     *
     * <p>{@code loadVersion} 对 retired 版本**必须仍可读**——这正是「改价不影响已提交任务」
     * 的落点。读不回来说明有人在清历史数据，属于严重问题，必须炸出来。
     */
    private PricingEngine engineAtHoldTime(Reservation reservation) {
        CatalogRepository.LoadedCatalog catalog = catalogRepository.loadVersion(reservation.catalogVersion());
        if (catalog == null) {
            throw new IllegalStateException(
                    "目录版本已不存在：v" + reservation.catalogVersion()
                            + "（jobId=" + reservation.jobId() + "）—— 历史版本被删，无法复现定价");
        }
        // 折扣用冻结系数，不重新解析；解析器在这里就只是一个常数
        DiscountResolver frozen = DiscountResolver.frozen(reservation.discountBp());
        return new PricingEngine(
                (modelId, taskType) -> catalog.index().get(CatalogCompiler.indexKey(modelId, taskType)),
                new MediaPricingCalculator(frozen));
    }
}
