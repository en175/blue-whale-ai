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

/**
 * {@code billing.v1.BillingAdminService} 的 server 端实现（契约见
 * {@code contracts/proto/billing/v1/billing.proto}）。
 *
 * <h2>本类只做两件事</h2>
 *
 * proto 类型 ↔ 应用层类型的转换，以及异常 → gRPC status 的映射。
 * 这与 {@link BillingGrpcService} 是同一条纪律：任何判断（谁看得见什么、该不该打折）
 * 都不在这里 —— 否则换个传输层就得重写一遍。那 4 个 HTTP controller 本来就是薄壳，
 * 业务逻辑早就在 {@link BillingApplicationService} 与 {@link CatalogHolder} 里，
 * 所以这里是**适配**，不是重写。
 *
 * <h2>与用户面的分工</h2>
 *
 * <p>两个 service 共用 {@link BillingApplicationService}，却投影出**不同的字段集**：
 * 用户面 {@code UserTransaction} 刻意不含 {@code reserved_credits}（「任何用户可见界面
 * 永远只出现一个金额」），而运营面必须有它 —— 用户余额先降 12、后回来 11 的那 11 的
 * 来回，结算后就只剩这一列答得上来。**分界靠的是这里的投影，不是上游少读一列**：
 * 所以 {@code userId} 也是同理 —— {@code TransactionView} 两处都有，用户面不投影它。
 *
 * <h2>错误码与 HTTP 面同名同义</h2>
 *
 * <p>{@code AdminExceptionHandler} 的类注释写着「错误码与 gRPC 侧**同名同义**：
 * 同一个原因在两个传输层给两套码，会让『按码写告警规则』这件事变得没法做」。
 * 本类就是那句话的 gRPC 那一半，所以下面 {@link #toStatus} 的名词与它**逐条对齐**
 * （措辞放在 status description 的 {@code CODE: } 前缀里，与 {@link BillingGrpcService}
 * 同一写法）。
 */
@Service
public class BillingAdminGrpcService extends BillingAdminServiceGrpc.BillingAdminServiceImplBase {

    private static final Logger log = LoggerFactory.getLogger(BillingAdminGrpcService.class);

    /** 与 gRPC 用户面、HTTP 管理面同一口径（RFC3339 带偏移，不用 unix 秒）。 */
    private static final DateTimeFormatter RFC3339 = DateTimeFormatter.ISO_OFFSET_DATE_TIME;

    // 错误码与「异常 → 码」的判定都在 {@link BillingErrorTaxonomy}：三处传输层共用一处定义，
    // 本类不再自持一份码表（此前那份与 AdminExceptionHandler 的逐字相同、靠人肉同步）。

    private final BillingApplicationService billing;
    private final CatalogHolder catalog;

    public BillingAdminGrpcService(BillingApplicationService billing, CatalogHolder catalog) {
        this.billing = billing;
        this.catalog = catalog;
    }

