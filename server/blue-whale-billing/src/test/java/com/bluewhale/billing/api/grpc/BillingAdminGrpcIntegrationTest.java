package com.bluewhale.billing.api.grpc;

import com.bluewhale.billing.application.CatalogHolder;
import com.bluewhale.billing.application.CreditService;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.contracts.billing.v1.AdminConsumedCreditsRequest;
import com.bluewhale.contracts.billing.v1.AdminDeleteMemberDiscountRequest;
import com.bluewhale.contracts.billing.v1.AdminDeletePromotionRequest;
import com.bluewhale.contracts.billing.v1.AdminGetActiveCatalogRequest;
import com.bluewhale.contracts.billing.v1.AdminGetActiveCatalogResponse;
import com.bluewhale.contracts.billing.v1.AdminGrantRequest;
import com.bluewhale.contracts.billing.v1.AdminGrantResponse;
import com.bluewhale.contracts.billing.v1.AdminListMemberDiscountsRequest;
import com.bluewhale.contracts.billing.v1.AdminListPromotionsRequest;
import com.bluewhale.contracts.billing.v1.AdminListTransactionsRequest;
import com.bluewhale.contracts.billing.v1.AdminListTransactionsResponse;
import com.bluewhale.contracts.billing.v1.AdminMemberDiscount;
import com.bluewhale.contracts.billing.v1.AdminMemberDiscountInput;
import com.bluewhale.contracts.billing.v1.AdminPromotion;
import com.bluewhale.contracts.billing.v1.AdminPromotionInput;
import com.bluewhale.contracts.billing.v1.AdminPublishCatalogRequest;
import com.bluewhale.contracts.billing.v1.AdminPublishCatalogResponse;
import com.bluewhale.contracts.billing.v1.AdminQueryBalanceRequest;
import com.bluewhale.contracts.billing.v1.AdminQueryBalanceResponse;
import com.bluewhale.contracts.billing.v1.AdminQueryUserStatsRequest;
import com.bluewhale.contracts.billing.v1.AdminQueryUserStatsResponse;
import com.bluewhale.contracts.billing.v1.AdminRefundRequest;
import com.bluewhale.contracts.billing.v1.AdminTransactionItem;
import com.bluewhale.contracts.billing.v1.AdminUpsertMemberDiscountRequest;
import com.bluewhale.contracts.billing.v1.AdminUpsertPromotionRequest;
import com.bluewhale.contracts.billing.v1.BillingAdminServiceGrpc;
import com.bluewhale.contracts.billing.v1.BillingServiceGrpc;
import com.bluewhale.contracts.billing.v1.ChargeRequest;
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

