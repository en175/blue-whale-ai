package com.bluewhale.billing.adapter.inbound.grpc;

import com.bluewhale.billing.application.CatalogHolder;
import com.bluewhale.billing.application.CreditService;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.contracts.billing.v1.BillingServiceGrpc;
import com.bluewhale.contracts.billing.v1.HoldRequest;
import com.bluewhale.contracts.billing.v1.HoldResponse;
import com.bluewhale.contracts.billing.v1.QueryBalanceRequest;
import com.bluewhale.contracts.billing.v1.QueryBalanceResponse;
import com.bluewhale.contracts.billing.v1.QuoteRequest;
import com.bluewhale.contracts.billing.v1.QuoteResponse;
import com.bluewhale.contracts.common.v1.SpecAttrs;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@code billing.v1.BillingService} 的**端到端**测试：真库 + 真 gRPC 端口 + 真规则编译。
 *
 * <p>从 stub 发请求、经传输层、到账本落库，整条链路只有网络栈是真的（本地回环）。
 * 之所以不 mock 任何一层：本切片的价值全在**接线**上——
 * 计价引擎有没有接上折扣、单位有没有错位（积分 vs mc）、异常有没有映射成对的错误码。
 * mock 掉任何一层，恰恰会把这些接错的地方遮住。
 *
 * <p>端口用 0（内核分配空闲端口），所以可以和其他测试并行跑而不抢端口。
 */
