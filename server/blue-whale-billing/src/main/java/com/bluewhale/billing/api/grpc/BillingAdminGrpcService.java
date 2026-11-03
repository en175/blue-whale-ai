package com.bluewhale.billing.api.grpc;

import com.bluewhale.billing.common.error.BillingErrorTaxonomy;
import com.bluewhale.billing.application.view.BalanceView;
import com.bluewhale.billing.application.BillingApplicationService;
import com.bluewhale.billing.application.CatalogPublisher;
import com.bluewhale.billing.application.CreditService;
import com.bluewhale.billing.application.MemberDiscountAdminService;
import com.bluewhale.billing.application.PromotionAdminService;
import com.bluewhale.billing.application.command.MemberDiscountUpsertCommand;
import com.bluewhale.billing.application.command.PromotionUpsertCommand;
import com.bluewhale.billing.application.view.MemberDiscountView;
import com.bluewhale.billing.application.view.PromotionView;
import com.bluewhale.billing.application.view.TransactionView;
import com.bluewhale.billing.application.CatalogHolder;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.contracts.billing.v1.AdminConsumedCreditsRequest;
import com.bluewhale.contracts.billing.v1.AdminConsumedCreditsResponse;
import com.bluewhale.contracts.billing.v1.AdminDeleteMemberDiscountRequest;
import com.bluewhale.contracts.billing.v1.AdminDeleteMemberDiscountResponse;
import com.bluewhale.contracts.billing.v1.AdminDeletePromotionRequest;
import com.bluewhale.contracts.billing.v1.AdminDeletePromotionResponse;
import com.bluewhale.contracts.billing.v1.AdminExpiringLot;
import com.bluewhale.contracts.billing.v1.AdminGetActiveCatalogRequest;
import com.bluewhale.contracts.billing.v1.AdminGetActiveCatalogResponse;
import com.bluewhale.contracts.billing.v1.AdminGrantRequest;
import com.bluewhale.contracts.billing.v1.AdminGrantResponse;
import com.bluewhale.contracts.billing.v1.AdminListMemberDiscountsRequest;
import com.bluewhale.contracts.billing.v1.AdminListMemberDiscountsResponse;
import com.bluewhale.contracts.billing.v1.AdminListPromotionsRequest;
import com.bluewhale.contracts.billing.v1.AdminListPromotionsResponse;
import com.bluewhale.contracts.billing.v1.AdminListTransactionsRequest;
import com.bluewhale.contracts.billing.v1.AdminListTransactionsResponse;
import com.bluewhale.contracts.billing.v1.AdminMemberDiscount;
import com.bluewhale.contracts.billing.v1.AdminMemberDiscountInput;
import com.bluewhale.contracts.billing.v1.AdminPromotion;
import com.bluewhale.contracts.billing.v1.AdminPromotionInput;
import com.bluewhale.contracts.billing.v1.AdminPublishCatalogRequest;
import com.bluewhale.contracts.billing.v1.AdminPublishCatalogResponse;
import com.bluewhale.contracts.billing.v1.AdminQueryBalanceRequest;
import com.bluewhale.contracts.billing.v1.AdminQueryBalanceResponse;
import com.bluewhale.contracts.billing.v1.AdminQueryUserStatsRequest;
import com.bluewhale.contracts.billing.v1.AdminQueryUserStatsResponse;
import com.bluewhale.contracts.billing.v1.AdminRefundRequest;
import com.bluewhale.contracts.billing.v1.AdminRefundResponse;
import com.bluewhale.contracts.billing.v1.AdminTransactionItem;
import com.bluewhale.contracts.billing.v1.AdminUpsertMemberDiscountRequest;
import com.bluewhale.contracts.billing.v1.AdminUpsertMemberDiscountResponse;
import com.bluewhale.contracts.billing.v1.AdminUpsertPromotionRequest;
import com.bluewhale.contracts.billing.v1.AdminUpsertPromotionResponse;
import com.bluewhale.contracts.billing.v1.AdminUserStats;
import com.bluewhale.contracts.billing.v1.BillingAdminServiceGrpc;
import com.bluewhale.contracts.common.v1.PageResponse;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;

@Service
public class BillingAdminGrpcService extends BillingAdminServiceGrpc.BillingAdminServiceImplBase {

    private static final Logger log = LoggerFactory.getLogger(BillingAdminGrpcService.class);

    private static final DateTimeFormatter RFC3339 = DateTimeFormatter.ISO_OFFSET_DATE_TIME;


    private final BillingApplicationService billing;
    private final CatalogHolder catalog;
    private final CatalogPublisher publisher;
    private final CreditService credits;
    private final PromotionAdminService promotions;
    private final MemberDiscountAdminService memberDiscounts;

