package com.bluewhale.billing.adapter.inbound.grpc;

import com.bluewhale.billing.adapter.inbound.BillingErrorTaxonomy;
import com.bluewhale.billing.adapter.outbound.persistence.repository.CreditLotRepository;
import com.bluewhale.billing.application.view.BalanceView;
import com.bluewhale.billing.application.BillingApplicationService;
import com.bluewhale.billing.application.command.HoldCommand;
import com.bluewhale.billing.application.command.QuoteQuery;
import com.bluewhale.billing.application.view.TransactionView;
import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.domain.ledger.HoldResult;
import com.bluewhale.billing.domain.pricing.PricingResult;
import com.bluewhale.billing.domain.pricing.Usage;
import com.bluewhale.contracts.billing.v1.AppliedDiscount;
import com.bluewhale.contracts.billing.v1.BillingServiceGrpc;
import com.bluewhale.contracts.billing.v1.ExpiringLot;
import com.bluewhale.contracts.billing.v1.HoldRequest;
import com.bluewhale.contracts.billing.v1.HoldResponse;
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

    // 错误码与「异常 → 码」的判定都在 {@link BillingErrorTaxonomy}：三处传输层共用一处定义。

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

            // 按来源拆开的可用积分。**它不违反上面那条单金额规则**：Σ bySource 逐字等于
            // availableCredits（同一条 SQL 的两种投影），是同一个金额的分项，不是第二个金额。
            // 用户界面「总积分 = 各类型之和」靠的就是这个等式。
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
     *
     * <p>⚠️ {@code generationJobId} 例外地**投影了**（2026-09-30）：它不是金额，而是个
     * join key ——「已消耗」页签要显示任务类型 / 模型 / 提示词，而那些字段在 backend
     * 自己的库里，billing 只能给 id。它与 {@code reservedCredits} 的区别正是这一条：
     * 预扣额会让界面出现第二个金额，任务 id 不会。
     */
    @Override
    public void listTransactions(ListTransactionsRequest request,
                                 StreamObserver<ListTransactionsResponse> observer) {
        try {
            // 多值类型过滤。旧的单值 `type_filter` 已删并 reserve 字段号 ——
            // 新旧端混跑时旧端发的那个值会被这里忽略，表现为**没加过滤 = 多给行**（看得见），
            // 不是「少给行」那种不报错的错。这是可接受的降级方向。
            List<String> types = request.getTypeFiltersList();

            TransactionView.Page page = billing.listTransactions(
                    request.getUserId(),
                    types,
                    request.getPage().getPageSize(),
                    request.getPage().getPage());

            ListTransactionsResponse.Builder response = ListTransactionsResponse.newBuilder()
                    // 用户面**填 total**：列表要显示「共 N 条」与总页数。
                    .setPage(PageResponse.newBuilder().setTotal(page.total()));
            for (TransactionView item : page.items()) {
                UserTransaction.Builder row = UserTransaction.newBuilder()
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
                                : RFC3339.format(item.settledAt().atZone(DbTime.ZONE)));
                // 发放行、过期行没有任务。用 presence 表达「没有」——判空用 != null，
                // 不是真值判断（id 理论上可以为 0，那与「没有任务」是两回事）。
                if (item.generationJobId() != null) {
                    row.setGenerationJobId(item.generationJobId());
                }
                response.addItems(row.build());
            }
            observer.onNext(response.build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    /**
     * 用户的批次台账（积分明细「已获取」页签）。
     *
     * <p>与 {@code listTransactions} 是两个维度：流水「一个业务动作一行」，批次「一笔发放一行」。
     * 到期明细只有这条给得出 —— 流水行没有 {@code expires_at}。
     *
     * <p>⚠️ <b>越权闸</b>：{@code user_id <= 0} 直接拒（INVALID_ARGUMENT），
     * **不是**「返回空页」也不是「查全部」。
     * <ul>
     *   <li>与运营面 {@code AdminListTransactions} 的 {@code user_id = 0 表示全部用户}
     *       <b>是两回事</b>：那个哨兵只开在运营面。用户面这条一个字都不开，
     *       照着那边抄一个「0 = 全站」过来，等于给每个持 token 的调用者开了看全站台账的口子。</li>
     *   <li>为什么是报错而不是空页：调用方（backend）只会填会话解析出来的 id，
     *       那个值恒 &gt; 0。真收到 0 说明**上游写错了或者有人在试探**，
     *       两种都该吵得响，而不是安静地回一页空数据让人以为「这个人没有批次」。</li>
     * </ul>
     */
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
                    request.getPage().getPage());

            ListLotsResponse.Builder response = ListLotsResponse.newBuilder()
                    .setPage(PageResponse.newBuilder().setTotal(page.total()));
            for (CreditLotRepository.UserLot item : page.items()) {
                UserCreditLot.Builder row = UserCreditLot.newBuilder()
                        .setLotId(String.valueOf(item.id()))
                        .setSource(item.source().key())
                        .setAmount(item.amount())
                        .setRemaining(item.remaining())
                        .setCreatedAt(RFC3339.format(item.createdAt().atZone(DbTime.ZONE)))
                        // 契约：空串 = 永久有效（proto3 的 string 没有 null）
                        .setExpiresAt(item.expiresAt() == null
                                ? ""
                                : RFC3339.format(item.expiresAt().atZone(DbTime.ZONE)))
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
     * <p>判定与码表都在 {@link BillingErrorTaxonomy}（三处传输层共用一处定义），
     * 本方法只剩「搬成 gRPC 的 {@link Status}」这件事。
     */
    private Status toStatus(RuntimeException e) {
        BillingErrorTaxonomy.Failure failure =
                BillingErrorTaxonomy.classify(e, BillingErrorTaxonomy.Surface.USER);
        if (failure.internal()) {
            // ⚠️ 内部错误**不外泄细节**：栈信息可能带库表名、SQL 片段或金额，
            //    只进日志。调用方拿到统一的一句话，靠 traceId 对回去。
            log.error("billing RPC 内部错误", e);
        }
        return Status.fromCode(failure.code().grpcCode())
                .withDescription(failure.description());
    }
}
