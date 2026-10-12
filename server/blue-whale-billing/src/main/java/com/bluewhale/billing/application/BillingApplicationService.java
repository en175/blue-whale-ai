package com.bluewhale.billing.application;

import com.bluewhale.billing.application.command.ChargeCommand;
import com.bluewhale.billing.application.command.QuoteQuery;
import com.bluewhale.billing.application.view.BalanceView;
import com.bluewhale.billing.domain.ledger.TransactionType;
import com.bluewhale.billing.application.view.TransactionView;
import com.bluewhale.billing.application.view.UserStatsView;
import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.domain.ledger.ChargeResult;
import com.bluewhale.billing.infrastructure.persistence.repository.ReservationRepository;
import com.bluewhale.billing.infrastructure.persistence.repository.TransactionRepository;
import com.bluewhale.billing.domain.pricing.AbstractPricingCalculator;
import com.bluewhale.billing.domain.pricing.CompiledRule;
import com.bluewhale.billing.domain.pricing.PricingEngine;
import com.bluewhale.billing.domain.pricing.PricingRequest;
import com.bluewhale.billing.domain.pricing.PricingResult;
import com.bluewhale.billing.domain.pricing.Usage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;











@Service
public class BillingApplicationService {

    private static final Logger log = LoggerFactory.getLogger(BillingApplicationService.class);


    private static final int EXPIRING_LIMIT = 200;






    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;

    private final AbstractPricingCalculator calculator;
    private final CreditService credits;
    private final CreditLotRepository lots;
    private final CatalogHolder catalog;
    private final GrantPolicy grantPolicy;
    private final TransactionRepository transactions;
    private final ReservationRepository reservations;

    public BillingApplicationService(AbstractPricingCalculator calculator,
                                     CreditService credits,
                                     CreditLotRepository lots,
                                     CatalogHolder catalog,
                                     GrantPolicy grantPolicy,
                                     TransactionRepository transactions,
                                     ReservationRepository reservations) {
        this.calculator = calculator;
        this.credits = credits;
        this.lots = lots;
        this.catalog = catalog;
        this.grantPolicy = grantPolicy;
        this.transactions = transactions;
        this.reservations = reservations;
    }











    public long grant(long userId, CreditSource source, long amount,
                      String bizType, String bizId, String grantKey, LocalDateTime expiresAt) {
        LocalDateTime effectiveExpiry = expiresAt != null
                ? expiresAt
                : grantPolicy.expiryFor(source, LocalDateTime.now());
        return credits.grant(userId, source, amount, effectiveExpiry, bizType, bizId, grantKey);
    }



































    public ChargeResult charge(ChargeCommand command) {
        PricingRequest request = new PricingRequest(
                command.userId(), command.modelId(), command.taskType(),
                command.specs(), command.tier());



        CompiledRule snapshot = requireSnapshot(command.ruleSnapshot());
        PricingEngine engine = engineFor(snapshot);

        PricingResult priced = priceAtSubmit(request, engine, snapshot, command.submittedAt());
        int catalogVersion = catalog.currentVersion();

        if (priced.credits() == 0) {


            log.info("计价为 0，不扣款：user={} {}/{} specs={}",
                    command.userId(), command.modelId(), command.taskType(), command.specs());
            return ChargeResult.fresh(0, catalogVersion);
        }

        return credits.charge(command.userId(), command.commandId(), command.jobId(),
                priced.credits(), catalogVersion, priced.discount().factorBp(),

                command.ruleSnapshot(), command.title());
    }


    public int catalogVersion() {
        return catalog.currentVersion();
    }


















    public PricingResult quote(QuoteQuery query) {
        PricingRequest request = new PricingRequest(
                query.userId(), query.modelId(), query.taskType(), query.specs(), query.tier());


        CompiledRule snapshot = requireSnapshot(query.ruleSnapshot());
        PricingEngine engine = engineFor(snapshot);

        if (!query.usage().quantities().isEmpty()) {
            return engine.compute(request, query.usage(), query.pricedAt());
        }

        return priceAtSubmit(request, engine, snapshot, query.pricedAt());
    }






















    private static CompiledRule requireSnapshot(String ruleSnapshot) {
        if (ruleSnapshot == null || ruleSnapshot.isBlank()) {
            throw new CatalogCompiler.CompileException(
                    "缺少规则快照（rule_snapshot）：计价规则住在模型能力行里，"
                            + "billing 读不到那个库，没有快照就算不出价 —— 拒绝，不回落");
        }
        return CatalogCompiler.compileRuleSnapshot(ruleSnapshot);
    }













