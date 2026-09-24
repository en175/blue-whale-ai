package com.bluewhale.billing.api.grpc;

import com.bluewhale.billing.application.BalanceView;
import com.bluewhale.billing.application.BillingApplicationService;
import com.bluewhale.billing.application.HoldCommand;
import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.ledger.HoldResult;
import com.bluewhale.billing.ledger.InsufficientCreditsException;
import com.bluewhale.billing.pricing.BasePriceResolver;
import com.bluewhale.billing.pricing.PricingEngine;
import com.bluewhale.contracts.billing.v1.BillingServiceGrpc;
import com.bluewhale.contracts.billing.v1.ExpiringLot;
import com.bluewhale.contracts.billing.v1.HoldRequest;
import com.bluewhale.contracts.billing.v1.HoldResponse;
import com.bluewhale.contracts.billing.v1.ListTransactionsRequest;
import com.bluewhale.contracts.billing.v1.ListTransactionsResponse;
import com.bluewhale.contracts.billing.v1.QueryBalanceRequest;
import com.bluewhale.contracts.billing.v1.QueryBalanceResponse;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.Map;

/**
 * {@code billing.v1.BillingService} 的 server 端实现（契约见
 * {@code contracts/proto/billing/v1/billing.proto}）。
 *
 * <p>本类**只做两件事**：proto 类型 ↔ 应用层类型的转换，以及异常 → gRPC status 的映射。
 * 任何判断（该不该打折、余额够不够）都不在这里——否则换个传输层就得重写一遍。
 */
@Service
public class BillingGrpcService extends BillingServiceGrpc.BillingServiceImplBase {

    private static final Logger log = LoggerFactory.getLogger(BillingGrpcService.class);

    private static final DateTimeFormatter RFC3339 = DateTimeFormatter.ISO_OFFSET_DATE_TIME;

    // ⚠️ 错误码是**契约的一部分**（proto 里逐条列了），调用方按它决定 fail closed 的方式。
    //    改这些字面量等于改契约，要同步改 proto 注释与调用方。
    private static final String CODE_INSUFFICIENT_CREDITS = "INSUFFICIENT_CREDITS";
    private static final String CODE_UNPRICEABLE = "UNPRICEABLE";

    private final BillingApplicationService billing;

    public BillingGrpcService(BillingApplicationService billing) {
        this.billing = billing;
    }

    @Override
    public void hold(HoldRequest request, StreamObserver<HoldResponse> observer) {
        try {
            // ⚠️ 时刻在这里取一次，往下传 —— 不在计价/扣减的深处各取一次 now()。
            //    同一个请求里的「现在」必须是同一个值：它同时决定营销活动命不命中
            //    与批次算不算过期，两个值就能算出两种结果。
            Instant submittedAt = Instant.now();

            HoldResult result = billing.hold(new HoldCommand(
                    request.getUserId(),
                    request.getCommandId(),
                    request.getJobId(),
                    request.getModelId(),
                    request.getTaskType(),
                    Map.copyOf(request.getSpecs().getAttrsMap()),
                    request.getTier(),
                    submittedAt));

            observer.onNext(HoldResponse.newBuilder()
                    .setReservedCredits(result.reservedCredits())
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
                    .setAvailableCredits(balance.availableCredits())
                    .setFrozenCredits(balance.frozenCredits());
            for (BalanceView.ExpiringLot lot : balance.expiring()) {
                response.addExpiring(ExpiringLot.newBuilder()
                        .setCredits(lot.credits())
                        // RFC3339 带时区（common/v1/types.proto 的约定：时间不用 unix 秒，
                        // 免时区歧义）。用库内口径（北京时间）渲染，与用户看到的账单一致。
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

    /**
     * ⚠️ <b>尚未实现</b>，刻意返回 UNIMPLEMENTED 而不是空列表。
     *
     * <p>它需要用户可见流水表（{@code billing_user_transactions}）与投影，
     * 那是独立的一刀。返回空列表会让调用方以为「这个用户没有流水」——
     * 用户界面于是显示成「暂无记录」，而真实原因是我们还没做。
     */
    @Override
    public void listTransactions(ListTransactionsRequest request,
                                 StreamObserver<ListTransactionsResponse> observer) {
        observer.onError(Status.UNIMPLEMENTED
                .withDescription("ListTransactions 尚未实现：用户可见流水表与其投影未落地")
                .asRuntimeException());
    }

    /**
     * 异常 → gRPC status。
     *
     * <p>判断顺序从具体到宽泛：{@link InsufficientCreditsException} 是
     * {@link RuntimeException} 但不是 {@link IllegalArgumentException}，
     * 而下面还有个兜 {@code IllegalArgumentException} 的分支——顺序反了就会把
     * 「余额不足」翻译成「参数错误」，调用方据此 fail open。
     */
    private Status toStatus(RuntimeException e) {
        if (e instanceof InsufficientCreditsException) {
            return Status.FAILED_PRECONDITION
                    .withDescription(CODE_INSUFFICIENT_CREDITS + ": " + e.getMessage());
        }
        if (e instanceof PricingEngine.RuleNotFoundException
                || e instanceof BasePriceResolver.UnpriceableSpecException) {
            // 计价配置缺失 = 这次提交算不出价。调用方须**拒绝提交**（fail closed），
            // 不能当作免费放行。对运维是一条明确的「补配置」信号。
            return Status.INVALID_ARGUMENT
                    .withDescription(CODE_UNPRICEABLE + ": " + e.getMessage());
        }
        if (e instanceof IllegalArgumentException) {
            return Status.INVALID_ARGUMENT.withDescription(e.getMessage());
        }
        // ⚠️ 内部错误**不外泄细节**：栈信息可能带库表名、SQL 片段或金额，
        //    只进日志。调用方拿到统一的一句话，靠 traceId 对回去。
        log.error("Hold/QueryBalance 内部错误", e);
        return Status.INTERNAL.withDescription("billing 内部错误");
    }
}