import java.time.LocalDateTime;
import java.time.ZoneId;
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

    private static final String CATALOG_V2 = CATALOG.replace("\"creditsPerYuan\":15", "\"creditsPerYuan\":20");

    private static final String CATALOG_REJECTED = CATALOG.replace("\"creditsPerYuan\":15", "\"creditsPerYuan\":0");

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
        userFacing.charge(charge(USER, "adm-all-1", 9_201L));
        userFacing.charge(charge(OTHER_USER, "adm-all-2", 9_202L));

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
        userFacing.charge(charge(USER, "adm-one-1", 9_203L));
        userFacing.charge(charge(OTHER_USER, "adm-one-2", 9_204L));

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
        userFacing.charge(charge(USER, "adm-type-1", 9_212L));

        List<AdminTransactionItem> consumes = adminListTyped(USER, "consume");
        assertThat(consumes).hasSize(1);
        assertThat(consumes).allSatisfy(item -> assertThat(item.getType()).isEqualTo("consume"));

        List<AdminTransactionItem> gifts = adminListTyped(USER, "gift");
        assertThat(gifts).hasSize(1);
        assertThat(gifts).allSatisfy(item -> assertThat(item.getType()).isEqualTo("gift"));
    }

    @Test
    void 偏移翻页_不重不漏() {
        userFacing.charge(charge(USER, "adm-page-1", 9_213L));

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
        userFacing.charge(charge(USER, "adm-total-1", 9_214L));

        AdminListTransactionsResponse response = admin.adminListTransactions(
                AdminListTransactionsRequest.newBuilder()
                        .setUserId(USER).setPageSize(10).setPage(1).build());
        assertThat(response.getItemsList()).isNotEmpty();
        assertThat(response.getPage().hasTotal()).isTrue();
        assertThat(response.getPage().getTotal()).isEqualTo(response.getItemsList().size());
    }


    @Test
    void 扣款额_运营面看得见_用户面一个字都不带() {
        userFacing.charge(charge(USER, "adm-hold-1", 9_205L));

        AdminTransactionItem adminRow = rowOf(adminList(USER), "consume");
        assertThat(adminRow.getStatus()).isEqualTo("done");
        assertThat(adminRow.getAmount()).isEqualTo(100);
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
        assertThat(userRow.getAmount()).isEqualTo(100);
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
        userFacing.charge(charge(USER, "adm-job-1", 9_207L));

        AdminTransactionItem consume = rowOf(adminList(USER), "consume");
        assertThat(consume.hasGenerationJobId()).isTrue();
        assertThat(consume.getGenerationJobId()).isEqualTo(9_207L);

        assertThat(rowOf(adminList(USER), "gift").hasGenerationJobId()).isFalse();
    }

    @Test
    void 扣款行_金额与预留列都是扣款时的那个数() {
        userFacing.charge(charge(USER, "adm-charged-1", 9_206L));

        AdminTransactionItem charged = rowOf(adminList(USER), "consume");

        assertThat(charged.getStatus()).isEqualTo("done");
        assertThat(charged.getAmount()).isEqualTo(100);
        assertThat(charged.getReservedCredits()).isEqualTo(100);
        assertThat(charged.getSettledAt()).isNotEmpty();
    }

    @Test
    void 任务退回的行_管理端也看得见() {
        userFacing.charge(charge(USER, "adm-refund-1", 9_215L));
        credits.refund(9_215L, "任务失败");

        List<AdminTransactionItem> consumes = adminListTyped(USER, "consume");
        assertThat(consumes).hasSize(1);

        AdminTransactionItem refund = consumes.get(0);
        assertThat(refund.getUserId()).isEqualTo(USER);
        assertThat(refund.getDirection()).isEqualTo("out");
        assertThat(refund.getStatus()).isEqualTo("refunded");
        assertThat(refund.getAmount()).isEqualTo(0);
        assertThat(refund.getReservedCredits()).isEqualTo(100);
        assertThat(refund.getSettledAt()).isNotEmpty();

        assertThat(adminListTyped(USER, "refund")).isEmpty();
    }


    @Test
    void 消耗合计_按已扣款计_退回的不算() {
        LocalDateTime from = LocalDateTime.now().minus(1, ChronoUnit.HOURS);
        LocalDateTime to = LocalDateTime.now().plus(1, ChronoUnit.HOURS);

        userFacing.charge(charge(USER, "adm-cc-1", 9_207L));
        assertThat(consumed(from, to)).isEqualTo(100);

        credits.refund(9_207L, "任务失败");
        assertThat(consumed(from, to)).as("退回的那笔不再计入消耗").isZero();

        userFacing.charge(charge(OTHER_USER, "adm-cc-2", 9_208L));
        assertThat(consumed(from, to)).isEqualTo(100);

        assertThat(consumed(LocalDateTime.now().minus(2, ChronoUnit.DAYS),
                LocalDateTime.now().minus(1, ChronoUnit.DAYS))).isZero();
    }

    @Test
    void 消耗合计_半开区间且只算已扣款() {
        LocalDateTime from = LocalDateTime.parse("2026-09-25T00:00:00");
        LocalDateTime to = LocalDateTime.parse("2026-09-26T00:00:00");

        insertReservation(9_301L, "charged", 1L, "2026-09-24 23:59:59");
        insertReservation(9_302L, "charged", 2L, "2026-09-25 00:00:00");
        insertReservation(9_303L, "charged", 4L, "2026-09-25 23:59:59");
        insertReservation(9_304L, "charged", 8L, "2026-09-26 00:00:00");
        insertReservation(9_305L, "refunded", 16L, "2026-09-25 12:00:00");

        assertThat(consumed(from, to)).isEqualTo(6);
    }

    @Test
    void 消耗合计_缺参数或区间反了_报INVALID_ARGUMENT而不是当0() {
        LocalDateTime now = LocalDateTime.now();

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
    void 余额_扣款后可用随之下降() {
        userFacing.charge(charge(USER, "adm-bal-1", 9_209L));

        AdminQueryBalanceResponse balance = admin.adminQueryBalance(
                AdminQueryBalanceRequest.newBuilder().setUserId(USER).build());

        assertThat(balance.getAvailableCredits()).isEqualTo(9_900);
    }

    @Test
    void 余额_从没见过的用户是零值而不是错误() {
        AdminQueryBalanceResponse balance = admin.adminQueryBalance(
                AdminQueryBalanceRequest.newBuilder().setUserId(9_999L).build());

        assertThat(balance.getAvailableCredits()).isZero();
        assertThat(balance.getExpiringList()).isEmpty();
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
        userFacing.charge(charge(USER, "adm-same-1", 9_210L));
        userFacing.charge(charge(USER, "adm-same-2", 9_211L));

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
        userFacing.charge(charge(USER, "adm-batch-1", 9_401L));

        AdminQueryUserStatsResponse response = admin.adminQueryUserStats(
                AdminQueryUserStatsRequest.newBuilder()
                        .addAllUserIds(List.of(USER, OTHER_USER, 9_999L))
                        .build());

        assertThat(response.getStatsMap()).containsOnlyKeys(USER, OTHER_USER, 9_999L);

        assertThat(response.getStatsOrThrow(USER).getAvailableCredits()).isEqualTo(10_500);
        assertThat(response.getStatsOrThrow(USER).getTotalRecharged()).isEqualTo(500);
        assertThat(response.getStatsOrThrow(USER).getTotalConsumed()).isEqualTo(100);

        assertThat(response.getStatsOrThrow(OTHER_USER).getAvailableCredits()).isEqualTo(10_000);
        assertThat(response.getStatsOrThrow(OTHER_USER).getTotalRecharged()).isZero();
        assertThat(response.getStatsOrThrow(OTHER_USER).getTotalConsumed()).isZero();

        assertThat(response.getStatsOrThrow(9_999L).getAvailableCredits()).isZero();
        assertThat(response.getStatsOrThrow(9_999L).getTotalRecharged()).isZero();
    }

    @Test
    void 批量三列的可用_与单人余额是同一个数() {
        credits.grant(USER, CreditSource.PURCHASED, 500, null, "recharge", "r-2", "gk-3");
        userFacing.charge(charge(USER, "adm-batch-2", 9_402L));

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


    @Test
    void 发放_批次与账本同时落库_余额可查() {
        AdminGrantResponse response = admin.adminGrant(AdminGrantRequest.newBuilder()
                .setUserId(9401L).setSource("purchased").setAmount(1000)
                .setBizId("RC-1").setBizType("recharge").build());

        assertThat(response.getDuplicated()).isFalse();
        assertThat(response.getLotId()).isPositive();
        assertThat(admin.adminQueryBalance(AdminQueryBalanceRequest.newBuilder()
                        .setUserId(9401L).build()).getAvailableCredits())
                .isEqualTo(1000);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_ledger_entries WHERE user_id = 9401", Long.class))
                .isEqualTo(2L);
    }

    @Test
    void 发放_同一幂等键重复_返回duplicated与归属_不重复入账() {
        admin.adminGrant(AdminGrantRequest.newBuilder()
                .setUserId(9402L).setSource("purchased").setAmount(1000)
                .setBizId("RC-FIRST").setGrantKey("k-1").build());

        AdminGrantResponse second = admin.adminGrant(AdminGrantRequest.newBuilder()
                .setUserId(9402L).setSource("purchased").setAmount(1000)
                .setBizId("RC-SECOND").setGrantKey("k-1").build());

        assertThat(second.getDuplicated()).isTrue();
        assertThat(second.getExistingBizId()).isEqualTo("RC-FIRST");
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_credit_lots WHERE user_id = 9402", Long.class))
                .isEqualTo(1L);
    }

    @Test
    void 发放_显式到期时刻按北京时间落库() {
        admin.adminGrant(AdminGrantRequest.newBuilder()
                .setUserId(9403L).setSource("purchased").setAmount(100)
                .setBizId("RC-TZ").setExpiresAt("2028-11-03T02:38:05.000Z").build());

        LocalDateTime expiresAt = jdbc.queryForObject(
                "SELECT expires_at FROM billing_credit_lots WHERE user_id = 9403",
                LocalDateTime.class);

        assertThat(expiresAt).isEqualTo(LocalDateTime.of(2028, 11, 3, 10, 38, 5));
    }

    @Test
    void 发放_未传到期时刻_按来源策略() {
        admin.adminGrant(AdminGrantRequest.newBuilder()
                .setUserId(9404L).setSource("purchased").setAmount(100)
                .setBizId("RC-POLICY").build());

        LocalDateTime expiresAt = jdbc.queryForObject(
                "SELECT expires_at FROM billing_credit_lots WHERE user_id = 9404",
                LocalDateTime.class);
        LocalDateTime expected = LocalDateTime.now().plusYears(2);

        assertThat(expiresAt)
                .isBetween(expected.minusSeconds(60), expected.plusSeconds(60));
    }

    @Test
    void 发放_缺bizId或未知来源_报INVALID_ARGUMENT() {
        assertThatThrownBy(() -> admin.adminGrant(AdminGrantRequest.newBuilder()
                .setUserId(1).setSource("purchased").setAmount(1).build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));

        assertThatThrownBy(() -> admin.adminGrant(AdminGrantRequest.newBuilder()
                .setUserId(1).setSource("nope").setAmount(1).setBizId("x").build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    @Test
    void 人工返还_退回扣费() {
        userFacing.charge(charge(USER, "adm-rpc-refund", 9_501L));
        long charged = admin.adminQueryBalance(AdminQueryBalanceRequest.newBuilder()
                .setUserId(USER).build()).getAvailableCredits();

        admin.adminRefund(AdminRefundRequest.newBuilder()
                .setJobId(9_501L).setReason("人工释放").build());

        assertThat(admin.adminQueryBalance(AdminQueryBalanceRequest.newBuilder()
                .setUserId(USER).build()).getAvailableCredits())
                .isEqualTo(charged + 100);
    }

    @Test
    void 目录发布_同内容不新开版本_改内容版本递增() {
        AdminPublishCatalogResponse first = admin.adminPublishCatalog(
                AdminPublishCatalogRequest.newBuilder()
                        .setDocumentJson(CATALOG).setPublishedBy("42").setNote("首版").build());
        AdminPublishCatalogResponse same = admin.adminPublishCatalog(
                AdminPublishCatalogRequest.newBuilder()
                        .setDocumentJson(CATALOG).setPublishedBy("42").build());
        AdminPublishCatalogResponse changed = admin.adminPublishCatalog(
                AdminPublishCatalogRequest.newBuilder()
                        .setDocumentJson(CATALOG_V2).setPublishedBy("42").build());

        assertThat(same.getCatalogVersion()).isEqualTo(first.getCatalogVersion());
        assertThat(changed.getCatalogVersion()).isGreaterThan(first.getCatalogVersion());
        assertThat(changed.getCreditsPerYuan()).isEqualTo(20);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_pricing_catalogs WHERE status = 'active'", Long.class))
                .as("重新发布后只能有一版 active")
                .isEqualTo(1L);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_pricing_catalogs WHERE status = 'retired'", Long.class))
                .isPositive();
    }

    @Test
    void 目录发布_合法JSON但校验不过_报INVALID_ARGUMENT且不新增版本() {
        long before = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_pricing_catalogs", Long.class);

        assertThatThrownBy(() -> admin.adminPublishCatalog(
                AdminPublishCatalogRequest.newBuilder()
                        .setDocumentJson(CATALOG_REJECTED).build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));

        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_pricing_catalogs", Long.class))
                .isEqualTo(before);
    }

    @Test
    void 目录发布_非法JSON_报INVALID_ARGUMENT() {
        assertThatThrownBy(() -> admin.adminPublishCatalog(
                AdminPublishCatalogRequest.newBuilder().setDocumentJson("{").build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    @Test
    void 会员折扣_增改删全链路与404() {
        AdminMemberDiscount created = admin.adminUpsertMemberDiscount(
                AdminUpsertMemberDiscountRequest.newBuilder()
                        .setInput(memberDiscountInput(9000, "enabled")).build()).getDiscount();
        assertThat(created.getId()).isPositive();
        assertThat(admin.adminListMemberDiscounts(
                        AdminListMemberDiscountsRequest.newBuilder().build()).getItemsList())
                .hasSize(1);
        assertThat(admin.adminListMemberDiscounts(AdminListMemberDiscountsRequest.newBuilder()
                        .setTier("pro").setStatus("enabled").build()).getItemsList())
                .hasSize(1);
        assertThat(admin.adminListMemberDiscounts(AdminListMemberDiscountsRequest.newBuilder()
                        .setTier("max").build()).getItemsList())
                .isEmpty();

        AdminMemberDiscount updated = admin.adminUpsertMemberDiscount(
                AdminUpsertMemberDiscountRequest.newBuilder()
                        .setId(created.getId())
                        .setInput(memberDiscountInput(8000, "disabled")).build()).getDiscount();
        assertThat(updated.getDiscountBp()).isEqualTo(8000);

        admin.adminDeleteMemberDiscount(AdminDeleteMemberDiscountRequest.newBuilder()
                .setId(created.getId()).build());
        assertThat(admin.adminListMemberDiscounts(
                        AdminListMemberDiscountsRequest.newBuilder().build()).getItemsList())
                .isEmpty();

        assertThatThrownBy(() -> admin.adminUpsertMemberDiscount(
                AdminUpsertMemberDiscountRequest.newBuilder()
                        .setId(9_999L)
                        .setInput(memberDiscountInput(8000, "enabled")).build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.NOT_FOUND));
    }

    @Test
    void 会员折扣_校验失败是INVALID_ARGUMENT() {
        assertThatThrownBy(() -> admin.adminUpsertMemberDiscount(
                AdminUpsertMemberDiscountRequest.newBuilder()
                        .setInput(memberDiscountInput(0, "enabled")).build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    @Test
    void 活动_空范围归一null_时段可清空() {
        AdminPromotion created = admin.adminUpsertPromotion(
                AdminUpsertPromotionRequest.newBuilder()
                        .setOperator("42")
                        .setInput(promotionInput(false, false)).build()).getPromotion();

        assertThat(created.getTaskTypesList()).isEmpty();
        assertThat(created.getTierScopeList()).isEmpty();
        assertThat(created.getDaysOfWeekList()).isEmpty();
        assertThat(created.getCreatedBy()).isEqualTo("42");
        assertThat(created.getStartAt()).isEqualTo("2026-10-01T00:00");

        AdminPromotion withWindow = admin.adminUpsertPromotion(
                AdminUpsertPromotionRequest.newBuilder()
                        .setId(created.getId())
                        .setInput(promotionInput(true, true)).build()).getPromotion();
        assertThat(withWindow.getDailyTimeStart()).isEqualTo("22:00");
        assertThat(withWindow.getDailyTimeEnd()).isEqualTo("06:00");

        AdminPromotion cleared = admin.adminUpsertPromotion(
                AdminUpsertPromotionRequest.newBuilder()
                        .setId(created.getId())
                        .setInput(promotionInput(false, true)).build()).getPromotion();
        assertThat(cleared.getDailyTimeStart()).isEmpty();
        assertThat(cleared.getDailyTimeEnd()).isEmpty();

        admin.adminDeletePromotion(AdminDeletePromotionRequest.newBuilder()
                .setId(created.getId()).build());
        assertThat(admin.adminListPromotions(
                        AdminListPromotionsRequest.newBuilder().build()).getItemsList())
                .isEmpty();
    }

    @Test
    void 活动_非空范围往返与列表过滤() {
        AdminPromotion created = admin.adminUpsertPromotion(
                AdminUpsertPromotionRequest.newBuilder()
                        .setInput(AdminPromotionInput.newBuilder()
                                .setCode("peak").setName("高峰")
                                .setDiscountBp(7000)
                                .addModelIds("seedance-*")
                                .addTaskTypes("text2video")
                                .addTierScope("pro")
                                .addTierScope("max")
                                .addDaysOfWeek(1)
                                .addDaysOfWeek(5)
                                .setStartAt("2026-10-01T00:00")
                                .setEndAt("2026-11-01T00:00")
                                .setStatus("enabled")
                                .build())
                        .build()).getPromotion();

        assertThat(created.getModelIdsList()).containsExactly("seedance-*");
        assertThat(created.getTaskTypesList()).containsExactly("text2video");
        assertThat(created.getTierScopeList()).containsExactly("pro", "max");
        assertThat(created.getDaysOfWeekList()).containsExactly(1, 5);
        assertThat(admin.adminListPromotions(
                        AdminListPromotionsRequest.newBuilder().setStatus("enabled").build())
                .getItemsList())
                .extracting(AdminPromotion::getCode)
                .contains("peak");
    }

    @Test
    void 管理端建的会员折扣_计价侧命中() {
        admin.adminUpsertMemberDiscount(AdminUpsertMemberDiscountRequest.newBuilder()
                .setInput(AdminMemberDiscountInput.newBuilder()
                        .setTier("free")
                        .setModelPattern("*")
                        .setTaskPattern("*")
                        .setDiscountBp(9000)
                        .setStatus("enabled")
                        .build())
                .build());

        assertThat(userFacing.charge(charge(USER, "adm-rpc-discount", 9_602L))
                .getChargedCredits())
                .isEqualTo(90);
    }

    @Test
    void 活动_模型范围为空或时段只填一半_都报INVALID_ARGUMENT() {
        assertThatThrownBy(() -> admin.adminUpsertPromotion(
                AdminUpsertPromotionRequest.newBuilder()
                        .setInput(AdminPromotionInput.newBuilder()
                                .setCode("bad-empty").setName("空范围")
                                .setDiscountBp(7000)
                                .setStartAt("2026-10-01T00:00")
                                .setEndAt("2026-11-01T00:00")
                                .build())
                        .build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));

        assertThatThrownBy(() -> admin.adminUpsertPromotion(
                AdminUpsertPromotionRequest.newBuilder()
                        .setInput(AdminPromotionInput.newBuilder()
                                .setCode("bad-window").setName("半截时段")
                                .setDiscountBp(7000)
                                .addModelIds("*")
                                .setStartAt("2026-10-01T00:00")
                                .setEndAt("2026-11-01T00:00")
                                .setDailyTimeStart("22:00")
                                .build())
                        .build()))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    private static AdminMemberDiscountInput memberDiscountInput(int discountBp, String status) {
        return AdminMemberDiscountInput.newBuilder()
                .setTier("pro")
                .setModelPattern("*")
                .setTaskPattern("*")
                .setDiscountBp(discountBp)
                .setStatus(status)
                .build();
    }

    private static AdminPromotionInput promotionInput(boolean withDailyWindow, boolean enabled) {
        AdminPromotionInput.Builder input = AdminPromotionInput.newBuilder()
                .setCode("night-70")
                .setName("夜间 7 折")
                .setDiscountBp(7000)
                .addModelIds("*")
                .setStartAt("2026-10-01T00:00")
                .setEndAt("2026-11-01T00:00")
                .setStatus(enabled ? "enabled" : "draft");
        if (withDailyWindow) {
            input.setDailyTimeStart("22:00").setDailyTimeEnd("06:00");
        }
        return input.build();
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

    private void insertReservation(long jobId, String status, long reservedCredits, String at) {
        jdbc.update("INSERT INTO billing_cost_reservations "
                        + "(generation_job_id, user_id, reserved_credits, status,"
                        + " allocations, catalog_version, gmt_create, gmt_modified) "
                        + "VALUES (?, ?, ?, ?, '[]', 1, ?, ?)",
                jobId, USER, reservedCredits, status, at, at);
    }

    private long consumed(LocalDateTime from, LocalDateTime to) {
        return admin.adminConsumedCredits(AdminConsumedCreditsRequest.newBuilder()
                        .setFrom(from.atZone(ZoneId.systemDefault()).toOffsetDateTime().toString())
                        .setTo(to.atZone(ZoneId.systemDefault()).toOffsetDateTime().toString())
                        .build())
                .getConsumedCredits();
    }

    private static AdminTransactionItem rowOf(List<AdminTransactionItem> items, String type) {
        List<AdminTransactionItem> matched = items.stream()
                .filter(item -> item.getType().equals(type))
                .toList();
        assertThat(matched).as("类型 %s 的行数", type).hasSize(1);
        return matched.get(0);
    }

    private static ChargeRequest charge(long userId, String commandId, long jobId) {
        return ChargeRequest.newBuilder()
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
