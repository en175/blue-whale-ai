package com.bluewhale.billing.adapter.inbound.grpc;

import com.bluewhale.billing.application.CatalogHolder;
import com.bluewhale.billing.application.CreditService;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.contracts.billing.v1.AdminConsumedCreditsRequest;
import com.bluewhale.contracts.billing.v1.AdminGetActiveCatalogRequest;
import com.bluewhale.contracts.billing.v1.AdminGetActiveCatalogResponse;
import com.bluewhale.contracts.billing.v1.AdminListTransactionsRequest;
import com.bluewhale.contracts.billing.v1.AdminListTransactionsResponse;
import com.bluewhale.contracts.billing.v1.AdminQueryBalanceRequest;
import com.bluewhale.contracts.billing.v1.AdminQueryBalanceResponse;
import com.bluewhale.contracts.billing.v1.AdminQueryUserStatsRequest;
import com.bluewhale.contracts.billing.v1.AdminQueryUserStatsResponse;
import com.bluewhale.contracts.billing.v1.AdminTransactionItem;
import com.bluewhale.contracts.billing.v1.BillingAdminServiceGrpc;
import com.bluewhale.contracts.billing.v1.BillingServiceGrpc;
import com.bluewhale.contracts.billing.v1.HoldRequest;
import com.bluewhale.contracts.billing.v1.UserTransaction;
import com.bluewhale.contracts.common.v1.PageRequest;
import com.bluewhale.contracts.common.v1.SpecAttrs;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Server;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@code BillingAdminService} 的**端到端**测试：真库 + 真 gRPC 端口 + 真实的预扣/结算路径。
 *
 * <h2>它替掉的是什么</h2>
 *
 * <p>运营面的这四条（流水 / 余额 / 消耗合计 / 目录）此前只有 HTTP（{@code /admin/**}）。
 * 本次迁到 gRPC 后，HTTP 那边的**读**端点已经删掉（{@code AdminTransactionController} 整个类、
 * {@code AdminCatalogController#active}）——读的这份自此是**唯一**实现，不再是「两份并存」。
 *
 * <p>所以本文件还**接过了那些端点原先的测试覆盖**（类型过滤 / 游标翻页 / 坏游标 /
 * 半开区间边界 / 文档原文的规范化形态）：端点删掉时，它钉住的边界不该跟着消失。
 * 搬过来的每条都注明了它在守什么，别当成重复用例删掉。
 *
 * <h2>三条最要紧的约束</h2>
 *
 * <ol>
 *   <li><b>全站流水必须带 {@code user_id}</b>——{@link #全站流水_每一行都带得回它的主人()}。
 *       这是本次迁移中真正差点漏掉的一条：用户面契约 {@code UserTransaction} 里
 *       **没有**这一列（用户只看自己那份），照抄它的字段清单迁过来，管理端「所有人一起看」
 *       就会渲染出一列没有主人的流水。</li>
 *   <li><b>运营面看得见预扣、用户面看不见</b>——
 *       {@link #预扣额_运营面看得见_用户面一个字都不带()}。这不只是「多一个字段」：
 *       它是这两个契约**必须分开**的全部理由，也是「任何用户可见界面永远只出现一个金额」
 *       这条硬规则的落点。</li>
 *   <li><b>发放行没有预扣额，且是「缺值」不是「0」</b>——
 *       {@link #发放行_没有预扣额_是缺值而不是0()}。{@code 0} 是「冻了 0 分」，
 *       与「这一行压根没有预扣这回事」是两回事；混成一个数，界面上会出现
 *       「发放行显示预扣 0」。</li>
 * </ol>
 *
 * <p>门控与其它集成测试同一口径（{@code BILLING_DB_PASSWORD}）：本切片的价值全在
 * **跨三张表的投影**与**两个契约的差集**上，mock 掉任何一处，测的就只是自己的期望。
 */
@SpringBootTest(properties = {
        "billing.grpc.enabled=true",
        "billing.grpc.port=0"
})
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class BillingAdminGrpcIntegrationTest {

    private static final long USER = 9601L;
    private static final long OTHER_USER = 9602L;
    private static final String MODEL = "seedance-2.5";
    private static final String TASK = "text2video";
    private static final String TITLE = "视频生成 · seedance-2.5 1080p 5s";

    /** 目录：只装换算率与折扣策略（规则住在能力行，随每次 Hold 送来）。 */
    private static final String CATALOG = """
            {"schemaVersion":1,"currency":"CNY","creditsPerYuan":15,
             "discountPolicy":{"stackMode":"multiply","floorFactorBp":3000}}
            """;

    /** 规则快照：单价 100000 mc → 100 积分（mc 只在计价管线内部）。 */
    private static final String RULE = """
            {"baseUnit":"constant:1","basePrice":{"kind":"const","value":100000},
             "unitDenominator":1,"minCredits":1}
            """;

    @Autowired private Server grpcServer;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private CreditService credits;
    @Autowired private CatalogHolder catalog;

    private ManagedChannel channel;
    private BillingAdminServiceGrpc.BillingAdminServiceBlockingStub admin;
    private BillingServiceGrpc.BillingServiceBlockingStub userFacing;

    @BeforeEach
    void setUp() {
        jdbc.update("DELETE FROM billing_ledger_entries");
        jdbc.update("DELETE FROM billing_cost_reservations");
        jdbc.update("DELETE FROM billing_credit_lots");
        jdbc.update("DELETE FROM billing_member_discounts");
        jdbc.update("DELETE FROM billing_promotions");
        jdbc.update("DELETE FROM billing_pricing_catalogs");
        jdbc.update("""
                INSERT INTO billing_pricing_catalogs
                  (catalog_version, status, document, schema_version, document_hash,
                   published_by, published_at, note)
                VALUES (1, 'active', ?, 1, SHA2('v1', 256), 'test', NOW(), '')
                """, CATALOG);
        catalog.reload();

        credits.grant(USER, CreditSource.GIFT, 10_000, null, "grant", "seed", "seed-1");
        credits.grant(OTHER_USER, CreditSource.GIFT, 10_000, null, "grant", "seed", "seed-other");

        channel = ManagedChannelBuilder.forAddress("127.0.0.1", grpcServer.getPort())
                .usePlaintext()
                .build();
        admin = BillingAdminServiceGrpc.newBlockingStub(channel);
        userFacing = BillingServiceGrpc.newBlockingStub(channel);
    }

    @AfterEach
    void tearDown() {
        channel.shutdownNow();
    }

    // ─────────────────────────────────────────────────────────────
    // 全站流水：user_id 是这次迁移差点漏掉的一列
    // ─────────────────────────────────────────────────────────────

    @Test
    void 全站流水_每一行都带得回它的主人() {
        userFacing.hold(hold(USER, "adm-all-1", 9_201L));
        userFacing.hold(hold(OTHER_USER, "adm-all-2", 9_202L));

        // user_id = 0 = 全部用户（本仓用户 id 从 1 起，0 是哨兵值）
        AdminListTransactionsResponse response = admin.adminListTransactions(
                AdminListTransactionsRequest.newBuilder().setUserId(0).setPageSize(50).build());
        List<AdminTransactionItem> items = response.getItemsList();

        // 两次发放 + 两次消费
        assertThat(items).hasSize(4);
        // ★ 关键：不按用户过滤时，每一行都必须自己说明「这是谁的」。
        //   少了这一列，页面上就是一列没有主人的流水，运营回答不了「这笔是谁的」。
        assertThat(items).allSatisfy(item -> assertThat(item.getUserId()).isIn(USER, OTHER_USER));
        // 两个用户各自的消费行确实归到了各自名下（不是全填成同一个数）
        assertThat(items)
                .filteredOn(item -> item.getType().equals("consume"))
                .extracting(AdminTransactionItem::getUserId)
                .containsExactlyInAnyOrder(USER, OTHER_USER);
    }

    @Test
    void 按用户过滤_只出这个人的流水() {
        userFacing.hold(hold(USER, "adm-one-1", 9_203L));
        userFacing.hold(hold(OTHER_USER, "adm-one-2", 9_204L));

        AdminListTransactionsResponse response = admin.adminListTransactions(
                AdminListTransactionsRequest.newBuilder().setUserId(USER).setPageSize(50).build());

        // 本用户：一次发放 + 一次消费
        assertThat(response.getItemsList()).hasSize(2);
        assertThat(response.getItemsList())
                .allSatisfy(item -> assertThat(item.getUserId()).isEqualTo(USER));
    }

    // ─────────────────────────────────────────────────────────────
    // 过滤与游标：参数错了必须报错，而不是给一个「看起来正常」的空列表
    // ─────────────────────────────────────────────────────────────

    /**
     * 未知类型必须报 INVALID_ARGUMENT，不能返回空列表。
     *
     * <p>空列表与「真的没有这个类型的流水」长得一模一样——查的是 {@code "recharg"} 也发现不了。
     * 这条口径由 {@code TransactionType.of} 保证；吞掉异常换成「过滤不到就是空」，运营看到的
     * 会是一张「这个用户没有充值记录」的假报表，而它看上去完全正常。
     */
    @Test
    void 未知类型_报INVALID_ARGUMENT而不是给空列表() {
        assertThatThrownBy(() -> admin.adminListTransactions(
                AdminListTransactionsRequest.newBuilder()
                        .setUserId(USER).setType("recharg").setPageSize(50).build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    /**
     * 合法类型过滤**真的过滤**，只出该类型的行。
     *
     * <p>与上一条是同一件事的两半。只验「未知类型报错」是不够的：把 {@code type} 整个忽略掉
     * （永远返回全部）在上面那条下照样全绿，而管理端「只看消费」的表里会混进发放行。
     */
    @Test
    void 合法类型过滤_只出该类型的行() {
        userFacing.hold(hold(USER, "adm-type-1", 9_212L));

        // setUp 发过一笔 gift，这里一笔消费 —— 两类各一行，过滤才分得开
        List<AdminTransactionItem> consumes = adminListTyped(USER, "consume");
        assertThat(consumes).hasSize(1);
        assertThat(consumes).allSatisfy(item -> assertThat(item.getType()).isEqualTo("consume"));

        List<AdminTransactionItem> gifts = adminListTyped(USER, "gift");
        assertThat(gifts).hasSize(1);
        assertThat(gifts).allSatisfy(item -> assertThat(item.getType()).isEqualTo("gift"));
    }

    /**
     * 游标翻页：每页一条，两次翻完，不重不漏。
     *
     * <p>游标是**不透明**的排序三元组（{@code TransactionRepository}），唯一能证明「翻页真的
     * 接上了」的方式就是拿上一页给的 token 再查一次、并核对第二页不是第一页的重复。
     * 一个写死的 offset 也能让「总数对」的断言全绿，却会在账本持续追加时漏行或重行
     * ——而账本**一直在追加**，这正是这条接口的常态。
     */
    @Test
    void 游标翻页_不重不漏() {
        userFacing.hold(hold(USER, "adm-page-1", 9_213L));

        AdminListTransactionsResponse first = admin.adminListTransactions(
                AdminListTransactionsRequest.newBuilder().setUserId(USER).setPageSize(1).build());
        assertThat(first.getItemsList()).hasSize(1);
        String firstId = first.getItems(0).getId();
        String token = first.getPage().getNextPageToken();
        // 后面还有行时游标必须给出，否则「下一页」按钮永远是灰的
        assertThat(token).isNotEmpty();

        AdminListTransactionsResponse second = admin.adminListTransactions(
                AdminListTransactionsRequest.newBuilder()
                        .setUserId(USER).setPageSize(1).setPageToken(token).build());
        assertThat(second.getItemsList()).hasSize(1);
        assertThat(second.getItems(0).getId()).isNotEqualTo(firstId);
        // 最后一页的游标为空 = 没有下一页
        assertThat(second.getPage().getNextPageToken()).isEmpty();
    }

    /**
     * 坏游标报 INVALID_ARGUMENT，不能悄悄当成首页。
     *
     * <p>「静默重来」在界面上表现为列表**自己跳回顶部**（用户以为翻页翻反了），
     * 而服务端一个异常都不留——排查时无从下手。宁可报错让人看见。
     */
    @Test
    void 坏游标_报INVALID_ARGUMENT而不是当首页() {
        assertThatThrownBy(() -> admin.adminListTransactions(
                AdminListTransactionsRequest.newBuilder()
                        .setUserId(USER).setPageToken("not-a-cursor").build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    // ─────────────────────────────────────────────────────────────
    // 两个契约的差集：预扣额
    // ─────────────────────────────────────────────────────────────

    @Test
    void 预扣额_运营面看得见_用户面一个字都不带() {
        userFacing.hold(hold(USER, "adm-hold-1", 9_205L));
        credits.settle(9_205L, 30);

        // 运营面：消费行上带得出当初冻了多少
        AdminTransactionItem adminRow = rowOf(adminList(USER), "consume");
        assertThat(adminRow.getStatus()).isEqualTo("done");
        // amount 是**最终值**（结算定的 30），预扣的 100 只剩这一列答得上来 ——
        // 用户余额先降 100、后回来 70 的那个来回，解释就在这里
        assertThat(adminRow.getAmount()).isEqualTo(30);
        assertThat(adminRow.hasReservedCredits()).isTrue();
        assertThat(adminRow.getReservedCredits()).isEqualTo(100);

        // 用户面：同一个读模型、同一行，**契约里没有 reserved 这个字段**
        UserTransaction userRow = userFacing.listTransactions(
                        com.bluewhale.contracts.billing.v1.ListTransactionsRequest.newBuilder()
                                .setUserId(USER)
                                .setPage(PageRequest.newBuilder().setPageSize(50).build())
                                .build())
                .getItemsList().stream()
                .filter(item -> item.getType().equals("consume"))
                .findFirst()
                .orElseThrow();
        assertThat(userRow.getAmount()).isEqualTo(30);
        // 用户面上只有这一个金额。「永远只出现一个金额」这条硬规则由**投影**守住 ——
        // UserTransaction 里根本没有第二个字段可填，所以这里能断言的正是「没有」。
        assertThat(userRow.getStatus()).isEqualTo("done");
    }

    @Test
    void 发放行_没有预扣额_是缺值而不是0() {
        AdminTransactionItem grant = rowOf(adminList(USER), "gift");

        // ★ presence 而不是「0 = 没有」：0 是「冻了 0 分」，缺值是「这一行没有预扣这回事」。
        //   混成一个数，界面上会出现「发放行显示预扣 0」这种既不真也无用的信息。
        assertThat(grant.hasReservedCredits()).isFalse();
        assertThat(grant.getAmount()).isEqualTo(10_000);
        assertThat(grant.getUserId()).isEqualTo(USER);
    }

    @Test
    void 消费行_带得出关联的生成任务_发放行是缺值() {
        userFacing.hold(hold(USER, "adm-job-1", 9_207L));
        // 结算换了 amount 与 status，但那一行仍是**同一条预留**（res:{预留id} 不变）——
        // join key 必须跟得住状态转换，否则积分记录页里已结算的行就查不到任务了
        credits.settle(9_207L, 30);

        AdminTransactionItem consume = rowOf(adminList(USER), "consume");
        // ★ 它是给 backend 用的 join key，不是给人看的：任务的类型 / 模型 / 提示词都在
        //   backend 自己的库里（ADR-0114 不共享库，billing 读不到），由管理面 BFF 拿这批
        //   id 回自己库批量查后合并进同一个响应。
        assertThat(consume.hasGenerationJobId()).isTrue();
        assertThat(consume.getGenerationJobId()).isEqualTo(9_207L);

        // 发放不是任务：与 reservedCredits 同一个 presence 口径 —— 是**缺值**，不是「任务 0」
        assertThat(rowOf(adminList(USER), "gift").hasGenerationJobId()).isFalse();
    }

    @Test
    void 未结算的消费行_预扣额仍是预扣时的那个数() {
        userFacing.hold(hold(USER, "adm-pending-1", 9_206L));

        AdminTransactionItem pending = rowOf(adminList(USER), "consume");

        // 未结算时 amount 与 reserved 恰好相等（amount 就是预扣算出的**预计消耗**）——
        // 但这不意味着可以少存一列：结算之后两者就分岔了，上面那条测试正是那一刻。
        assertThat(pending.getStatus()).isEqualTo("pending");
        assertThat(pending.getAmount()).isEqualTo(100);
        assertThat(pending.getReservedCredits()).isEqualTo(100);
        assertThat(pending.getSettledAt()).isEmpty();
    }

    @Test
    void 任务退回的行_管理端也看得见() {
        userFacing.hold(hold(USER, "adm-refund-1", 9_215L));
        credits.refund(9_215L, "任务失败");

        // 这条 SQL 用户面与管理面共用（user_id 为空 = 全站）。退回行从前在**两边**都不出现：
        // 用户看到自己的余额扣了又不见，客服也答不了「这单到底扣没扣钱」。
        //
        // ★ 退回是「结算到 0」，不是另一种类型：行仍是 consumer，金额取终态实际值 0。
        //    管理端靠 reserved_credits 注解（下面那一列）把「冻过多少」补出来 ——
        //    金额是 0 的时候，这一列是「扣了多少」唯一的答案。
        List<AdminTransactionItem> consumes = adminListTyped(USER, "consume");
        assertThat(consumes).hasSize(1);

        AdminTransactionItem refund = consumes.get(0);
        assertThat(refund.getUserId()).isEqualTo(USER);
        assertThat(refund.getDirection()).isEqualTo("out");
        assertThat(refund.getStatus()).isEqualTo("done");
        assertThat(refund.getAmount()).isEqualTo(0);
        assertThat(refund.getReservedCredits()).isEqualTo(100);
        assertThat(refund.getSettledAt()).isNotEmpty();

        // refund 这条路径已经没有来源了（预留表不再产它），查它永远是空页
        assertThat(adminListTyped(USER, "refund")).isEmpty();
    }

    // ─────────────────────────────────────────────────────────────
    // 消耗合计：只算 settled
    // ─────────────────────────────────────────────────────────────

    @Test
    void 消耗合计_只算已结算的_在途的预扣不算() {
        Instant from = Instant.now().minus(1, ChronoUnit.HOURS);
        Instant to = Instant.now().plus(1, ChronoUnit.HOURS);

        // 预扣但没结算：钱冻着，不是消耗
        userFacing.hold(hold(USER, "adm-cc-1", 9_207L));
        assertThat(consumed(from, to)).isZero();

        // 结算 30：这一笔才算消耗
        credits.settle(9_207L, 30);
        assertThat(consumed(from, to)).isEqualTo(30);

        // 再来一笔在途的，合计**不随之浮动**：把「可能消耗」算进消耗额，
        // 这个数会用在途任务的数量变化，而对账要的是一个定值
        userFacing.hold(hold(OTHER_USER, "adm-cc-2", 9_208L));
        assertThat(consumed(from, to)).isEqualTo(30);

        // 完全落在过去一天的窗口里**查不到这笔**（它发生在今天）：区间不只是「有没有过滤」，
        // 还得落在对的地方。取错列（比如 gmt_create）或漏掉下界，这里都会把 30 漏出来
        assertThat(consumed(Instant.now().minus(2, ChronoUnit.DAYS),
                Instant.now().minus(1, ChronoUnit.DAYS))).isZero();
    }

    /**
     * 半开区间 {@code [from, to)}：**正好落在起点的那秒算、正好落在终点的那秒不算**。
     *
     * <p>区间列是 {@code gmt_modified}（这张表没有 {@code settled_at}，结算那一刻由 DDL 的
     * {@code ON UPDATE CURRENT_TIMESTAMP} 写在它上面）。写成 {@code <= '23:59:59'} 表达
     * 「到当天为止」会漏掉最后一秒里落库的行，而漏掉的那部分**不会以任何形式表现出来**：
     * 对账数字偏小，偏小的数与真值在界面上长得一模一样。
     *
     * <p>直插预留行（而不走 hold/settle）是因为要验的正是**边界**——真实路径没法把
     * {@code gmt_modified} 设到指定的那一秒上。
     */
    @Test
    void 消耗合计_半开区间且只算已结算() {
        Instant from = OffsetDateTime.parse("2026-09-25T00:00:00+08:00").toInstant();
        Instant to = OffsetDateTime.parse("2026-09-26T00:00:00+08:00").toInstant();

        insertReservation(9_301L, "settled", 1L, "2026-09-24 23:59:59"); // 区间前：不计
        insertReservation(9_302L, "settled", 2L, "2026-09-25 00:00:00"); // = from：**计**
        insertReservation(9_303L, "settled", 4L, "2026-09-25 23:59:59"); // 区间内：计
        insertReservation(9_304L, "settled", 8L, "2026-09-26 00:00:00"); // = to：**不计**
        insertReservation(9_305L, "held", null, "2026-09-25 12:00:00"); // 冻着的钱不是消耗
        insertReservation(9_306L, "released", 0L, "2026-09-25 12:00:00"); // 退回的钱不是消耗

        assertThat(consumed(from, to)).isEqualTo(6);
    }

    @Test
    void 消耗合计_缺参数或区间反了_报INVALID_ARGUMENT而不是当0() {
        Instant now = Instant.now();

        // 缺一端
        assertThatThrownBy(() -> admin.adminConsumedCredits(
                AdminConsumedCreditsRequest.newBuilder()
                        .setFrom(now.minus(1, ChronoUnit.HOURS).toString()).build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));

        // 解析不了的时间串：**不能兜一个「最近 24 小时」之类的默认区间**——
        // 兜底会让调用方拿到一段「不是自己要求的那段」的数，而返回值里没有任何东西暴露这件事
        assertThatThrownBy(() -> admin.adminConsumedCredits(
                AdminConsumedCreditsRequest.newBuilder()
                        .setFrom("不是时间").setTo(now.toString()).build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));

        // 区间反了：反向区间求和得到 0，与「这段时间真的没有消耗」长得一模一样 ——
        // 所以必须报错，不能静默返回 0
        assertThatThrownBy(() -> admin.adminConsumedCredits(
                AdminConsumedCreditsRequest.newBuilder()
                        .setFrom(now.toString())
                        .setTo(now.minus(1, ChronoUnit.HOURS).toString())
                        .build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    // ─────────────────────────────────────────────────────────────
    // 余额 / 目录
    // ─────────────────────────────────────────────────────────────

    @Test
    void 余额_冻结与可用分开报() {
        userFacing.hold(hold(USER, "adm-bal-1", 9_209L));

        AdminQueryBalanceResponse balance = admin.adminQueryBalance(
                AdminQueryBalanceRequest.newBuilder().setUserId(USER).build());

        // 预扣 100：钱从可用挪到冻结，总资产不变 —— 可用 + 冻结 = 总资产
        assertThat(balance.getAvailableCredits()).isEqualTo(9_900);
        assertThat(balance.getFrozenCredits()).isEqualTo(100);
    }

    @Test
    void 余额_从没见过的用户是零值而不是错误() {
        // 账本上「查无此人」与「余额为 0」无从区分（没有批次即没有余额）。
        // 判成 NOT_FOUND 会让运营在一个刚注册的用户身上看到一个假的故障。
        AdminQueryBalanceResponse balance = admin.adminQueryBalance(
                AdminQueryBalanceRequest.newBuilder().setUserId(9_999L).build());

        assertThat(balance.getAvailableCredits()).isZero();
        assertThat(balance.getFrozenCredits()).isZero();
        assertThat(balance.getExpiringList()).isEmpty();
        assertThat(balance.getReceivableCredits())
                .as("查无此人也没有欠费 —— 与「余额为 0」同口径，不是另一个哨兵值")
                .isZero();
    }

    /**
     * ★ 欠费**只在管理面可见**，且它就是账本应收那一笔。
     *
     * <p>这是本仓「先欠费」产品口径落地后欠费的**唯一出口**：此前超出预扣的部分只以一条
     * 借 {@code RECEIVABLE} 的分录躺在账本里，全仓没有任何代码读它 —— 欠了多少钱只有翻账本
     * 能看见。产品已确认不收款、不封禁、不拦截，所以「可见」就是这一条的全部。
     *
     * <p>⚠️ 用户面 {@code QueryBalanceResponse} 里**没有**这个字段（契约层面就没有），
     * 所以这里没有「用户面断言不出它」这一说 —— 那是编译期事实，不是运行期性质。
     * 用户面能断言的只有它自己那两个数没被影响。
     */
    @Test
    void 欠费_只在管理面可见_且用户实扣仍是预扣额() {
        // 预扣 100、实际 130 —— 超出的 30 分平台先垫着记应收
        userFacing.hold(hold(USER, "adm-recv-1", 9_213L));
        credits.settle(9_213L, 130);

        AdminQueryBalanceResponse balance = admin.adminQueryBalance(
                AdminQueryBalanceRequest.newBuilder().setUserId(USER).build());

        assertThat(balance.getReceivableCredits())
                .as("管理端必须看得见这笔欠费（= 实际 − 预扣 = 130 − 100）")
                .isEqualTo(30);
        // 欠费不是用户的资产：它不进「可用」，也不进「冻结」——
        // 总资产的等式仍然是 可用 + 冻结，用户实际被扣走的还是预扣的 100
        assertThat(balance.getAvailableCredits())
                .as("用户实扣仍只有预扣额 100：10000 − 100")
                .isEqualTo(9_900);
        assertThat(balance.getFrozenCredits()).isZero();

        // 没超扣过的用户读出来是 0，而不是「查不到」的另一个值
        assertThat(admin.adminQueryBalance(AdminQueryBalanceRequest.newBuilder()
                        .setUserId(OTHER_USER).build()).getReceivableCredits())
                .as("没超扣过的用户是 0")
                .isZero();
    }

    @Test
    void 目录_回原文与换算率_充值路径靠它() throws Exception {
        AdminGetActiveCatalogResponse active = admin.adminGetActiveCatalog(
                AdminGetActiveCatalogRequest.getDefaultInstance());

        assertThat(active.getVersion()).isEqualTo(1);
        // ★ 换算率不是装饰：backend 的充值路径（fetchCreditsPerYuan）读它决定
        //   「1 元给多少积分」，取不到即停 —— 少了这个字段，用户看到的积分就没了核对基准
        assertThat(active.getCreditsPerYuan()).isEqualTo(15);
        assertThat(active.getDocumentHash()).isNotEmpty();

        // ⚠️ 原文是 MySQL JSON 列的**规范化形态**：键序与空白都由 MySQL 决定，与插入时那串
        //    字节不同 —— 这条断言当场就能看见：setUp 插的是紧凑的 `"creditsPerYuan":15`，
        //    读回来是带空格的 `"creditsPerYuan": 15`。
        //    所以判「内容改没改」只能**解析回来比**（比文本会让一次没改过的保存凭空多出版本，
        //    proto 的注释写了这条）；而管理端「读当前 → 改 → 整份发布」就是靠这段原文本起步的，
        //    它必须真的是**库里那份**，而不是解析后重新序列化的形态。
        ObjectMapper mapper = new ObjectMapper();
        assertThat(mapper.readTree(active.getDocumentJson())).isEqualTo(mapper.readTree(CATALOG));
        // 反例当场钉住：这段文本与发上去的字节**不相等**，`documentHash` 取的又是提交文本的
        // SHA-256（与它也不对应）—— 谁想用「比对文本」判断有没有改过，这里就是反例
        assertThat(active.getDocumentJson()).isNotEqualTo(CATALOG);
    }

    // ─────────────────────────────────────────────────────────────
    // 与用户面同源：同一个应用方法、同一批数据
    // ─────────────────────────────────────────────────────────────

    @Test
    void 两面同源_同一批动作在两边的行数与金额一致() {
        userFacing.hold(hold(USER, "adm-same-1", 9_210L));
        userFacing.hold(hold(USER, "adm-same-2", 9_211L));

        List<AdminTransactionItem> adminRows = adminList(USER);
        List<UserTransaction> userRows = userFacing.listTransactions(
                        com.bluewhale.contracts.billing.v1.ListTransactionsRequest.newBuilder()
                                .setUserId(USER)
                                .setPage(PageRequest.newBuilder().setPageSize(50).build())
                                .build())
                .getItemsList();

        // 同一批业务动作 → 行数与金额逐条相同（差集只在 user_id / reserved_credits 两列上，
        // 那是**投影**的差别，不是两份读模型算出了两个答案）
        assertThat(adminRows).hasSameSizeAs(userRows);
        assertThat(adminRows.stream().map(AdminTransactionItem::getId).toList())
                .containsExactlyElementsOf(userRows.stream().map(UserTransaction::getId).toList());
        assertThat(adminRows.stream().map(AdminTransactionItem::getAmount).toList())
                .containsExactlyElementsOf(userRows.stream().map(UserTransaction::getAmount).toList());
    }

    // ─────────────────────────────────────────────────────────────
    // 批量三列：管理端用户列表的「余额 / 累计充值 / 累计消费」
    // ─────────────────────────────────────────────────────────────

    /**
     * ★ 一次问一批，三列各归各的主人，且**查无此人回一项全 0**。
     *
     * <p>这条接口存在的理由是消掉列表页的 N+1（一页 100 个用户，逐个调
     * {@code AdminQueryBalance} 就是 100 次跨进程往返）。所以断言的重点不只是
     * 「数字对不对」，还有**一次调用同时答完所有人**——包括那个什么都没做过的，
     * 他也要在结果里，而不是缺键（缺键会让调用方把「没这个人」当成一次失败）。
     */
    @Test
    void 批量三列_一次问一批_各归各的且查无此人是0() {
        // USER：充值本金 500 + 充值赠送 100，再消费掉 30
        credits.grant(USER, CreditSource.PURCHASED, 500, null, "recharge", "r-1", "gk-1");
        credits.grant(USER, CreditSource.BONUS, 100, null, "recharge", "r-1", "gk-2");
        userFacing.hold(hold(USER, "adm-batch-1", 9_401L));
        credits.settle(9_401L, 30);

        AdminQueryUserStatsResponse response = admin.adminQueryUserStats(
                AdminQueryUserStatsRequest.newBuilder()
                        .addAllUserIds(List.of(USER, OTHER_USER, 9_999L))
                        .build());

        assertThat(response.getStatsMap()).containsOnlyKeys(USER, OTHER_USER, 9_999L);

        // setUp 发过 10000 gift；预扣 100 后结算实扣 30 → 可用 = 10000 + 500 + 100 − 30
        assertThat(response.getStatsOrThrow(USER).getAvailableCredits()).isEqualTo(10_570);
        // ★ 累计充值只算 purchased 本金 500，**不含**充值赠送的 100：
        //   这一列问的是「用户自己充了多少钱」，把赠送折进去运营就对不上营收了
        assertThat(response.getStatsOrThrow(USER).getTotalRecharged()).isEqualTo(500);
        assertThat(response.getStatsOrThrow(USER).getTotalConsumed()).isEqualTo(30);

        // 另一个用户只有 setUp 那 10000 gift：没充值、没消费 —— 各归各的，没串号
        assertThat(response.getStatsOrThrow(OTHER_USER).getAvailableCredits()).isEqualTo(10_000);
        assertThat(response.getStatsOrThrow(OTHER_USER).getTotalRecharged()).isZero();
        assertThat(response.getStatsOrThrow(OTHER_USER).getTotalConsumed()).isZero();

        // 查无此人回一项全 0：账本上它与「余额为 0」无从区分，不是另一种哨兵值
        assertThat(response.getStatsOrThrow(9_999L).getAvailableCredits()).isZero();
        assertThat(response.getStatsOrThrow(9_999L).getTotalRecharged()).isZero();
    }

    /**
     * 批量那一列的「可用」与单人 {@code AdminQueryBalance} **逐字相同**。
     *
     * <p>两条 rpc 各有一条 SQL，谓词是刻意复制的（只多一个 {@code user_id IN}）。
     * 今天它们相等是构造出来的，但**没有任何东西挡着后来的人只改一处** —— 那时
     * 运营会在列表上看到一个余额、点进详情看到另一个，而两边都不报错。这条就是那个挡板。
     */
    @Test
    void 批量三列的可用_与单人余额是同一个数() {
        credits.grant(USER, CreditSource.PURCHASED, 500, null, "recharge", "r-2", "gk-3");
        userFacing.hold(hold(USER, "adm-batch-2", 9_402L));

        long fromBatch = admin.adminQueryUserStats(AdminQueryUserStatsRequest.newBuilder()
                        .addUserIds(USER).build())
                .getStatsOrThrow(USER).getAvailableCredits();
        long fromSingle = admin.adminQueryBalance(AdminQueryBalanceRequest.newBuilder()
                        .setUserId(USER).build()).getAvailableCredits();

        assertThat(fromBatch).as("列表页与详情页显示的余额").isEqualTo(fromSingle);
    }

    /**
     * 空请求回空表，**不能报错**。
     *
     * <p>应用层据此早返回：空集合拼进 {@code IN ()} 是 SQL 语法错误，会以一个 INTERNAL
     * 冒出来 —— 而「这一页一个用户都没有」完全正常（筛完没结果、页翻过了头）。
     * 那种情况下报 500，运营看到的是一个假的故障。
     */
    @Test
    void 批量三列_空请求回空表而不是报错() {
        assertThat(admin.adminQueryUserStats(AdminQueryUserStatsRequest.getDefaultInstance())
                .getStatsMap()).isEmpty();
    }

    // ─────────────────────────────────────────────────────────────

    private List<AdminTransactionItem> adminList(long userId) {
        return admin.adminListTransactions(AdminListTransactionsRequest.newBuilder()
                        .setUserId(userId).setPageSize(50).build())
                .getItemsList();
    }

    /** 全站/按用户 + 类型过滤。空类型串 = 全部（服务端口径）。 */
    private List<AdminTransactionItem> adminListTyped(long userId, String type) {
        return admin.adminListTransactions(AdminListTransactionsRequest.newBuilder()
                        .setUserId(userId).setType(type).setPageSize(50).build())
                .getItemsList();
    }

    /**
     * 直接插一条预留行，时间点由测试给死（**库内北京墙钟**，与 {@code DbTime} 的换算一致）。
     *
     * <p>不走 hold/settle 是因为要验**边界**（正好落在 from / 正好落在 to 的行），
     * 而走真实路径没法把 {@code gmt_modified} 设到指定的秒上。
     */
    private void insertReservation(long jobId, String status, Long actualCredits, String at) {
        jdbc.update("INSERT INTO billing_cost_reservations "
                        + "(generation_job_id, user_id, reserved_credits, actual_credits, status,"
                        + " allocations, catalog_version, gmt_create, gmt_modified) "
                        + "VALUES (?, ?, 100, ?, ?, '[]', 1, ?, ?)",
                jobId, USER, actualCredits, status, at, at);
    }

    private long consumed(Instant from, Instant to) {
        return admin.adminConsumedCredits(AdminConsumedCreditsRequest.newBuilder()
                        .setFrom(from.toString()).setTo(to.toString()).build())
                .getConsumedCredits();
    }

    /** 取该类型的那一行；不唯一直接失败（断言意图就是「恰好一行」）。 */
    private static AdminTransactionItem rowOf(List<AdminTransactionItem> items, String type) {
        List<AdminTransactionItem> matched = items.stream()
                .filter(item -> item.getType().equals(type))
                .toList();
        assertThat(matched).as("类型 %s 的行数", type).hasSize(1);
        return matched.get(0);
    }

    private static HoldRequest hold(long userId, String commandId, long jobId) {
        return HoldRequest.newBuilder()
                .setUserId(userId)
                .setCommandId(commandId)
                .setJobId(jobId)
                .setModelId(MODEL)
                .setTaskType(TASK)
                .setSpecs(SpecAttrs.newBuilder().putAttrs("resolution", "1080p").build())
                .setTier("free")
                .setTitle(TITLE)
                .setRuleSnapshot(RULE)
                .build();
    }
}
