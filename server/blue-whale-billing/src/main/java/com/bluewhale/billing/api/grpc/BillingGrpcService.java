package com.bluewhale.billing.api.grpc;

import com.bluewhale.billing.common.error.BillingErrorTaxonomy;
import com.bluewhale.billing.infrastructure.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.application.view.BalanceView;
import com.bluewhale.billing.application.BillingApplicationService;
import com.bluewhale.billing.application.command.ChargeCommand;
import com.bluewhale.billing.application.command.QuoteQuery;
import com.bluewhale.billing.application.view.TransactionView;
import com.bluewhale.billing.domain.ledger.ChargeResult;
import com.bluewhale.billing.domain.pricing.PricingResult;
import com.bluewhale.billing.domain.pricing.Usage;
import com.bluewhale.contracts.billing.v1.AppliedDiscount;
import com.bluewhale.contracts.billing.v1.BillingServiceGrpc;
import com.bluewhale.contracts.billing.v1.ChargeRequest;
import com.bluewhale.contracts.billing.v1.ChargeResponse;
import com.bluewhale.contracts.billing.v1.ExpiringLot;
import com.bluewhale.contracts.billing.v1.ListLotsRequest;
import com.bluewhale.contracts.billing.v1.ListLotsResponse;
import com.bluewhale.contracts.billing.v1.ListTransactionsRequest;
import com.bluewhale.contracts.billing.v1.ListTransactionsResponse;
import com.bluewhale.contracts.billing.v1.QueryBalanceRequest;
import com.bluewhale.contracts.billing.v1.QueryBalanceResponse;
import com.bluewhale.contracts.billing.v1.QuoteRequest;
import com.bluewhale.contracts.billing.v1.QuoteResponse;
import com.bluewhale.contracts.billing.v1.SourceCredits;
import com.bluewhale.contracts.billing.v1.UserCreditLot;
import com.bluewhale.contracts.billing.v1.UserTransaction;
import com.bluewhale.contracts.common.v1.PageResponse;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;

@Service
public class BillingGrpcService extends BillingServiceGrpc.BillingServiceImplBase {

    private static final Logger log = LoggerFactory.getLogger(BillingGrpcService.class);

    private static final DateTimeFormatter RFC3339 = DateTimeFormatter.ISO_OFFSET_DATE_TIME;


    private final BillingApplicationService billing;

    public BillingGrpcService(BillingApplicationService billing) {
        this.billing = billing;
    }

