package com.bluewhale.billing.api.grpc;

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
import com.bluewhale.contracts.billing.v1.SourceCredits;
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

@SpringBootTest(properties = {
        "billing.grpc.enabled=true",
        "billing.grpc.port=0"
})
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class BillingGrpcIntegrationTest {

    private static final long USER = 9201L;
    private static final String MODEL = "seedance-2.5";
    private static final String TASK = "text2video";

    private static final String CATALOG = """
            {"schemaVersion":1,"currency":"CNY","creditsPerYuan":15,
             "discountPolicy":{"stackMode":"multiply","floorFactorBp":3000}}
            """;

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


    @Test
    void 预扣成功_返回积分与定价版本_余额随之下降() {
        HoldResponse response = stub.hold(hold("cmd-1", 9_001L, "free"));

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

        assertThat(availableCredits()).isEqualTo(900);
        assertThat(ledgerEntryCount()).isEqualTo(4);
    }

    @Test
    void 余额不足_映射成FAILED_PRECONDITION与INSUFFICIENT_CREDITS() {
        jdbc.update("DELETE FROM billing_credit_lots WHERE user_id = ?", USER);
        jdbc.update("DELETE FROM billing_ledger_entries WHERE user_id = ?", USER);

        assertThatThrownBy(() -> stub.hold(hold("cmd-3", 9_003L, "free")))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> {
                    Status status = ((StatusRuntimeException) thrown).getStatus();
                    assertThat(status.getCode()).isEqualTo(Status.Code.FAILED_PRECONDITION);
                    assertThat(status.getDescription()).contains("INSUFFICIENT_CREDITS");
                    assertThat(status.getDescription()).contains("还差 100");
                });

        assertThat(availableCredits()).isZero();
        assertThat(ledgerEntryCount()).isZero();
    }

    @Test
    void 未带规则快照的提交_映射成INVALID_ARGUMENT与UNPRICEABLE() {
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
                    assertThat(status.getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
                    assertThat(status.getDescription()).contains("UNPRICEABLE");
                });

        assertThat(availableCredits()).isEqualTo(1_000);
        assertThat(countReservations()).isZero();
    }

    @Test
    void 会员折扣经引擎生效_预扣额按折后计() {
        jdbc.update("INSERT INTO billing_member_discounts "
                + "(tier, model_pattern, task_pattern, discount_bp, status) "
                + "VALUES ('pro', '*', '*', 8000, 'enabled')");

        HoldResponse response = stub.hold(hold("cmd-5", 9_005L, "pro"));

        assertThat(response.getReservedCredits()).isEqualTo(80);
    }

    @Test
    void 查余额_返回可用冻结与临期批次() {
        credits.grant(USER, CreditSource.DAILY, 300,
                Instant.now().plus(5, ChronoUnit.DAYS), "grant", "d1", "d1");
        stub.hold(hold("cmd-6", 9_006L, "free"));

        QueryBalanceResponse balance = stub.queryBalance(
                QueryBalanceRequest.newBuilder().setUserId(USER).build());

        assertThat(balance.getAvailableCredits()).isEqualTo(1_200);
        assertThat(balance.getFrozenCredits()).isEqualTo(100);

        assertThat(balance.getExpiringList()).hasSize(1);
        assertThat(balance.getExpiring(0).getCredits()).isEqualTo(200);
        assertThat(balance.getExpiring(0).getSource()).isEqualTo(CreditSource.DAILY.key());
        assertThat(balance.getExpiring(0).getExpiresAt()).contains("+08:00");
    }

    @Test
    void 查余额_按来源拆分的分项之和等于总额() {
        credits.grant(USER, CreditSource.PURCHASED, 1_500, null, "grant", "bs-p", "bs-p");
        credits.grant(USER, CreditSource.BONUS, 1_000,
                Instant.now().plus(30, ChronoUnit.DAYS), "grant", "bs-b", "bs-b");

        QueryBalanceResponse balance = stub.queryBalance(
                QueryBalanceRequest.newBuilder().setUserId(USER).build());

        assertThat(balance.getBySourceList())
                .extracting(SourceCredits::getSource, SourceCredits::getCredits)
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple(CreditSource.GIFT.key(), 1_000L),
                        org.assertj.core.groups.Tuple.tuple(CreditSource.PURCHASED.key(), 1_500L),
                        org.assertj.core.groups.Tuple.tuple(CreditSource.BONUS.key(), 1_000L));

        long sum = balance.getBySourceList().stream().mapToLong(SourceCredits::getCredits).sum();
        assertThat(sum).isEqualTo(balance.getAvailableCredits());
    }


    @Test
    void 预扣_带规则快照时按快照计价_并把原文冻进预留行() {
        HoldResponse response = stub.hold(holdWithSnapshot("cmd-snap", 9_007L, ruleSnapshot(300_000)));

        assertThat(response.getReservedCredits()).isEqualTo(300);
        assertThat(ruleSnapshotOf(9_007L)).isEqualTo(ruleSnapshot(300_000));
        assertThat(availableCredits()).isEqualTo(700);
    }

    @Test
    void 预扣_规则快照编不过_映射成INVALID_ARGUMENT与UNPRICEABLE() {
        HoldRequest request = holdWithSnapshot("cmd-bad", 9_008L,
                "{\"basePrice\":{\"kind\":\"const\",\"value\":100000}}");

        assertThatThrownBy(() -> stub.hold(request))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> {
                    Status status = ((StatusRuntimeException) thrown).getStatus();
                    assertThat(status.getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
                    assertThat(status.getDescription()).contains("UNPRICEABLE");
                    assertThat(status.getDescription()).contains("baseUnit");
                });

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

        assertThat(quote.getCredits()).isEqualTo(300);
        assertThat(countLedgerEntries()).isEqualTo(2);
        assertThat(countReservations()).isZero();
    }


    @Test
    void 报价_算出价钱但不碰钱() {
        int lotsBefore = countLots();
        int entriesBefore = countLedgerEntries();
        long availableBefore = availableCredits();

        QuoteResponse quote = stub.quote(quoteRequest("free"));

        assertThat(quote.getCredits()).isEqualTo(100);
        assertThat(quote.getCatalogVersion()).isEqualTo(1);
        assertThat(quote.getDiscountBp()).isEqualTo(10_000);

        assertThat(countLots()).isEqualTo(lotsBefore);
        assertThat(countLedgerEntries()).isEqualTo(entriesBefore);
        assertThat(availableCredits()).isEqualTo(availableBefore);
        assertThat(countReservations()).isZero();
    }

    @Test
    void 报价_余额为零也能算() {
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
        assertThat(countLedgerEntries()).isEqualTo(2);
    }

    @Test
    void 报价_带用量时按用量算() {
        QuoteResponse quote = stub.quote(QuoteRequest.newBuilder()
                .setUserId(USER).setModelId(MODEL).setTaskType(TASK)
                .setTier("free")
                .setRuleSnapshot(DEFAULT_RULE)
                .addUsage(com.bluewhale.contracts.billing.v1.UsageLine.newBuilder()
                        .setModelId(MODEL).setTaskType(TASK)
                        .putQuantities("usage.seconds", 10)
                        .build())
                .build());

        assertThat(quote.getCredits()).isEqualTo(100);
    }

    @Test
    void 报价_未带快照时报UNPRICEABLE() {
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
                .setRuleSnapshot(DEFAULT_RULE)
                .build();
    }

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

    private static String ruleSnapshot(long basePrice) {
        return """
                {"baseUnit":"constant:1","basePrice":{"kind":"const","value":%d},
                 "unitDenominator":1,"minCredits":1}
                """.formatted(basePrice);
    }

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