    public BillingAdminGrpcService(BillingApplicationService billing,
                                   CatalogHolder catalog,
                                   CatalogPublisher publisher,
                                   CreditService credits,
                                   PromotionAdminService promotions,
                                   MemberDiscountAdminService memberDiscounts) {
        this.billing = billing;
        this.catalog = catalog;
        this.publisher = publisher;
        this.credits = credits;
        this.promotions = promotions;
        this.memberDiscounts = memberDiscounts;
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
                .setStatus(statusOf(view))
                .setCreatedAt(RFC3339.format(view.createdAt().atZone(ZoneId.systemDefault())))
                .setSettledAt(view.settledAt() == null
                        ? ""
                        : RFC3339.format(view.settledAt().atZone(ZoneId.systemDefault())));
        if (view.reservedCredits() != null) {
            item.setReservedCredits(view.reservedCredits());
        }
        if (view.generationJobId() != null) {
            item.setGenerationJobId(view.generationJobId());
        }
        return item.build();
    }

    private static String statusOf(TransactionView view) {
        boolean refunded = view.reservedCredits() != null
                && view.reservedCredits() > 0
                && view.amount() == 0;
        return refunded ? "refunded" : view.status();
    }

    @Override
    public void adminQueryBalance(AdminQueryBalanceRequest request,
                                  StreamObserver<AdminQueryBalanceResponse> observer) {
        try {
            BalanceView balance = billing.balance(request.getUserId());

            AdminQueryBalanceResponse.Builder response = AdminQueryBalanceResponse.newBuilder()
                    .setAvailableCredits(balance.availableCredits());
            for (BalanceView.ExpiringLot lot : balance.expiring()) {
                response.addExpiring(AdminExpiringLot.newBuilder()
                        .setCredits(lot.credits())
                        .setExpiresAt(RFC3339.format(lot.expiresAt().atZone(ZoneId.systemDefault())))
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
                            parseLocalDateTime("from", request.getFrom()),
                            parseLocalDateTime("to", request.getTo())))
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

    @Override
    public void adminGrant(AdminGrantRequest request, StreamObserver<AdminGrantResponse> observer) {
        try {
            if (request.getBizId().isBlank()) {
                throw new IllegalArgumentException("bizId 必填——它是这批积分的来路凭证");
            }
            CreditSource source = CreditSource.of(request.getSource());
            String grantKey = request.getGrantKey().isBlank()
                    ? source.key() + ":" + request.getBizId()
                    : request.getGrantKey();
            String bizType = request.getBizType().isBlank() ? "grant" : request.getBizType();
            AdminGrantResponse.Builder response = AdminGrantResponse.newBuilder();
            try {
                response.setLotId(billing.grant(
                        request.getUserId(),
                        source,
                        request.getAmount(),
                        bizType,
                        request.getBizId(),
                        grantKey,
                        parseExpiry(request.getExpiresAt())));
            } catch (DuplicateKeyException duplicate) {
                response.setDuplicated(true);
                String owner = billing.findGrantOwner(grantKey);
                if (owner != null) {
                    response.setExistingBizId(owner);
                }
            }
            observer.onNext(response.build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void adminRefund(AdminRefundRequest request, StreamObserver<AdminRefundResponse> observer) {
        try {
            credits.refund(request.getJobId(),
                    request.getReason().isBlank() ? "人工释放" : request.getReason());
            observer.onNext(AdminRefundResponse.newBuilder()
                    .setJobId(request.getJobId())
                    .setStatus("refunded")
                    .build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void adminPublishCatalog(AdminPublishCatalogRequest request,
                                    StreamObserver<AdminPublishCatalogResponse> observer) {
        try {
            int version = publisher.publish(
                    request.getDocumentJson(),
                    request.getPublishedBy().isBlank() ? "admin" : request.getPublishedBy(),
                    request.getNote());
            observer.onNext(AdminPublishCatalogResponse.newBuilder()
                    .setCatalogVersion(version)
                    .setDocumentHash(String.valueOf(catalog.currentDocumentHash()))
                    .setCreditsPerYuan(catalog.currentCreditsPerYuan())
                    .build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void adminListPromotions(AdminListPromotionsRequest request,
                                    StreamObserver<AdminListPromotionsResponse> observer) {
        try {
            AdminListPromotionsResponse.Builder response = AdminListPromotionsResponse.newBuilder();
            promotions.list(request.getStatus().isBlank() ? null : request.getStatus())
                    .forEach(view -> response.addItems(toPromotion(view)));
            observer.onNext(response.build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void adminUpsertPromotion(AdminUpsertPromotionRequest request,
                                     StreamObserver<AdminUpsertPromotionResponse> observer) {
        try {
            PromotionUpsertCommand command = toPromotionCommand(request.getInput());
            PromotionView view = request.getId() == 0L
                    ? promotions.create(command,
                            request.getOperator().isBlank() ? "admin" : request.getOperator())
                    : promotions.update(request.getId(), command);
            observer.onNext(AdminUpsertPromotionResponse.newBuilder()
                    .setPromotion(toPromotion(view))
                    .build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void adminDeletePromotion(AdminDeletePromotionRequest request,
                                     StreamObserver<AdminDeletePromotionResponse> observer) {
        try {
            promotions.delete(request.getId());
            observer.onNext(AdminDeletePromotionResponse.newBuilder()
                    .setId(request.getId())
                    .setDeleted(true)
                    .build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void adminListMemberDiscounts(AdminListMemberDiscountsRequest request,
                                         StreamObserver<AdminListMemberDiscountsResponse> observer) {
        try {
            AdminListMemberDiscountsResponse.Builder response =
                    AdminListMemberDiscountsResponse.newBuilder();
            memberDiscounts.list(
                            request.getTier().isBlank() ? null : request.getTier(),
                            request.getStatus().isBlank() ? null : request.getStatus())
                    .forEach(view -> response.addItems(toMemberDiscount(view)));
            observer.onNext(response.build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void adminUpsertMemberDiscount(AdminUpsertMemberDiscountRequest request,
                                          StreamObserver<AdminUpsertMemberDiscountResponse> observer) {
        try {
            MemberDiscountUpsertCommand command = toMemberDiscountCommand(request.getInput());
            MemberDiscountView view = request.getId() == 0L
                    ? memberDiscounts.create(command)
                    : memberDiscounts.update(request.getId(), command);
            observer.onNext(AdminUpsertMemberDiscountResponse.newBuilder()
                    .setDiscount(toMemberDiscount(view))
                    .build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    @Override
    public void adminDeleteMemberDiscount(AdminDeleteMemberDiscountRequest request,
                                          StreamObserver<AdminDeleteMemberDiscountResponse> observer) {
        try {
            memberDiscounts.delete(request.getId());
            observer.onNext(AdminDeleteMemberDiscountResponse.newBuilder()
                    .setId(request.getId())
                    .setDeleted(true)
                    .build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    private static PromotionUpsertCommand toPromotionCommand(AdminPromotionInput input) {
        return new PromotionUpsertCommand(
                input.getCode(),
                input.getName(),
                input.getDiscountBp(),
                new ArrayList<>(input.getModelIdsList()),
                input.getTaskTypesCount() == 0 ? null : new ArrayList<>(input.getTaskTypesList()),
                input.getTierScopeCount() == 0 ? null : new ArrayList<>(input.getTierScopeList()),
                parseWallClock("start_at", input.getStartAt()),
                parseWallClock("end_at", input.getEndAt()),
                parseWallClockTime("daily_time_start", input.getDailyTimeStart()),
                parseWallClockTime("daily_time_end", input.getDailyTimeEnd()),
                input.getDaysOfWeekCount() == 0 ? null : new ArrayList<>(input.getDaysOfWeekList()),
                input.getStatus(),
                input.getPriority());
    }

    private static AdminPromotion toPromotion(PromotionView view) {
        AdminPromotion.Builder builder = AdminPromotion.newBuilder()
                .setId(view.id())
                .setCode(view.code())
                .setName(view.name())
                .setDiscountBp(view.discountBp())
                .addAllModelIds(view.modelIds())
                .setStartAt(view.startAt().toString())
                .setEndAt(view.endAt().toString())
                .setStatus(view.status())
                .setPriority(view.priority())
                .setCreatedBy(view.createdBy())
                .setGmtCreate(view.gmtCreate().toString())
                .setGmtModified(view.gmtModified().toString());
        if (view.taskTypes() != null) {
            builder.addAllTaskTypes(view.taskTypes());
        }
        if (view.tierScope() != null) {
            builder.addAllTierScope(view.tierScope());
        }
        if (view.dailyTimeStart() != null) {
            builder.setDailyTimeStart(view.dailyTimeStart().toString());
        }
        if (view.dailyTimeEnd() != null) {
            builder.setDailyTimeEnd(view.dailyTimeEnd().toString());
        }
        if (view.daysOfWeek() != null) {
            builder.addAllDaysOfWeek(view.daysOfWeek());
        }
        return builder.build();
    }

    private static MemberDiscountUpsertCommand toMemberDiscountCommand(AdminMemberDiscountInput input) {
        return new MemberDiscountUpsertCommand(
                input.getTier(),
                input.getModelPattern(),
                input.getTaskPattern(),
                input.getDiscountBp(),
                input.getPriority(),
                input.getStatus());
    }

    private static AdminMemberDiscount toMemberDiscount(MemberDiscountView view) {
        return AdminMemberDiscount.newBuilder()
                .setId(view.id())
                .setTier(view.tier())
                .setModelPattern(view.modelPattern())
                .setTaskPattern(view.taskPattern())
                .setDiscountBp(view.discountBp())
                .setPriority(view.priority())
                .setStatus(view.status())
                .setGmtCreate(view.gmtCreate().toString())
                .setGmtModified(view.gmtModified().toString())
                .build();
    }

    private static LocalDateTime parseExpiry(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(raw).atZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime();
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("expires_at 须为带偏移的 RFC3339：" + raw);
        }
    }

    private static LocalDateTime parseWallClock(String field, String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return LocalDateTime.parse(raw);
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException(field + " 须为本地日期时间（如 2026-10-01T00:00）：" + raw);
        }
    }

    private static LocalTime parseWallClockTime(String field, String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return LocalTime.parse(raw);
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException(field + " 须为 HH:mm：" + raw);
        }
    }

    private static LocalDateTime parseLocalDateTime(String field, String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("统计区间参数缺失：from 与 to 都是必填的（缺 " + field + "）");
        }
        try {
            return OffsetDateTime.parse(raw).atZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime();
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