@SpringBootTest(properties = {
        "billing.grpc.enabled=true",
        "billing.grpc.port=0"
})
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class BillingGrpcIntegrationTest {

    private static final long USER = 9201L;
    private static final String MODEL = "seedance-2.5";
    private static final String TASK = "text2video";

    /**
     * 目录：只有换算率与折扣策略（**规则不在目录里**——它随每次请求送来）。
     *
     * <p>它仍然要发一份：Hold / Quote 的回包里带着 {@code catalog_version}。
     */
    private static final String CATALOG = """
            {"schemaVersion":1,"currency":"CNY","creditsPerYuan":15,
             "discountPolicy":{"stackMode":"multiply","floorFactorBp":3000}}
            """;

    /**
     * 规则快照：单价 100000 mc → 出口四舍五入成 **100 积分**（mc 只在管线内部）。
     *
     * <p>形态就是 backend 能力行的 {@code pricing} 列——
     * 每次 Hold / Quote 都随请求送来，没有它就算不出价。
     */
    private static final String DEFAULT_RULE = ruleSnapshot(100_000L);

    @Autowired private Server grpcServer;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private CreditService credits;
    @Autowired private CatalogHolder catalog;

    private ManagedChannel channel;
    private BillingServiceGrpc.BillingServiceBlockingStub stub;

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

        // 起点 1000 积分
        credits.grant(USER, CreditSource.GIFT, 1_000, null, "grant", "seed", "seed-1");

        channel = ManagedChannelBuilder.forAddress("127.0.0.1", grpcServer.getPort())
                .usePlaintext()
                .build();
        stub = BillingServiceGrpc.newBlockingStub(channel);
    }

    @AfterEach
    void tearDown() {
        channel.shutdownNow();
    }

    // ─────────────────────────────────────────────────────────────

    @Test
    void 预扣成功_返回积分与定价版本_余额随之下降() {
        HoldResponse response = stub.hold(hold("cmd-1", 9_001L, "free"));

        // ★ 单位是**整数积分**，不是 mc。100000 mc 的单价出口舍入成 100 积分。
        //   若这里期望值写成 100000 或 100000000，就是单位错位的信号。
        assertThat(response.getReservedCredits()).isEqualTo(100);
        assertThat(response.getCatalogVersion()).isEqualTo(1);
        assertThat(response.getDuplicated()).isFalse();

        assertThat(availableCredits()).isEqualTo(900);
    }

    @Test
    void 重复commandId_标记duplicated且不二次扣费() {
        HoldResponse first = stub.hold(hold("cmd-2", 9_002L, "free"));
        HoldResponse second = stub.hold(hold("cmd-2", 9_002L, "free"));

        assertThat(first.getDuplicated()).isFalse();
        assertThat(second.getDuplicated()).isTrue();
        assertThat(second.getReservedCredits()).isEqualTo(first.getReservedCredits());

        // 只冻了一次
        assertThat(availableCredits()).isEqualTo(900);
        // 只记了一笔预扣凭证（2 条分录）+ 一笔发放凭证（2 条分录）
        assertThat(ledgerEntryCount()).isEqualTo(4);
    }

    @Test
    void 余额不足_映射成FAILED_PRECONDITION与INSUFFICIENT_CREDITS() {
        // 把这个用户清空：单价 100 积分，余额 0
        jdbc.update("DELETE FROM billing_credit_lots WHERE user_id = ?", USER);
        jdbc.update("DELETE FROM billing_ledger_entries WHERE user_id = ?", USER);

        assertThatThrownBy(() -> stub.hold(hold("cmd-3", 9_003L, "free")))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> {
                    Status status = ((StatusRuntimeException) thrown).getStatus();
                    // 调用方按这个码 fail closed（拒绝提交），所以码必须稳定
                    assertThat(status.getCode()).isEqualTo(Status.Code.FAILED_PRECONDITION);
                    assertThat(status.getDescription()).contains("INSUFFICIENT_CREDITS");
                    // 消息里带上「还差多少」，上层才能给出可操作的提示
                    assertThat(status.getDescription()).contains("还差 100");
                });

        // 失败要干净：没有留下任何冻结，也没有凭空生成批次
        assertThat(availableCredits()).isZero();
        assertThat(ledgerEntryCount()).isZero();
    }

    @Test
    void 未带规则快照的提交_映射成INVALID_ARGUMENT与UNPRICEABLE() {
        // 规则住在能力行、billing 读不到那个库：没有快照就算不出价。
        // 真实触发场景是「这个模型的能力行上还没配 pricing」——backend 于是没有快照可发。
        HoldRequest request = HoldRequest.newBuilder()
                .setUserId(USER).setCommandId("cmd-4").setJobId(9_004L)
                .setModelId("从未配置过的模型").setTaskType(TASK)
                .setSpecs(SpecAttrs.newBuilder().build())
                .setTier("free")
                .build();

        assertThatThrownBy(() -> stub.hold(request))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> {
                    Status status = ((StatusRuntimeException) thrown).getStatus();
                    // 漏配**不能当成免费**放行——否则配错了没人发现，直接白送
                    assertThat(status.getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
                    assertThat(status.getDescription()).contains("UNPRICEABLE");
                });

        // 拒单要干净：一分钱没冻、也没有预留
        assertThat(availableCredits()).isEqualTo(1_000);
        assertThat(countReservations()).isZero();
    }

    @Test
    void 会员折扣经引擎生效_预扣额按折后计() {
        jdbc.update("INSERT INTO billing_member_discounts "
                + "(tier, model_pattern, task_pattern, discount_bp, status) "
                + "VALUES ('pro', '*', '*', 8000, 'enabled')");

        HoldResponse response = stub.hold(hold("cmd-5", 9_005L, "pro"));

        // ★ 这条是「引擎有没有接上折扣解析器」的回归测试：
        //   PricingEngine.forMedia 曾经有个只传 catalog 的重载，内部用 DiscountResolver.NONE，
        //   用它接线会**静默不打折**——用户按原价被扣。原价 100 积分，8 折 → 80。
        assertThat(response.getReservedCredits()).isEqualTo(80);
    }

    @Test
    void 查余额_返回可用冻结与临期批次() {
        // 一笔 5 天后到期的批次，应出现在临期列表里
        credits.grant(USER, CreditSource.DAILY, 300,
                Instant.now().plus(5, ChronoUnit.DAYS), "grant", "d1", "d1");
        stub.hold(hold("cmd-6", 9_006L, "free"));   // 冻结 100

        QueryBalanceResponse balance = stub.queryBalance(
                QueryBalanceRequest.newBuilder().setUserId(USER).build());

        assertThat(balance.getAvailableCredits()).isEqualTo(1_200);   // 1300 - 100 冻结
        assertThat(balance.getFrozenCredits()).isEqualTo(100);

        // ★ 临期批次里的**可用量只剩 200**，因为刚才那次预扣扣的就是它 ——
        //   扣减顺序第一级是 expires_at ASC（先过期先扣），5 天后到期的批次
        //   排在永久批次前面，所以先吃它。这正是「先花快过期的」的实现。
        assertThat(balance.getExpiringList()).hasSize(1);
        assertThat(balance.getExpiring(0).getCredits()).isEqualTo(200);
        assertThat(balance.getExpiring(0).getSource()).isEqualTo(CreditSource.DAILY.key());
        // RFC3339 带时区（契约约定：时间不用 unix 秒，免时区歧义）
        assertThat(balance.getExpiring(0).getExpiresAt()).contains("+08:00");
    }

    // ─────────────────────────────────────────────────────────────
    // 规则快照（来自 backend 的能力行）：规则的**唯一**来源
    // ─────────────────────────────────────────────────────────────

    @Test
    void 预扣_带规则快照时按快照计价_并把原文冻进预留行() {
        // 默认规则是 100 积分；这次请求带来的快照写的是 300 积分
        // （真实场景：能力行里那条规则与默认夹具不是同一个价）
        HoldResponse response = stub.hold(holdWithSnapshot("cmd-snap", 9_007L, ruleSnapshot(300_000)));

        assertThat(response.getReservedCredits()).isEqualTo(300);
        // ★ 冻结的不只是算出来的价，还有**规则本身** —— 结算靠它复现（billing 再也读不到别的来源）
        assertThat(ruleSnapshotOf(9_007L)).isEqualTo(ruleSnapshot(300_000));
        assertThat(availableCredits()).isEqualTo(700);
    }

    @Test
    void 预扣_规则快照编不过_映射成INVALID_ARGUMENT与UNPRICEABLE() {
        // 缺 baseUnit：写侧闸门没拦住（或规则是被人直接改库改坏的），这里是最后一道
        HoldRequest request = holdWithSnapshot("cmd-bad", 9_008L,
                "{\"basePrice\":{\"kind\":\"const\",\"value\":100000}}");

        assertThatThrownBy(() -> stub.hold(request))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> {
                    Status status = ((StatusRuntimeException) thrown).getStatus();
                    // ★ 拒绝提交（fail closed），**不是静默放过**：放过会让这次按另一个价成交，
                    //   谁都看不出用的不是能力行里那条规则
                    assertThat(status.getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
                    assertThat(status.getDescription()).contains("UNPRICEABLE");
                    assertThat(status.getDescription()).contains("baseUnit");
                });

        // 拒单要干净：一分钱没冻、也没有预留
        assertThat(availableCredits()).isEqualTo(1_000);
        assertThat(countReservations()).isZero();
    }

    @Test
    void 报价_带规则快照时按快照算() {
        QuoteResponse quote = stub.quote(QuoteRequest.newBuilder()
                .setUserId(USER).setModelId(MODEL).setTaskType(TASK)
                .setSpecs(SpecAttrs.newBuilder().putAttrs("resolution", "1080p").build())
                .setTier("free")
                .setRuleSnapshot(ruleSnapshot(300_000))
                .build());

        // 默认规则是 100，快照里是 300 —— 报价必须与实扣取到**同一份**规则
        assertThat(quote.getCredits()).isEqualTo(300);
        // 报价仍然不碰钱，也不建预留
        assertThat(countLedgerEntries()).isEqualTo(2);   // 只有 setUp 里那笔发放
        assertThat(countReservations()).isZero();
    }

    // ─────────────────────────────────────────────────────────────
    // Quote：只算不扣（切换前影子模式的入口）
    // ─────────────────────────────────────────────────────────────

    @Test
    void 报价_算出价钱但不碰钱() {
        int lotsBefore = countLots();
        int entriesBefore = countLedgerEntries();
        long availableBefore = availableCredits();

        QuoteResponse quote = stub.quote(quoteRequest("free"));

        assertThat(quote.getCredits()).isEqualTo(100);
        assertThat(quote.getCatalogVersion()).isEqualTo(1);
        assertThat(quote.getDiscountBp()).isEqualTo(10_000);

        // ★ 这一条是 Quote 存在的全部理由：影子模式每天算成千上万次，
        //   每次冻一笔再退一笔既没必要，也会把账本与对账搅浑。
        assertThat(countLots()).isEqualTo(lotsBefore);
        assertThat(countLedgerEntries()).isEqualTo(entriesBefore);
        assertThat(availableCredits()).isEqualTo(availableBefore);
        // 也不该建预留——预留是「钱已经冻住了」的凭据，报价没有冻任何东西
        assertThat(countReservations()).isZero();
    }

    @Test
    void 报价_余额为零也能算() {
        // 报价回答的是「这个组合多少钱」，与用户有多少钱无关。
        // 若它顺手校验了余额，影子模式就会漏掉所有余额不足的用户——而那正是
        // 「我们的算价」与「上游扣费」最可能对不上的那批人。
        jdbc.update("DELETE FROM billing_credit_lots WHERE user_id = ?", USER);
        jdbc.update("DELETE FROM billing_ledger_entries WHERE user_id = ?", USER);

        QuoteResponse quote = stub.quote(quoteRequest("free"));

        assertThat(quote.getCredits()).isEqualTo(100);
    }

    @Test
    void 报价_折扣照算() {
        jdbc.update("INSERT INTO billing_member_discounts "
                + "(tier, model_pattern, task_pattern, discount_bp, status) "
                + "VALUES ('pro', '*', '*', 7000, 'enabled')");

        QuoteResponse quote = stub.quote(quoteRequest("pro"));

        assertThat(quote.getCredits()).isEqualTo(70);
        assertThat(quote.getDiscountBp()).isEqualTo(7_000);
        assertThat(quote.getAppliedList()).hasSize(1);
        assertThat(quote.getApplied(0).getSource()).isEqualTo("member");
        // 报价同样不碰钱
        assertThat(countLedgerEntries()).isEqualTo(2);   // 只有 setUp 里那笔发放
    }

    @Test
    void 报价_带用量时按用量算() {
        // 契约用量为空、真实用量带一条：两者走的是同一段计价逻辑，
        // 差别只在于 quantity 从哪来。
        QuoteResponse quote = stub.quote(QuoteRequest.newBuilder()
                .setUserId(USER).setModelId(MODEL).setTaskType(TASK)
                .setTier("free")
                .setRuleSnapshot(DEFAULT_RULE)
                .addUsage(com.bluewhale.contracts.billing.v1.UsageLine.newBuilder()
                        .setModelId(MODEL).setTaskType(TASK)
                        .putQuantities("usage.seconds", 10)
                        .build())
                .build());

        // 规则是 constant:1，用量不参与基准量，所以仍是 100——这条测的是
        // 「多行用量被接受并联通到计价」，不是数值随用量变化（那需要另一条规则）
        assertThat(quote.getCredits()).isEqualTo(100);
    }

    @Test
    void 报价_未带快照时报UNPRICEABLE() {
        // 影子期跑出来的 UNPRICEABLE 就是切换前要修掉的漏配清单。
        // 快照是规则的唯一来源：没有它，报价也算不出价（而不是回落某份老配置）
        assertThatThrownBy(() -> stub.quote(QuoteRequest.newBuilder()
                .setUserId(USER).setModelId("从未配置过的模型").setTaskType(TASK)
                .setSpecs(SpecAttrs.newBuilder().build())
                .setTier("free")
                .build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> {
                    Status status = ((StatusRuntimeException) thrown).getStatus();
                    assertThat(status.getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
                    assertThat(status.getDescription()).contains("UNPRICEABLE");
                });
    }

    // ─────────────────────────────────────────────────────────────

    private QuoteRequest quoteRequest(String tier) {
        return QuoteRequest.newBuilder()
                .setUserId(USER).setModelId(MODEL).setTaskType(TASK)
                .setSpecs(SpecAttrs.newBuilder().putAttrs("resolution", "1080p").build())
                .setTier(tier)
                .setRuleSnapshot(DEFAULT_RULE)
                .build();
    }

    private int countLots() {
        Integer n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_credit_lots WHERE user_id = ?", Integer.class, USER);
        return n == null ? 0 : n;
    }

    private int countLedgerEntries() {
        Integer n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_ledger_entries WHERE user_id = ?", Integer.class, USER);
        return n == null ? 0 : n;
    }

    private int countReservations() {
        Integer n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_cost_reservations WHERE user_id = ?",
                Integer.class, USER);
        return n == null ? 0 : n;
    }

    private HoldRequest hold(String commandId, long jobId, String tier) {
        return HoldRequest.newBuilder()
                .setUserId(USER)
                .setCommandId(commandId)
                .setJobId(jobId)
                .setModelId(MODEL)
                .setTaskType(TASK)
                .setSpecs(SpecAttrs.newBuilder().putAttrs("resolution", "1080p").build())
                .setTier(tier)
                .setTitle("视频生成 · " + MODEL + " 1080p")
                // 规则快照随每次请求来 —— 没有它就算不出价（见 DEFAULT_RULE）
                .setRuleSnapshot(DEFAULT_RULE)
                .build();
    }

    /**
     * 预扣请求，带上规则快照。
     *
     * <p>快照是跨进程的线格式（backend 的能力行把它原样送来），所以这里手写字面量，
     * 不用序列化生成——形态本身就是被测对象。
     */
    private HoldRequest holdWithSnapshot(String commandId, long jobId, String ruleSnapshot) {
        return HoldRequest.newBuilder()
                .setUserId(USER)
                .setCommandId(commandId)
                .setJobId(jobId)
                .setModelId(MODEL)
                .setTaskType(TASK)
                .setSpecs(SpecAttrs.newBuilder().putAttrs("resolution", "1080p").build())
                .setTier("free")
                .setRuleSnapshot(ruleSnapshot)
                .build();
    }

    /** 规则快照 JSON：每条按次计价 {@code basePrice} 微积分（形态 = 能力行的 pricing 列）。 */
    private static String ruleSnapshot(long basePrice) {
        return """
                {"baseUnit":"constant:1","basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":1}
                """.formatted(basePrice);
    }

    /** 预留行上冻的规则快照原文。 */
    private String ruleSnapshotOf(long jobId) {
        return jdbc.queryForObject(
                "SELECT rule_snapshot FROM billing_cost_reservations WHERE generation_job_id = ?",
                String.class, jobId);
    }

    private long availableCredits() {
        Long value = jdbc.queryForObject(
                "SELECT COALESCE(SUM(remaining - frozen), 0) FROM billing_credit_lots "
                        + "WHERE user_id = ?", Long.class, USER);
        return value == null ? 0L : value;
    }

    private int ledgerEntryCount() {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_ledger_entries WHERE user_id = ?", Integer.class, USER);
        return count == null ? 0 : count;
    }
}