    /**
     * 全站 / 按用户流水（**一个业务动作一行**）。
     *
     * <p>与用户面 {@link BillingGrpcService#listTransactions} 是**同一个应用方法**，
     * 差别只有两处，都在投影上：每行多 {@code user_id} 与 {@code reserved_credits}。
     *
     * <p>⚠️ {@code user_id = 0} 是「**全部用户**」而不是「用户 0」：本仓用户 id 从 1 起，
     * 0 是个不可能被占用的哨兵值。应用层的 {@code userId} 是 {@code Long}，
     * {@code null} 才表示不过滤 —— 转换就在这里，且只在这里。
     */
    @Override
    public void adminListTransactions(AdminListTransactionsRequest request,
                                      StreamObserver<AdminListTransactionsResponse> observer) {
        try {
            // 0 = 全站（见上）。非 0 才按用户过滤。
            Long userId = request.getUserId() == 0L ? null : request.getUserId();

            TransactionView.Page page = billing.listTransactions(
                    userId,
                    request.getType(),
                    request.getPageSize(),
                    request.getPageToken());

            AdminListTransactionsResponse.Builder response = AdminListTransactionsResponse.newBuilder()
                    .setPage(PageResponse.newBuilder().setNextPageToken(page.nextPageToken()));
            for (TransactionView item : page.items()) {
                response.addItems(toItem(item));
            }
            observer.onNext(response.build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    /**
     * 运营面的一行 —— 与用户面 {@code UserTransaction} 同一个读模型，多三列。
     *
     * <p>⚠️ {@code reservedCredits} 与 {@code generationJobId} 都用 proto3 的 {@code optional}
     * 表达 presence，而不是「0 = 没有」：{@code 0} 是「冻了 0 分」/「任务 0」，
     * **缺值**是「这一行压根没有预扣 / 没有任务这回事」（发放行、账本行）。
     * 前端靠这个区别决定显不显示那一行小字 —— 混成一个数就会出现「发放行显示预扣 0」。
     * 所以这里**判空用 {@code != null}，不是真值判断**。
     */
    private static AdminTransactionItem toItem(TransactionView view) {
        AdminTransactionItem.Builder item = AdminTransactionItem.newBuilder()
                .setId(view.id())
                .setUserId(view.userId())
                .setType(view.type())
                .setDirection(view.direction())
                .setTitle(view.title())
                .setAmount(view.amount())
                .setStatus(view.status())
                // RFC3339 带时区，与用户面同一口径（库内即北京时间）
                .setCreatedAt(RFC3339.format(view.createdAt().atZone(DbTime.ZONE)))
                // 契约：仅 done 时非空。未结算没有「结算时刻」这回事
                .setSettledAt(view.settledAt() == null
                        ? ""
                        : RFC3339.format(view.settledAt().atZone(DbTime.ZONE)));
        if (view.reservedCredits() != null) {
            item.setReservedCredits(view.reservedCredits());
        }
        // 消费行的 join key —— 供给 BFF 回自己库查任务语义（类型 / 模型 / 提示词）
        if (view.generationJobId() != null) {
            item.setGenerationJobId(view.generationJobId());
        }
        return item.build();
    }

    /**
     * 某用户的余额、**欠费**与临期批次。
     *
     * <p>与用户面的 {@code QueryBalance} 是同一个应用方法、同一个模型。
     *
     * <p>⚠️ 用户不存在**不是错误**：账本上「查无此人」与「余额为 0」无从区分
     * （没有批次即没有余额），所以走零值返回，而不是 NOT_FOUND。把它判成错误会让
     * 运营在一个刚注册、还没充过值的用户身上看到一个假的故障。
     *
     * <p>⚠️ {@code receivableCredits} **只在这里投影**，用户面一个字都不带 ——
     * 落实「任何用户可见界面永远只出现一个金额」这条硬规则（理由见 proto 该字段的注释）。
     */
    @Override
    public void adminQueryBalance(AdminQueryBalanceRequest request,
                                  StreamObserver<AdminQueryBalanceResponse> observer) {
        try {
            BalanceView balance = billing.balance(request.getUserId());

            AdminQueryBalanceResponse.Builder response = AdminQueryBalanceResponse.newBuilder()
                    .setAvailableCredits(balance.availableCredits())
                    // 冻结的钱还在，只是动不了 —— 可用 + 冻结 = 总资产
                    .setFrozenCredits(balance.frozenCredits())
                    // 欠费：用量已发生、平台没收到的那部分（不是用户的资产，所以不进总资产）
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

    /**
     * 一批用户的「可用 / 累计充值 / 累计消费」（管理端用户列表）。
     *
     * <p>⚠️ 用户不存在**不是错误**，与 {@link #adminQueryBalance} 同一条立场：
     * 账本上「查无此人」与「余额为 0」无从区分（没有批次即没有余额）。响应注释里
     * 因此写着「缺键按 0 渲染」。
     *
     * <p>⚠️ 这是**批量**接口，一次问一页（最多 100 个）。别拿它去逐个问 ——
     * 那正是它存在要消掉的那个 N+1。应用层已保证「请求里的每个 id 都会回一项」，
     * 所以这里只管投影，不必补零。
     *
     * <p>三列的口径（尤其「累计充值只算 purchased 本金」）见 {@code UserStatsView}。
     */
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

    /**
     * 区间内**已结算**的实际消耗积分合计（运营对账用）。
     *
     * <p>⚠️ 区间是**半开**的 {@code [from, to)}：{@code DATETIME} 只到秒，用
     * {@code <= 23:59:59} 表达「到当天为止」会漏掉最后一秒里落库的行。
     * 「今天」由调用方表达成 {@code [今天 00:00, 明天 00:00)}——这个口径调用方负责算对。
     *
     * <p>⚠️ 只算 {@code settled} 的预留：{@code held} 的钱还冻着、{@code released} 的钱
     * 原样退回，两者都**不是**消耗。把在途任务算进消耗额，这个数会随在途单浮动。
     */
    @Override
    public void adminConsumedCredits(AdminConsumedCreditsRequest request,
                                     StreamObserver<AdminConsumedCreditsResponse> observer) {
        try {
            observer.onNext(AdminConsumedCreditsResponse.newBuilder()
                    // 应用层会校验「两端都给、且起点早于终点」并抛 IAE（→ INVALID_ARGUMENT）
                    .setConsumedCredits(billing.consumedCredits(
                            parseInstant("from", request.getFrom()),
                            parseInstant("to", request.getTo())))
                    .build());
            observer.onCompleted();
        } catch (RuntimeException e) {
            observer.onError(toStatus(e).asRuntimeException());
        }
    }

    /**
     * 当前生效的定价目录原文。
     *
     * <p>⚠️ **没有生效目录不是错误**：{@code version} 与 {@code creditsPerYuan} 都是 -1、
     * {@code documentJson} 为空串，原样返回。管理端要在这种情况下显示「还没发布过任何目录」
     * 并让运营从零建一份；判成 NOT_FOUND 会让那个页面直接报错，而它恰恰是**首次上线时
     * 唯一的入口**。
     *
     * <p>⚠️ {@code creditsPerYuan} 不是装饰：backend 的充值路径
     * （{@code fetchCreditsPerYuan}）就是读它来决定「1 元给多少积分」，取不到即停
     * ——它少了或错了，用户看到的积分就没了核对基准。
     */
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

    /**
     * RFC3339（带偏移）→ 瞬时。
     *
     * <p>⚠️ 缺省与解析失败都要**报错**，不能兜一个「最近 24 小时」之类的默认值：
     * 求和接口的区间是调用方算出来的东西，兜底值会让它拿到一个「不是自己要求的那段」的数，
     * 而返回值里没有任何东西能暴露这件事。（HTTP 时代这条纪律写在 {@code AdminTransactionController}
     * 的 {@code parseInstant} 里、靠 Spring 的 400 承担；那个类随读端点迁到 gRPC 已删，
     * 缺参与解析失败改在这里显式判。）
     */
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

    /**
     * 异常 → gRPC status。
     *
     * <p>判定与码表都在 {@link BillingErrorTaxonomy}（三处传输层共用一处定义），
     * 本方法只剩「搬成 gRPC 的 {@link Status}」这件事。分支顺序那条隐性知识也随之收走。
     *
     * <p>⚠️ 本类的 {@link CatalogCompiler.CompileException} 归 {@code INVALID_ARGUMENT}
     * （调用方是运营，提交的**就是**那份文档）；用户面归 {@code UNPRICEABLE}
     * （用户改不了配置，只能换模型）。这个区分是刻意的，现在写在分类器 {@code classify}
     * 里唯一一处，而不是散在两个文件的注释里。
     */
    private Status toStatus(RuntimeException e) {
        BillingErrorTaxonomy.Failure failure =
                BillingErrorTaxonomy.classify(e, BillingErrorTaxonomy.Surface.ADMIN);
        if (failure.internal()) {
            // ⚠️ 内部错误**不外泄细节**：栈信息可能带库表名、SQL 片段或金额，只进日志。
            //    调用方拿到统一的一句话，靠 traceId 对回去（与用户面同一立场）。
            log.error("billing 管理端 RPC 内部错误", e);
        }
        return Status.fromCode(failure.code().grpcCode())
                .withDescription(failure.description());
    }
}