    private PricingEngine engineFor(CompiledRule snapshot) {
        return new PricingEngine((modelId, taskType) -> snapshot, calculator);
    }














    private PricingResult priceAtSubmit(PricingRequest request, PricingEngine engine,
                                        CompiledRule rule, LocalDateTime at) {
        try {
            return engine.compute(request, Usage.contractFrom(rule, request.specs()), at);
        } catch (Usage.ContractQuantityUnavailableException e) {
            if (e.baseUnit().contractSource() == null || rule.maxCredits() == null) {




                throw e;
            }
            return priceAtCap(request, engine, e, at);
        }
    }



































    private PricingResult priceAtCap(PricingRequest request, PricingEngine engine,
                                     Usage.ContractQuantityUnavailableException cause, LocalDateTime at) {
        PricingResult priced = engine.computeAtCap(request, at);
        log.info("契约用量取不到，改按规则上限扣款：{}/{} 的基准维度 {} 在本次规格里取不到"
                        + "（specs={}）→ 扣款上限 {} 积分。"
                        + "提交时取不到的基准量只能按上限定价；未配上限的模型在这条路径上会直接拒绝提交",
                request.modelId(), request.taskType(), cause.baseUnit().key(),
                request.specs(), priced.credits());
        return priced;
    }














    public BalanceView balance(long userId) {

        var expiring = lots.listExpiring(userId, EXPIRING_LIMIT).stream()
                .map(lot -> new BalanceView.ExpiringLot(
                        lot.remaining(), lot.expiresAt(), lot.source().key()))
                .toList();





        var bySource = lots.availableCreditsBySource(userId).stream()
                .map(item -> new BalanceView.SourceCredits(item.source().key(), item.credits()))
                .toList();

        return new BalanceView(lots.availableCredits(userId), expiring, bySource);
    }













    public String findGrantOwner(String grantKey) {
        return lots.findBizIdByGrantKey(grantKey);
    }




















    public TransactionView.Page listTransactions(Long userId, List<String> typeFilter,
                                                 int pageSize, int page) {
        return listTransactions(userId, typeFilter, null, null, null, pageSize, page);
    }

    public TransactionView.Page listTransactions(Long userId, List<String> typeFilter,
                                                 LocalDateTime createdFrom, LocalDateTime createdTo,
                                                 List<Long> generationJobIds,
                                                 int pageSize, int page) {
        int size = pageSize <= 0 ? DEFAULT_PAGE_SIZE : Math.min(pageSize, MAX_PAGE_SIZE);
        return transactions.listPage(userId, normalizeTypes(typeFilter), createdFrom, createdTo,
                generationJobIds, size, page);
    }










    private static List<String> normalizeTypes(List<String> typeFilter) {
        if (typeFilter == null || typeFilter.isEmpty()) {
            return null;
        }
        List<String> normalized = new ArrayList<>(typeFilter.size());
        for (String raw : typeFilter) {
            String trimmed = raw == null ? "" : raw.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            normalized.add(TransactionType.of(trimmed).key());
        }
        return normalized.isEmpty() ? null : List.copyOf(normalized);
    }
















    public CreditLotRepository.UserLotPage listCreditLots(long userId, int pageSize, int page,
                                                          LocalDateTime createdFrom,
                                                          LocalDateTime createdTo) {
        int size = pageSize <= 0 ? DEFAULT_PAGE_SIZE : Math.min(pageSize, MAX_PAGE_SIZE);
        return lots.listUserLots(userId, createdFrom, createdTo, size, page);
    }

















    public long consumedCredits(LocalDateTime from, LocalDateTime to) {
        if (from == null || to == null) {
            throw new IllegalArgumentException("统计区间必须同时给出 from 与 to");
        }
        if (!from.isBefore(to)) {
            throw new IllegalArgumentException(
                    "统计区间的起点必须早于终点：from=" + from + " to=" + to);
        }

        return reservations.sumChargedCredits(from, to);
    }



















    public Map<Long, UserStatsView> userStats(List<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return Map.of();
        }

        Map<Long, Long> available = lots.availableCreditsOf(userIds);

        Map<Long, Long> recharged = lots.grantedCreditsOf(userIds, CreditSource.PURCHASED);
        Map<Long, Long> consumed = reservations.sumChargedByUser(userIds);


        Map<Long, UserStatsView> result = new LinkedHashMap<>();
        for (Long userId : userIds) {
            result.put(userId, new UserStatsView(
                    available.getOrDefault(userId, 0L),
                    recharged.getOrDefault(userId, 0L),
                    consumed.getOrDefault(userId, 0L)));
        }
        return result;
    }
}
