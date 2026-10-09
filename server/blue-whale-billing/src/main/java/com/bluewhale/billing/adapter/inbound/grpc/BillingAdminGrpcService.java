package com.bluewhale.billing.adapter.inbound.grpc;

import com.bluewhale.billing.adapter.inbound.BillingErrorTaxonomy;
import com.bluewhale.billing.application.view.BalanceView;
import com.bluewhale.billing.application.BillingApplicationService;
import com.bluewhale.billing.application.view.TransactionView;
import com.bluewhale.billing.application.CatalogCompiler;
import com.bluewhale.billing.application.CatalogHolder;
import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.contracts.billing.v1.AdminConsumedCreditsRequest;
import com.bluewhale.contracts.billing.v1.AdminConsumedCreditsResponse;
import com.bluewhale.contracts.billing.v1.AdminExpiringLot;
import com.bluewhale.contracts.billing.v1.AdminGetActiveCatalogRequest;
import com.bluewhale.contracts.billing.v1.AdminGetActiveCatalogResponse;
import com.bluewhale.contracts.billing.v1.AdminListTransactionsRequest;
import com.bluewhale.contracts.billing.v1.AdminListTransactionsResponse;
import com.bluewhale.contracts.billing.v1.AdminQueryBalanceRequest;
import com.bluewhale.contracts.billing.v1.AdminQueryBalanceResponse;
import com.bluewhale.contracts.billing.v1.AdminQueryUserStatsRequest;
import com.bluewhale.contracts.billing.v1.AdminQueryUserStatsResponse;
import com.bluewhale.contracts.billing.v1.AdminTransactionItem;
import com.bluewhale.contracts.billing.v1.AdminUserStats;
import com.bluewhale.contracts.billing.v1.BillingAdminServiceGrpc;
import com.bluewhale.contracts.common.v1.PageResponse;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;

@Service
public class BillingAdminGrpcService extends BillingAdminServiceGrpc.BillingAdminServiceImplBase {

    private static final Logger log = LoggerFactory.getLogger(BillingAdminGrpcService.class);

    private static final DateTimeFormatter RFC3339 = DateTimeFormatter.ISO_OFFSET_DATE_TIME;


    private final BillingApplicationService billing;
    private final CatalogHolder catalog;

    public BillingAdminGrpcService(BillingApplicationService billing, CatalogHolder catalog) {
        this.billing = billing;
        this.catalog = catalog;
    }

    @Override
    public void adminListTransactions(AdminListTransactionsRequest request,
                                      StreamObserver<AdminListTransactionsResponse> observer) {
        try {
            Long userId = request.getUserId() == 0L ? null : request.getUserId();

            TransactionView.Page page = billing.listTransactions(
                    userId,
                    request.getType().isEmpty() ? null : List.of(request.getType()),
                    request.getPageSize(),
                    request.getPage());

            AdminListTransactionsResponse.Builder response = AdminListTransactionsResponse.newBuilder()
                    .setPage(PageResponse.newBuilder().setTotal(page.total()));
            for (TransactionView item : page.items()) {
                response.addItems(toItem(item));
            }
            observer.onNext(response.build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    private static AdminTransactionItem toItem(TransactionView view) {
        AdminTransactionItem.Builder item = AdminTransactionItem.newBuilder()
                .setId(view.id())
                .setUserId(view.userId())
                .setType(view.type())
                .setDirection(view.direction())
                .setTitle(view.title())
                .setAmount(view.amount())
                .setStatus(view.status())
                .setCreatedAt(RFC3339.format(view.createdAt().atZone(DbTime.ZONE)))
                .setSettledAt(view.settledAt() == null
                        ? ""
                        : RFC3339.format(view.settledAt().atZone(DbTime.ZONE)));
        if (view.reservedCredits() != null) {
            item.setReservedCredits(view.reservedCredits());
        }
        if (view.generationJobId() != null) {
            item.setGenerationJobId(view.generationJobId());
        }
        return item.build();
    }

    @Override
    public void adminQueryBalance(AdminQueryBalanceRequest request,
                                  StreamObserver<AdminQueryBalanceResponse> observer) {
        try {
            BalanceView balance = billing.balance(request.getUserId());

            AdminQueryBalanceResponse.Builder response = AdminQueryBalanceResponse.newBuilder()
                    .setAvailableCredits(balance.availableCredits())
                    .setFrozenCredits(balance.frozenCredits())
                    .setReceivableCredits(balance.receivableCredits());
            for (BalanceView.ExpiringLot lot : balance.expiring()) {
                response.addExpiring(AdminExpiringLot.newBuilder()
                        .setCredits(lot.credits())
                        .setExpiresAt(RFC3339.format(lot.expiresAt().atZone(DbTime.ZONE)))
                        .setSource(lot.source())
                        .build());
            }
            observer.onNext(response.build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void adminQueryUserStats(AdminQueryUserStatsRequest request,
                                    StreamObserver<AdminQueryUserStatsResponse> observer) {
        try {
            AdminQueryUserStatsResponse.Builder response = AdminQueryUserStatsResponse.newBuilder();
            billing.userStats(request.getUserIdsList()).forEach((userId, stats) ->
                    response.putStats(userId, AdminUserStats.newBuilder()
                            .setAvailableCredits(stats.availableCredits())
                            .setTotalRecharged(stats.totalRecharged())
                            .setTotalConsumed(stats.totalConsumed())
                            .build()));
            observer.onNext(response.build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void adminConsumedCredits(AdminConsumedCreditsRequest request,
                                     StreamObserver<AdminConsumedCreditsResponse> observer) {
        try {
            observer.onNext(AdminConsumedCreditsResponse.newBuilder()
                    .setConsumedCredits(billing.consumedCredits(
                            parseInstant("from", request.getFrom()),
                            parseInstant("to", request.getTo())))
                    .build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void adminGetActiveCatalog(AdminGetActiveCatalogRequest request,
                                      StreamObserver<AdminGetActiveCatalogResponse> observer) {
        try {
            observer.onNext(AdminGetActiveCatalogResponse.newBuilder()
                    .setDocumentJson(catalog.currentDocumentJson())
                    .setVersion(catalog.currentVersion())
                    .setDocumentHash(String.valueOf(catalog.currentDocumentHash()))
                    .setCreditsPerYuan(catalog.currentCreditsPerYuan())
                    .build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    private static Instant parseInstant(String field, String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("统计区间参数缺失：from 与 to 都是必填的（缺 " + field + "）");
        }
        try {
            return OffsetDateTime.parse(raw).toInstant();
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException(
                    "无法解析时间参数（须为带偏移的 RFC3339）：" + field + "=" + raw);
        }
    }

    private Status toStatus(RuntimeException e) {
        BillingErrorTaxonomy.Failure failure =
                BillingErrorTaxonomy.classify(e, BillingErrorTaxonomy.Surface.ADMIN);
        if (failure.internal()) {
            log.error("billing 管理端 RPC 内部错误", e);
        }
        return Status.fromCode(failure.code().grpcCode())
                .withDescription(failure.description());
    }
}