    @Override
    public void charge(ChargeRequest request, StreamObserver<ChargeResponse> observer) {
        try {
            LocalDateTime submittedAt = LocalDateTime.now();

            ChargeResult result = billing.charge(new ChargeCommand(
                    request.getUserId(),
                    request.getCommandId(),
                    request.getJobId(),
                    request.getModelId(),
                    request.getTaskType(),
                    Map.copyOf(request.getSpecs().getAttrsMap()),
                    request.getTier(),
                    request.getTitle(),
                    submittedAt,
                    request.getRuleSnapshot()));

            observer.onNext(ChargeResponse.newBuilder()
                    .setChargedCredits(result.chargedCredits())
                    .setCatalogVersion(result.catalogVersion())
                    .setDuplicated(result.duplicated())
                    .build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void queryBalance(QueryBalanceRequest request, StreamObserver<QueryBalanceResponse> observer) {
        try {
            BalanceView balance = billing.balance(request.getUserId());

            QueryBalanceResponse.Builder response = QueryBalanceResponse.newBuilder()
                    .setAvailableCredits(balance.availableCredits());
            for (BalanceView.ExpiringLot lot : balance.expiring()) {
                response.addExpiring(ExpiringLot.newBuilder()
                        .setCredits(lot.credits())
                        .setExpiresAt(RFC3339.format(lot.expiresAt().atZone(ZoneId.systemDefault())))
                        .setSource(lot.source())
                        .build());
            }

            for (BalanceView.SourceCredits item : balance.bySource()) {
                response.addBySource(SourceCredits.newBuilder()
                        .setSource(item.source())
                        .setCredits(item.credits())
                        .build());
            }
            observer.onNext(response.build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void listTransactions(ListTransactionsRequest request,
                                 StreamObserver<ListTransactionsResponse> observer) {
        try {
            List<String> types = request.getTypeFiltersList();

            TransactionView.Page page = billing.listTransactions(
                    request.getUserId(),
                    types,
                    parseBound(request.getCreatedFrom(), "created_from"),
                    parseBound(request.getCreatedTo(), "created_to"),
                    request.getGenerationJobIdsList(),
                    request.getPage().getPageSize(),
                    request.getPage().getPage());

            ListTransactionsResponse.Builder response = ListTransactionsResponse.newBuilder()
                    .setPage(PageResponse.newBuilder().setTotal(page.total()));
            for (TransactionView item : page.items()) {
                UserTransaction.Builder row = UserTransaction.newBuilder()
                        .setId(item.id())
                        .setType(item.type())
                        .setDirection(item.direction())
                        .setTitle(item.title())
                        .setAmount(item.amount())
                        .setStatus(item.status())
                        .setCreatedAt(RFC3339.format(item.createdAt().atZone(ZoneId.systemDefault())))
                        .setSettledAt(item.settledAt() == null
                                ? ""
                                : RFC3339.format(item.settledAt().atZone(ZoneId.systemDefault())));
                if (item.generationJobId() != null) {
                    row.setGenerationJobId(item.generationJobId());
                }
                if (item.chargeState() != null) {
                    row.setChargeState(item.chargeState());
                }
                if (item.lotSource() != null) {
                    row.setLotSource(item.lotSource());
                }
                if (item.lotCreatedAt() != null) {
                    row.setLotCreatedAt(RFC3339.format(item.lotCreatedAt().atZone(ZoneId.systemDefault())));
                }
                response.addItems(row.build());
            }
            observer.onNext(response.build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void listLots(ListLotsRequest request, StreamObserver<ListLotsResponse> observer) {
        try {
            long userId = request.getUserId();
            if (userId <= 0) {
                observer.onError(Status.INVALID_ARGUMENT
                        .withDescription("user_id 必填且必须为正：用户面批次台账没有「不限用户」模式")
                        .asRuntimeException());
                return;
            }

            CreditLotRepository.UserLotPage page = billing.listCreditLots(
                    userId,
                    request.getPage().getPageSize(),
                    request.getPage().getPage(),
                    parseBound(request.getCreatedFrom(), "created_from"),
                    parseBound(request.getCreatedTo(), "created_to"));

            ListLotsResponse.Builder response = ListLotsResponse.newBuilder()
                    .setPage(PageResponse.newBuilder().setTotal(page.total()));
            for (CreditLotRepository.UserLot item : page.items()) {
                UserCreditLot.Builder row = UserCreditLot.newBuilder()
                        .setLotId(String.valueOf(item.id()))
                        .setSource(item.source().key())
                        .setAmount(item.amount())
                        .setRemaining(item.remaining())
                        .setCreatedAt(RFC3339.format(item.createdAt().atZone(ZoneId.systemDefault())))
                        .setExpiresAt(item.expiresAt() == null
                                ? ""
                                : RFC3339.format(item.expiresAt().atZone(ZoneId.systemDefault())))
                        .setBizType(item.bizType())
                        .setBizId(item.bizId());
                response.addItems(row.build());
            }
            observer.onNext(response.build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void quote(QuoteRequest request, StreamObserver<QuoteResponse> observer) {
        try {
            LocalDateTime pricedAt = LocalDateTime.now();

            PricingResult priced = billing.quote(new QuoteQuery(
                    request.getUserId(), request.getModelId(), request.getTaskType(),
                    Map.copyOf(request.getSpecs().getAttrsMap()), request.getTier(),
                    Usage.empty(), pricedAt, request.getRuleSnapshot()));

            QuoteResponse.Builder response = QuoteResponse.newBuilder()
                    .setCredits(priced.credits())
                    .setCatalogVersion(billing.catalogVersion())
                    .setDiscountBp(priced.discount().factorBp());
            for (var applied : priced.appliedDiscounts()) {
                response.addApplied(AppliedDiscount.newBuilder()
                        .setSource(applied.source())
                        .setCode(applied.code() == null ? "" : applied.code())
                        .setFactorBp((int) applied.factorBp())
                        .build());
            }
            observer.onNext(response.build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    private static LocalDateTime parseBound(String raw, String field) {
        if (raw == null || raw.isEmpty()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(raw).atZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime();
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("时间参数须为带偏移的 RFC3339（" + field + "）：" + raw);
        }
    }

    private Status toStatus(RuntimeException e) {
        BillingErrorTaxonomy.Failure failure =
                BillingErrorTaxonomy.classify(e, BillingErrorTaxonomy.Surface.USER);
        if (failure.internal()) {
            log.error("billing RPC 内部错误", e);
        }
        return Status.fromCode(failure.code().grpcCode())
                .withDescription(failure.description());
    }
}
