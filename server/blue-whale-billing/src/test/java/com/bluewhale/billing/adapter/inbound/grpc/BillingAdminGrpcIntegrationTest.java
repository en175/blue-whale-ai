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

    private static final String CATALOG = """
            {"schemaVersion":1,"currency":"CNY","creditsPerYuan":15,
             "discountPolicy":{"stackMode":"multiply","floorFactorBp":3000}}
            """;

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


    @Test
    void 全站流水_每一行都带得回它的主人() {
        userFacing.hold(hold(USER, "adm-all-1", 9_201L));
        userFacing.hold(hold(OTHER_USER, "adm-all-2", 9_202L));

        AdminListTransactionsResponse response = admin.adminListTransactions(
                AdminListTransactionsRequest.newBuilder().setUserId(0).setPageSize(50).build());
        List<AdminTransactionItem> items = response.getItemsList();

        assertThat(items).hasSize(4);
        assertThat(items).allSatisfy(item -> assertThat(item.getUserId()).isIn(USER, OTHER_USER));
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

        assertThat(response.getItemsList()).hasSize(2);
        assertThat(response.getItemsList())
                .allSatisfy(item -> assertThat(item.getUserId()).isEqualTo(USER));
    }


    @Test
    void 未知类型_报INVALID_ARGUMENT而不是给空列表() {
        assertThatThrownBy(() -> admin.adminListTransactions(
                AdminListTransactionsRequest.newBuilder()
                        .setUserId(USER).setType("recharg").setPageSize(50).build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    @Test
    void 合法类型过滤_只出该类型的行() {
        userFacing.hold(hold(USER, "adm-type-1", 9_212L));

        List<AdminTransactionItem> consumes = adminListTyped(USER, "consume");
        assertThat(consumes).hasSize(1);
        assertThat(consumes).allSatisfy(item -> assertThat(item.getType()).isEqualTo("consume"));

        List<AdminTransactionItem> gifts = adminListTyped(USER, "gift");
        assertThat(gifts).hasSize(1);
        assertThat(gifts).allSatisfy(item -> assertThat(item.getType()).isEqualTo("gift"));
    }

    @Test
    void 偏移翻页_不重不漏() {
        userFacing.hold(hold(USER, "adm-page-1", 9_213L));

        AdminListTransactionsResponse first = admin.adminListTransactions(
                AdminListTransactionsRequest.newBuilder()
                        .setUserId(USER).setPageSize(1).setPage(1).build());
        assertThat(first.getItemsList()).hasSize(1);
        String firstId = first.getItems(0).getId();

        AdminListTransactionsResponse second = admin.adminListTransactions(
                AdminListTransactionsRequest.newBuilder()
                        .setUserId(USER).setPageSize(1).setPage(2).build());
        assertThat(second.getItemsList()).hasSize(1);
        assertThat(second.getItems(0).getId()).isNotEqualTo(firstId);
    }

    @Test
    void 运营面填total_且与用户面同一口径() {
        userFacing.hold(hold(USER, "adm-total-1", 9_214L));

        AdminListTransactionsResponse response = admin.adminListTransactions(
                AdminListTransactionsRequest.newBuilder()
                        .setUserId(USER).setPageSize(10).setPage(1).build());
        assertThat(response.getItemsList()).isNotEmpty();
        assertThat(response.getPage().hasTotal()).isTrue();
        assertThat(response.getPage().getTotal()).isEqualTo(response.getItemsList().size());
    }


    @Test
    void 预扣额_运营面看得见_用户面一个字都不带() {
        userFacing.hold(hold(USER, "adm-hold-1", 9_205L));
        credits.settle(9_205L, 30);

        AdminTransactionItem adminRow = rowOf(adminList(USER), "consume");
        assertThat(adminRow.getStatus()).isEqualTo("done");
        assertThat(adminRow.getAmount()).isEqualTo(30);
        assertThat(adminRow.hasReservedCredits()).isTrue();
        assertThat(adminRow.getReservedCredits()).isEqualTo(100);

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
        assertThat(userRow.getStatus()).isEqualTo("done");
    }

    @Test
    void 发放行_没有预扣额_是缺值而不是0() {
        AdminTransactionItem grant = rowOf(adminList(USER), "gift");

        assertThat(grant.hasReservedCredits()).isFalse();
        assertThat(grant.getAmount()).isEqualTo(10_000);
        assertThat(grant.getUserId()).isEqualTo(USER);
    }

    @Test
    void 消费行_带得出关联的生成任务_发放行是缺值() {
        userFacing.hold(hold(USER, "adm-job-1", 9_207L));
        credits.settle(9_207L, 30);

        AdminTransactionItem consume = rowOf(adminList(USER), "consume");
        assertThat(consume.hasGenerationJobId()).isTrue();
        assertThat(consume.getGenerationJobId()).isEqualTo(9_207L);

        assertThat(rowOf(adminList(USER), "gift").hasGenerationJobId()).isFalse();
    }

    @Test
    void 未结算的消费行_预扣额仍是预扣时的那个数() {
        userFacing.hold(hold(USER, "adm-pending-1", 9_206L));

        AdminTransactionItem pending = rowOf(adminList(USER), "consume");

        assertThat(pending.getStatus()).isEqualTo("pending");
        assertThat(pending.getAmount()).isEqualTo(100);
        assertThat(pending.getReservedCredits()).isEqualTo(100);
        assertThat(pending.getSettledAt()).isEmpty();
    }

    @Test
    void 任务退回的行_管理端也看得见() {
        userFacing.hold(hold(USER, "adm-refund-1", 9_215L));
        credits.refund(9_215L, "任务失败");

        List<AdminTransactionItem> consumes = adminListTyped(USER, "consume");
        assertThat(consumes).hasSize(1);

        AdminTransactionItem refund = consumes.get(0);
        assertThat(refund.getUserId()).isEqualTo(USER);
        assertThat(refund.getDirection()).isEqualTo("out");
        assertThat(refund.getStatus()).isEqualTo("done");
        assertThat(refund.getAmount()).isEqualTo(0);
        assertThat(refund.getReservedCredits()).isEqualTo(100);
        assertThat(refund.getSettledAt()).isNotEmpty();

        assertThat(adminListTyped(USER, "refund")).isEmpty();
    }


    @Test
    void 消耗合计_只算已结算的_在途的预扣不算() {
        Instant from = Instant.now().minus(1, ChronoUnit.HOURS);
        Instant to = Instant.now().plus(1, ChronoUnit.HOURS);

        userFacing.hold(hold(USER, "adm-cc-1", 9_207L));
        assertThat(consumed(from, to)).isZero();

        credits.settle(9_207L, 30);
        assertThat(consumed(from, to)).isEqualTo(30);

        userFacing.hold(hold(OTHER_USER, "adm-cc-2", 9_208L));
        assertThat(consumed(from, to)).isEqualTo(30);

        assertThat(consumed(Instant.now().minus(2, ChronoUnit.DAYS),
                Instant.now().minus(1, ChronoUnit.DAYS))).isZero();
    }

    @Test
    void 消耗合计_半开区间且只算已结算() {
        Instant from = OffsetDateTime.parse("2026-09-25T00:00:00+08:00").toInstant();
        Instant to = OffsetDateTime.parse("2026-09-26T00:00:00+08:00").toInstant();

        insertReservation(9_301L, "settled", 1L, "2026-09-24 23:59:59");
        insertReservation(9_302L, "settled", 2L, "2026-09-25 00:00:00");
        insertReservation(9_303L, "settled", 4L, "2026-09-25 23:59:59");
        insertReservation(9_304L, "settled", 8L, "2026-09-26 00:00:00");
        insertReservation(9_305L, "held", null, "2026-09-25 12:00:00");
        insertReservation(9_306L, "released", 0L, "2026-09-25 12:00:00");

        assertThat(consumed(from, to)).isEqualTo(6);
    }

    @Test
    void 消耗合计_缺参数或区间反了_报INVALID_ARGUMENT而不是当0() {
        Instant now = Instant.now();

        assertThatThrownBy(() -> admin.adminConsumedCredits(
                AdminConsumedCreditsRequest.newBuilder()
                        .setFrom(now.minus(1, ChronoUnit.HOURS).toString()).build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));

        assertThatThrownBy(() -> admin.adminConsumedCredits(
                AdminConsumedCreditsRequest.newBuilder()
                        .setFrom("不是时间").setTo(now.toString()).build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));

        assertThatThrownBy(() -> admin.adminConsumedCredits(
                AdminConsumedCreditsRequest.newBuilder()
                        .setFrom(now.toString())
                        .setTo(now.minus(1, ChronoUnit.HOURS).toString())
                        .build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));
    }


    @Test
    void 余额_冻结与可用分开报() {
        userFacing.hold(hold(USER, "adm-bal-1", 9_209L));

        AdminQueryBalanceResponse balance = admin.adminQueryBalance(
                AdminQueryBalanceRequest.newBuilder().setUserId(USER).build());

        assertThat(balance.getAvailableCredits()).isEqualTo(9_900);
        assertThat(balance.getFrozenCredits()).isEqualTo(100);
    }

    @Test
    void 余额_从没见过的用户是零值而不是错误() {
        AdminQueryBalanceResponse balance = admin.adminQueryBalance(
                AdminQueryBalanceRequest.newBuilder().setUserId(9_999L).build());

        assertThat(balance.getAvailableCredits()).isZero();
        assertThat(balance.getFrozenCredits()).isZero();
        assertThat(balance.getExpiringList()).isEmpty();
        assertThat(balance.getReceivableCredits())
                .as("查无此人也没有欠费 —— 与「余额为 0」同口径，不是另一个哨兵值")
                .isZero();
    }

    @Test
    void 欠费_只在管理面可见_且用户实扣仍是预扣额() {
        userFacing.hold(hold(USER, "adm-recv-1", 9_213L));
        credits.settle(9_213L, 130);

        AdminQueryBalanceResponse balance = admin.adminQueryBalance(
                AdminQueryBalanceRequest.newBuilder().setUserId(USER).build());

        assertThat(balance.getReceivableCredits())
                .as("管理端必须看得见这笔欠费（= 实际 − 预扣 = 130 − 100）")
                .isEqualTo(30);
        assertThat(balance.getAvailableCredits())
                .as("用户实扣仍只有预扣额 100：10000 − 100")
                .isEqualTo(9_900);
        assertThat(balance.getFrozenCredits()).isZero();

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
        assertThat(active.getCreditsPerYuan()).isEqualTo(15);
        assertThat(active.getDocumentHash()).isNotEmpty();

        ObjectMapper mapper = new ObjectMapper();
        assertThat(mapper.readTree(active.getDocumentJson())).isEqualTo(mapper.readTree(CATALOG));
        assertThat(active.getDocumentJson()).isNotEqualTo(CATALOG);
    }


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

        assertThat(adminRows).hasSameSizeAs(userRows);
        assertThat(adminRows.stream().map(AdminTransactionItem::getId).toList())
                .containsExactlyElementsOf(userRows.stream().map(UserTransaction::getId).toList());
        assertThat(adminRows.stream().map(AdminTransactionItem::getAmount).toList())
                .containsExactlyElementsOf(userRows.stream().map(UserTransaction::getAmount).toList());
    }


    @Test
    void 批量三列_一次问一批_各归各的且查无此人是0() {
        credits.grant(USER, CreditSource.PURCHASED, 500, null, "recharge", "r-1", "gk-1");
        credits.grant(USER, CreditSource.BONUS, 100, null, "recharge", "r-1", "gk-2");
        userFacing.hold(hold(USER, "adm-batch-1", 9_401L));
        credits.settle(9_401L, 30);

        AdminQueryUserStatsResponse response = admin.adminQueryUserStats(
                AdminQueryUserStatsRequest.newBuilder()
                        .addAllUserIds(List.of(USER, OTHER_USER, 9_999L))
                        .build());

        assertThat(response.getStatsMap()).containsOnlyKeys(USER, OTHER_USER, 9_999L);

        assertThat(response.getStatsOrThrow(USER).getAvailableCredits()).isEqualTo(10_570);
        assertThat(response.getStatsOrThrow(USER).getTotalRecharged()).isEqualTo(500);
        assertThat(response.getStatsOrThrow(USER).getTotalConsumed()).isEqualTo(30);

        assertThat(response.getStatsOrThrow(OTHER_USER).getAvailableCredits()).isEqualTo(10_000);
        assertThat(response.getStatsOrThrow(OTHER_USER).getTotalRecharged()).isZero();
        assertThat(response.getStatsOrThrow(OTHER_USER).getTotalConsumed()).isZero();

        assertThat(response.getStatsOrThrow(9_999L).getAvailableCredits()).isZero();
        assertThat(response.getStatsOrThrow(9_999L).getTotalRecharged()).isZero();
    }

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

    @Test
    void 批量三列_空请求回空表而不是报错() {
        assertThat(admin.adminQueryUserStats(AdminQueryUserStatsRequest.getDefaultInstance())
                .getStatsMap()).isEmpty();
    }


    private List<AdminTransactionItem> adminList(long userId) {
        return admin.adminListTransactions(AdminListTransactionsRequest.newBuilder()
                        .setUserId(userId).setPageSize(50).build())
                .getItemsList();
    }

    private List<AdminTransactionItem> adminListTyped(long userId, String type) {
        return admin.adminListTransactions(AdminListTransactionsRequest.newBuilder()
                        .setUserId(userId).setType(type).setPageSize(50).build())
                .getItemsList();
    }

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
