package com.bluewhale.billing.api.grpc;

import com.bluewhale.billing.catalog.CatalogHolder;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.CreditSource;
import com.bluewhale.contracts.billing.v1.AdminConsumedCreditsRequest;
import com.bluewhale.contracts.billing.v1.AdminGetActiveCatalogRequest;
import com.bluewhale.contracts.billing.v1.AdminGetActiveCatalogResponse;
import com.bluewhale.contracts.billing.v1.AdminListTransactionsRequest;
import com.bluewhale.contracts.billing.v1.AdminListTransactionsResponse;
import com.bluewhale.contracts.billing.v1.AdminQueryBalanceRequest;
import com.bluewhale.contracts.billing.v1.AdminQueryBalanceResponse;
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
 * 本次迁到 gRPC 后，HTTP 那边仍是薄壳，所以**两份实现同时存在**——本文件钉住的是
 * 「迁过来的这份与 HTTP 那份同源同口径」，而不是「新写了一套读模型」。
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
        //    所以判「内容改没改」只能**解析回来比**，比文本会让一次没改过的保存凭空多出版本
        //    （`AdminCatalogController#active` 与 proto 的注释都写了这条）。
        assertThat(new ObjectMapper().readTree(active.getDocumentJson())
                .get("creditsPerYuan").asInt()).isEqualTo(15);
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

    private List<AdminTransactionItem> adminList(long userId) {
        return admin.adminListTransactions(AdminListTransactionsRequest.newBuilder()
                        .setUserId(userId).setPageSize(50).build())
                .getItemsList();
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
