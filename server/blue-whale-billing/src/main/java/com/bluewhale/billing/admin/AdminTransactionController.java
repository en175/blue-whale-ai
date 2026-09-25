package com.bluewhale.billing.admin;

import com.bluewhale.billing.application.BillingApplicationService;
import com.bluewhale.billing.application.TransactionView;
import com.bluewhale.billing.domain.DbTime;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * 流水的**管理端读接口**（《架构设计》§12）：管理后台的「消费记录」页从这里取数。
 *
 * <h2>为什么不能复用用户面的 {@code ListTransactions}</h2>
 *
 * <p>那条 gRPC 契约（{@code contracts/proto/billing/v1/billing.proto}）的
 * {@code ListTransactionsRequest.user_id} 是**必填**的——它是「用户看自己那份」的接口，
 * 语义就是「把我的账给我」。管理端要的是**全站维度**：某个人单独看，或者所有人一起看。
 *
 * <p>⚠️ 所以**改的不是那条契约**。用户面契约是冻结的：给它加一个「userId 可以不填」
 * 的语义，等于让任何一个拿到了用户 token 的调用者都能拉全站流水——那是个越权洞。
 * 管理面另开一条 HTTP 面（无 gRPC、无 proto 变更），鉴权仍由「端口只在内网」承担，
 * 与 {@link AdminCreditController} 同一立场。
 *
 * <h2>分页为什么还是游标</h2>
 *
 * <p>与用户面**同一个** {@code TransactionRepository.listPage}，所以游标口径完全一致，
 * 也**没有总数**——账本持续追加，总数与游标分页是矛盾的（要准确总数就得扫全表，
 * 而扫完那一刻它又变了）。前端因此只能给「上一页 / 下一页」，不给页码跳转。
 *
 * <h2>不过滤 userId 的代价</h2>
 *
 * <p>⚠️ 三个来源里 **`billing_cost_reservations` 没有 user_id 索引**
 * （只有 `uk_reservation__job` 与 `idx_reservation__status`），所以**那一支现在就是全表扫**——
 * 这是用户面已经付着的成本，不是这次新加的。
 *
 * <p>新加的成本只在**不过滤 userId** 时出现：批次表（`idx_lots__user_expiry`）与账本表
 * （`idx_ledger__user_time`）这两支会因为丢了 user_id 前缀而改成全表扫，再对整个 UNION
 * 做排序取前 N 行。管理端是低频人工查询、且 LIMIT 很小，这个量级可以接受；
 * 要真正优化得先给预留表补 user_id 索引，那是另一次迁移。
 *
 * <p>⚠️ <b>本接口没有鉴权</b>，与 billing 的其它管理面接口相同：它由 backend 经
 * {@code BILLING_ADMIN_URL} 调用，那个端口只在内网、不对公网开放。
 */
@RestController
@RequestMapping("/admin/transactions")
@ConditionalOnProperty(name = "billing.admin.enabled", havingValue = "true")
public class AdminTransactionController {

    /** 与 gRPC 面同一口径（RFC3339 带时区，不用 unix 秒）。 */
    private static final DateTimeFormatter RFC3339 = DateTimeFormatter.ISO_OFFSET_DATE_TIME;

    private final BillingApplicationService billing;

    public AdminTransactionController(BillingApplicationService billing) {
        this.billing = billing;
    }

    /**
     * 区间内**已结算**的实际消耗积分合计（管理端仪表盘的「总使用积分」）。
     *
     * <pre>
     * curl 'localhost:4003/admin/transactions/consumed-credits?from=2026-09-25T00:00:00%2B08:00&amp;to=2026-09-26T00:00:00%2B08:00'
     * </pre>
     *
     * <h2>为什么是一条聚合，而不是让调用方翻页自己累加</h2>
     *
     * <p>见 {@link BillingApplicationService#consumedCredits}：游标分页无总数，翻页中途失败
     * 会得到一个**偏小**的总数——而偏小的总数与真实总数在界面上长得一模一样。
     * 这里在一条 SQL 里算完，要么全对、要么报错。
     *
     * <p>⚠️ 区间是**半开**的 `[from, to)`：`DATETIME` 只到秒，用
     * {@code <= 23:59:59} 表达「到当天为止」会漏掉最后一秒里落库的行。
     * 仪表盘把「今天」表达成 `[今天 00:00, 明天 00:00)`，这个口径由调用方负责算对。
     *
     * <p>⚠️ 只算 {@code settled} 的预留：{@code held} 的钱还冻着、{@code released} 的钱
     * 原样退回，两者都不是消耗。
     *
     * @param from 区间起点（含），RFC3339 带偏移
     * @param to   区间终点（**不含**），RFC3339 带偏移
     * @throws IllegalArgumentException 任一端缺失/无法解析，或起点不早于终点（映射成 400）
     */
    @GetMapping("/consumed-credits")
    public Summary consumedCredits(@RequestParam(name = "from", required = false) String from,
                                   @RequestParam(name = "to", required = false) String to) {
        return new Summary(billing.consumedCredits(parseInstant(from), parseInstant(to)));
    }

