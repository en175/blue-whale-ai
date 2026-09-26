package com.bluewhale.billing.api.grpc;

import com.bluewhale.billing.application.BalanceView;
import com.bluewhale.billing.application.BillingApplicationService;
import com.bluewhale.billing.application.HoldCommand;
import com.bluewhale.billing.application.QuoteQuery;
import com.bluewhale.billing.application.TransactionView;
import com.bluewhale.billing.catalog.CatalogCompiler;
import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.ledger.HoldResult;
import com.bluewhale.billing.ledger.InsufficientCreditsException;
import com.bluewhale.billing.pricing.BasePriceResolver;
import com.bluewhale.billing.pricing.PricingEngine;
import com.bluewhale.billing.pricing.PricingResult;
import com.bluewhale.billing.pricing.Usage;
import com.bluewhale.contracts.billing.v1.AppliedDiscount;
import com.bluewhale.contracts.billing.v1.BillingServiceGrpc;
import com.bluewhale.contracts.billing.v1.ExpiringLot;
import com.bluewhale.contracts.billing.v1.HoldRequest;
import com.bluewhale.contracts.billing.v1.HoldResponse;
import com.bluewhale.contracts.billing.v1.ListTransactionsRequest;
import com.bluewhale.contracts.billing.v1.ListTransactionsResponse;
import com.bluewhale.contracts.billing.v1.QueryBalanceRequest;
import com.bluewhale.contracts.billing.v1.QueryBalanceResponse;
import com.bluewhale.contracts.billing.v1.QuoteRequest;
import com.bluewhale.contracts.billing.v1.QuoteResponse;
import com.bluewhale.contracts.billing.v1.UserTransaction;
import com.bluewhale.contracts.common.v1.PageResponse;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.List;
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
                    // 展示文案快照：随预留落库，ListTransactions 的消费行直接展示它
                    request.getTitle(),
                    submittedAt,
                    // 规则快照：本条规则的规则体（来自 backend 的能力行）。
                    // **必填**——它是规则的唯一来源（billing 读不到能力行那个库）；
                    // 没带或编不过都是拒单，见 proto 注释
                    request.getRuleSnapshot()));

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

            // ⚠️ **刻意不投影 balance.receivableCredits()**（欠费）：它是平台少收了多少，
            //    不是用户的资产。用户面永远只出现一个金额（《计费逻辑详细设计》§2.3.1）；
            //    欠费只在管理面可见，见 BillingAdminGrpcService#adminQueryBalance。
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
     * 用户可见流水（**一个业务动作一行**）。
     *
     * <p>为什么不是「一条账本分录一行」：账本是复式的，一个动作有多腿（预扣两腿、
     * 结算三腿），直接暴露分录，用户会看到「同一个操作扣了两次」。
     * 投影逻辑与「为什么不漏也不重」见 {@code TransactionRepository} 与
     * {@code TransactionMapper.xml}。
     *
     * <p>⚠️ 金额只有一个字段（{@code amount}），**刻意不投影预扣额**：
     * 落实「任何用户可见界面永远只出现一个金额」。未结算行（{@code status=pending}）
     * 的 {@code amount} 是预扣时算出的**预计消耗**，结算后同一行变成实际消耗——
     * 两个数先后占同一个字段，见 {@link TransactionView}。
     *
     * <p>⚠️ {@code TransactionView} 上**有** {@code reservedCredits}（管理面读它来解释
     * 「余额为什么先降后回」），但这里**一个字都不带**：用户面契约 {@code UserTransaction}
     * 里没有这个字段，加进去等于改一条冻结的契约，用户界面也会出现第二个金额。
     * 与 {@code userId} 同一种处理——上游读得到、这一层不投影。
     */
    @Override
    public void listTransactions(ListTransactionsRequest request,
                                 StreamObserver<ListTransactionsResponse> observer) {
        try {
            TransactionView.Page page = billing.listTransactions(
                    request.getUserId(),
                    request.getTypeFilter(),
                    request.getPage().getPageSize(),
                    request.getPage().getPageToken());

            ListTransactionsResponse.Builder response = ListTransactionsResponse.newBuilder()
                    .setPage(PageResponse.newBuilder().setNextPageToken(page.nextPageToken()));
            for (TransactionView item : page.items()) {
                response.addItems(UserTransaction.newBuilder()
                        .setId(item.id())
                        .setType(item.type())
                        .setDirection(item.direction())
                        .setTitle(item.title())
                        .setAmount(item.amount())
                        .setStatus(item.status())
                        // RFC3339 带时区，与 QueryBalance 同一口径（库内即北京时间）
                        .setCreatedAt(RFC3339.format(item.createdAt().atZone(DbTime.ZONE)))
                        // 契约：仅 done 时非空。未结算没有「结算时刻」这回事
                        .setSettledAt(item.settledAt() == null
                                ? ""
                                : RFC3339.format(item.settledAt().atZone(DbTime.ZONE)))
                        .build());
            }
            observer.onNext(response.build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    /**
     * 报价 —— **只算不扣**。
     *
     * <p>成本上它比 {@code Hold} 轻得多（不锁批次、不写库），所以影子模式可以放心按
     * 每个任务调一次。反过来说：**这里任何一处误写成 Hold，影子期每天都在真冻钱**，
     * 而且冻的钱要到很晚才会被发现（影子期恰恰没人盯着余额）。
     * {@code QuoteIntegrationTest} 里有一条「报价后余额与预留都不变」钉住这点。
     */
    @Override
    public void quote(QuoteRequest request, StreamObserver<QuoteResponse> observer) {
        try {
            Instant pricedAt = Instant.now();
            List<com.bluewhale.contracts.billing.v1.UsageLine> lines = request.getUsageList();

            PricingResult priced;
            long credits;
            if (lines.isEmpty()) {
                // 提交前预览：还不知道真实用量，按契约用量（specs 里那些）算
                priced = billing.quote(new QuoteQuery(
                        request.getUserId(), request.getModelId(), request.getTaskType(),
                        Map.copyOf(request.getSpecs().getAttrsMap()), request.getTier(),
                        Usage.empty(), pricedAt, request.getRuleSnapshot()));
                credits = priced.credits();
            } else {
                // 结算 / 影子对账：按真实用量逐条算再求和
                long total = 0;
                PricingResult first = null;
                for (var line : lines) {
                    PricingResult one = billing.quote(new QuoteQuery(
                            request.getUserId(), line.getModelId(), line.getTaskType(),
                            Map.copyOf(line.getSpecs().getAttrsMap()), request.getTier(),
                            toUsage(line), pricedAt, ruleSnapshotForLine(request, line)));
                    if (first == null) first = one;
                    total += one.credits();
                }
                priced = first;
                credits = total;
            }

            QuoteResponse.Builder response = QuoteResponse.newBuilder()
                    .setCredits(credits)
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

    private static Usage toUsage(com.bluewhale.contracts.billing.v1.UsageLine line) {
        return Usage.ofKeys(line.getModelId(), line.getTaskType(), line.getQuantitiesMap());
    }

    /**
     * 多行用量时，这一行该不该套用请求头部的规则快照。
     *
     * <p>快照是**请求头部那一对 (modelId, taskType)** 的规则体（见 proto：字段在
     * {@code QuoteRequest} 上，不在 {@code UsageLine} 上）。多行用量里若出现别的模型，
     * 拿 A 的规则去算 B 的价会算出一个「看起来合理」的错数，且没有任何信号——
     * 所以只在行与请求头部同键时套用；其余行拿不到快照，**会被拒**（算不出价），
     * 而不是被算成 0 或按别的规则算。
     *
     * <p>⚠️ 实际调用方（backend）发多行用量时（结算 / 影子对账）每条用量行都属于同一个 job、
     * 因而是同一个 (model, taskType)，本判断不会触发出拒单；
     * 它是为「将来一次请求里出现多个模型」留的护栏——那时调用方要逐行发 Quote。
     */
    private static String ruleSnapshotForLine(QuoteRequest request,
                                              com.bluewhale.contracts.billing.v1.UsageLine line) {
        boolean sameKey = line.getModelId().equals(request.getModelId())
                && line.getTaskType().equals(request.getTaskType());
        return sameKey ? request.getRuleSnapshot() : "";
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
                || e instanceof BasePriceResolver.UnpriceableSpecException
                || e instanceof Usage.ContractQuantityUnavailableException
                // 请求带来的规则快照编不过（能力行里那条规则坏了）：与「规则漏配」同一立场——
                // **不能当作免费放行**，要拒绝提交并让运维去修那条规则。
                // 这是第二道闸门：写侧（backend 保存能力行时）拦的是「脏配置存不进去」，
                // 这里拦的是「脏配置已经在库里了」。
                || e instanceof CatalogCompiler.CompileException) {
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
        log.error("billing RPC 内部错误", e);
        return Status.INTERNAL.withDescription("billing 内部错误");
    }
}