    /**
     * RFC3339 → 瞬时。
     *
     * <p>⚠️ 缺省与解析失败都要**报错**，不能在参数缺失时兜一个「最近 24 小时」之类的默认值：
     *    求和接口的区间是调用方算出来的东西，兜底值会让它拿到一个「不是自己要求的那段」
     *    的数，而返回值里没有任何东西能暴露这件事。
     */
    private static Instant parseInstant(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("统计区间参数缺失：from 与 to 都是必填的");
        }
        try {
            return OffsetDateTime.parse(raw).toInstant();
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("无法解析时间参数（须为带偏移的 RFC3339）：" + raw);
        }
    }

    /**
     * 取一页流水（时间倒序）。
     *
     * <pre>
     * curl 'localhost:4003/admin/transactions?userId=9001&amp;pageSize=20'
     * curl 'localhost:4003/admin/transactions?type=consume'   # 全站消费
     * </pre>
     *
     * @param userId    归属用户；**省略 = 全站**（用户面没有这个自由，管理面才有）
     * @param type      类型过滤，空 = 全部；未知类型返回 400 INVALID_ARGUMENT 而**不是**空列表
     *                  （空列表与「真的没有」长得一模一样，见 {@code TransactionType}）
     * @param pageSize  缺省 20、上限 100，由应用层钳制
     * @param pageToken 上一页返回的 {@code nextPageToken}，原样回传；空 = 首页
     */
    @GetMapping
    public Page list(@RequestParam(name = "userId", required = false) Long userId,
                     @RequestParam(name = "type", required = false) String type,
                     @RequestParam(name = "pageSize", required = false) Integer pageSize,
                     @RequestParam(name = "pageToken", required = false) String pageToken) {
        TransactionView.Page page = billing.listTransactions(
                userId, type, pageSize == null ? 0 : pageSize, pageToken);

        List<Item> items = page.items().stream().map(AdminTransactionController::toItem).toList();
        return new Page(items, page.nextPageToken());
    }

    private static Item toItem(TransactionView view) {
        return new Item(
                view.id(),
                view.userId(),
                view.type(),
                view.direction(),
                view.title(),
                view.amount(),
                view.status(),
                RFC3339.format(view.createdAt().atZone(DbTime.ZONE)),
                // 契约口径：仅 done 时非空，未结算没有「结算时刻」这回事
                view.settledAt() == null ? "" : RFC3339.format(view.settledAt().atZone(DbTime.ZONE)));
    }

    /**
     * 一行流水。
     *
     * @param id        形如 {@code lot:12} / {@code res:7} / {@code led:expire:...}，三类来源全局唯一
     * @param userId    归属用户。**这一列是管理面独有的**：契约的 {@code UserTransaction}
     *                  没有它（用户只看自己那份，带了也是冗余）
     * @param amount    整数积分，该行**唯一的金额**（语义随 status：pending = 预计消耗，done = 实际消耗）
     * @param settledAt RFC3339；未结算为空串
     */
    public record Item(String id, long userId, String type, String direction, String title,
                       long amount, String status, String createdAt, String settledAt) {}

    /** @param nextPageToken 空 = 没有下一页 */
    public record Page(List<Item> items, String nextPageToken) {}

    /**
     * 区间内的消耗合计。
     *
     * @param consumedCredits 已结算的实际消耗积分（整数积分，与用户账本同单位）
     */
    public record Summary(long consumedCredits) {}
}
