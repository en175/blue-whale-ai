package com.bluewhale.billing.adapter.inbound.grpc;

import com.bluewhale.billing.application.CatalogHolder;
import com.bluewhale.billing.domain.ledger.Account;
import com.bluewhale.billing.domain.ledger.BizType;
import com.bluewhale.billing.application.CreditExpirySweeper;
import com.bluewhale.billing.application.CreditService;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.billing.adapter.outbound.persistence.repository.LedgerRepository;
import com.bluewhale.billing.domain.ledger.Voucher;
import com.bluewhale.contracts.billing.v1.BillingServiceGrpc;
import com.bluewhale.contracts.billing.v1.HoldRequest;
import com.bluewhale.contracts.billing.v1.ListTransactionsRequest;
import com.bluewhale.contracts.billing.v1.ListTransactionsResponse;
import com.bluewhale.contracts.billing.v1.UserTransaction;
import com.bluewhale.contracts.common.v1.PageRequest;
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
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(properties = {
        "billing.grpc.enabled=true",
        "billing.grpc.port=0"
})
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class ListTransactionsIntegrationTest {

    private static final long USER = 9501L;
    private static final long OTHER_USER = 9502L;
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

    private static final Map<CreditSource, String> TYPE_OF_SOURCE = new LinkedHashMap<>();

    static {
        TYPE_OF_SOURCE.put(CreditSource.PURCHASED, "recharge");
        TYPE_OF_SOURCE.put(CreditSource.BONUS, "bonus");
        TYPE_OF_SOURCE.put(CreditSource.DAILY, "daily");
        TYPE_OF_SOURCE.put(CreditSource.INVITE, "invite");
        TYPE_OF_SOURCE.put(CreditSource.REDEEM, "redeem");
        TYPE_OF_SOURCE.put(CreditSource.SUBSCRIPTION, "subscription");
        TYPE_OF_SOURCE.put(CreditSource.GIFT, "gift");
        TYPE_OF_SOURCE.put(CreditSource.REGISTER, "gift");
        TYPE_OF_SOURCE.put(CreditSource.COMPENSATION, "compensation");
    }

    @Autowired private Server grpcServer;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private CreditService credits;
    @Autowired private CreditExpirySweeper expirySweeper;
    @Autowired private LedgerRepository ledger;
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

        credits.grant(USER, CreditSource.GIFT, 10_000, null, "grant", "seed", "seed-1");
        credits.grant(OTHER_USER, CreditSource.GIFT, 10_000, null, "grant", "seed", "seed-other");

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
    void 空流水_返回空页且总数为零() {
        ListTransactionsResponse response = list(newPageRequest(20, 1), 9_599L);

        assertThat(response.getItemsList()).isEmpty();
        assertThat(response.getPage().hasTotal()).isTrue();
        assertThat(response.getPage().getTotal()).isZero();
    }


    @Test
    void 发放与预扣_各出一行_字段齐备() {
        stub.hold(hold("cmd-1", 9_101L));

        List<UserTransaction> items = list(newPageRequest(20, 1), USER).getItemsList();

        assertThat(items).hasSize(2);

        UserTransaction consume = rowOf(items, "consume");
        assertThat(consume.getDirection()).isEqualTo("out");
        assertThat(consume.getStatus()).isEqualTo("pending");
        assertThat(consume.getAmount()).isEqualTo(100);
        assertThat(consume.getTitle()).isEqualTo(TITLE);
        assertThat(consume.getSettledAt()).isEmpty();
        assertThat(consume.getCreatedAt()).contains("+08:00");
        assertThat(consume.getId()).startsWith("res:");

        UserTransaction grant = rowOf(items, "gift");
        assertThat(grant.getDirection()).isEqualTo("in");
        assertThat(grant.getStatus()).isEqualTo("done");
        assertThat(grant.getAmount()).isEqualTo(10_000);
        assertThat(grant.getTitle()).isEqualTo("运营赠送");
        assertThat(grant.getSettledAt()).isNotEmpty();
        assertThat(grant.getId()).startsWith("lot:");
    }

    @Test
    void 未结算_显示预计消耗且没有结算时刻() {
        stub.hold(hold("cmd-2", 9_102L));

        UserTransaction pending = rowOf(list(newPageRequest(20, 1), USER).getItemsList(), "consume");

        assertThat(pending.getStatus()).isEqualTo("pending");
        assertThat(pending.getAmount()).isEqualTo(100);
    }

    @Test
    void 别人的流水不会串进来() {
        stub.hold(hold("cmd-3", 9_103L));

        List<UserTransaction> mine = list(newPageRequest(20, 1), USER).getItemsList();
        List<UserTransaction> theirs = list(newPageRequest(20, 1), OTHER_USER).getItemsList();

        assertThat(mine).hasSize(2);
        assertThat(theirs).hasSize(1);
        assertThat(theirs.get(0).getType()).isEqualTo("gift");
    }


    @Test
    void 结算凭证多腿_流水里只出一行() {
        stub.hold(hold("cmd-4", 9_104L));
        credits.settle(9_104L, 30);

        List<UserTransaction> items = list(newPageRequest(20, 1), USER).getItemsList();

        assertThat(ledgerLegsOf("hold:cmd-4")).isEqualTo(2);
        assertThat(ledgerLegsOf("settle:9104")).isEqualTo(3);
        assertThat(items).hasSize(2);
        assertThat(items).filteredOn(item -> item.getType().equals("consume")).hasSize(1);

        UserTransaction consume = rowOf(items, "consume");
        assertThat(consume.getStatus()).isEqualTo("done");
        assertThat(consume.getAmount()).isEqualTo(30);
        assertThat(consume.getSettledAt()).isNotEmpty();
        assertThat(consume.getTitle()).isEqualTo(TITLE);

        assertThat(items).noneMatch(item -> item.getId().startsWith("led:"));
    }

    @Test
    void 全额返还_那条pending行结算到0而不是消失() {
        stub.hold(hold("cmd-5", 9_105L));

        String pendingId = rowOf(list(newPageRequest(20, 1), USER).getItemsList(), "consume").getId();

        credits.refund(9_105L, "任务失败");

        List<UserTransaction> items = list(newPageRequest(20, 1), USER).getItemsList();

        assertThat(items).hasSize(2);

        UserTransaction consume = rowOf(items, "consume");
        assertThat(consume.getDirection()).isEqualTo("out");
        assertThat(consume.getStatus()).isEqualTo("done");
        assertThat(consume.getAmount()).isEqualTo(0);
        assertThat(consume.getId()).isEqualTo(pendingId);
        assertThat(consume.getTitle()).isEqualTo(TITLE + " · 退回");
        assertThat(consume.getSettledAt()).isNotEmpty();

        assertThat(items).noneMatch(item -> item.getId().startsWith("led:"));

        assertThat(list("refund", USER).getItemsList()).isEmpty();
        assertThat(list("consume", USER).getItemsList()).hasSize(1);
    }


    @Test
    void 偏移翻页_跨三类来源不重不漏() {
        long a = credits.grant(USER, CreditSource.DAILY, 10, null, "grant", "d", "page-a");
        long b = credits.grant(USER, CreditSource.INVITE, 20, null, "grant", "i", "page-b");
        long c = credits.grant(USER, CreditSource.REDEEM, 30, null, "grant", "r", "page-c");
        long d = credits.grant(USER, CreditSource.BONUS, 40, null, "grant", "b", "page-d");
        long res = holdAndReturnReservationId("cmd-6", 9_106L);
        long seed = lotIdOf("seed-1");
        jdbc.update("UPDATE billing_credit_lots SET gmt_create = NOW() - INTERVAL 6 HOUR WHERE id = ?", seed);
        jdbc.update("UPDATE billing_credit_lots SET gmt_create = NOW() - INTERVAL 5 HOUR WHERE id = ?", a);
        jdbc.update("UPDATE billing_credit_lots SET gmt_create = NOW() - INTERVAL 4 HOUR WHERE id = ?", b);
        jdbc.update("UPDATE billing_credit_lots SET gmt_create = NOW() - INTERVAL 3 HOUR WHERE id = ?", c);
        jdbc.update("UPDATE billing_credit_lots SET gmt_create = NOW() - INTERVAL 2 HOUR WHERE id = ?", d);
        jdbc.update("UPDATE billing_cost_reservations SET gmt_create = NOW() - INTERVAL 1 HOUR WHERE id = ?", res);

        List<String> seen = new ArrayList<>();
        int pages = 0;
        for (int page = 1; page <= 3; page++) {
            ListTransactionsResponse response = list(newPageRequest(2, page), USER);
            assertThat(response.getItemsList()).hasSizeLessThanOrEqualTo(2);
            assertThat(response.getPage().getTotal()).isEqualTo(6);
            response.getItemsList().forEach(item -> seen.add(item.getId()));
            pages++;
        }

        assertThat(seen).hasSize(6).doesNotHaveDuplicates();
        assertThat(seen).containsExactly(
                "res:" + res, "lot:" + d, "lot:" + c, "lot:" + b, "lot:" + a, "lot:" + seed);
        assertThat(pages).isEqualTo(3);

        ListTransactionsResponse beyond = list(newPageRequest(2, 4), USER);
        assertThat(beyond.getItemsList()).isEmpty();
        assertThat(beyond.getPage().getTotal()).isEqualTo(6);
    }

    @Test
    void 翻页_跨状态转换不重不漏() {
        long a = credits.grant(USER, CreditSource.DAILY, 10, null, "grant", "d", "tr-a");
        long b = credits.grant(USER, CreditSource.INVITE, 20, null, "grant", "i", "tr-b");
        long res = holdAndReturnReservationId("cmd-tr", 9_120L);
        long seed = lotIdOf("seed-1");
        jdbc.update("UPDATE billing_credit_lots SET gmt_create = NOW() - INTERVAL 4 HOUR WHERE id = ?", seed);
        jdbc.update("UPDATE billing_credit_lots SET gmt_create = NOW() - INTERVAL 3 HOUR WHERE id = ?", a);
        jdbc.update("UPDATE billing_credit_lots SET gmt_create = NOW() - INTERVAL 2 HOUR WHERE id = ?", b);
        jdbc.update("UPDATE billing_cost_reservations SET gmt_create = NOW() - INTERVAL 1 HOUR WHERE id = ?", res);

        ListTransactionsResponse first = list(newPageRequest(2, 1), USER);
        assertThat(first.getItemsList()).extracting(UserTransaction::getId)
                .containsExactly("res:" + res, "lot:" + b);
        assertThat(first.getItemsList().get(0).getType()).isEqualTo("consume");
        assertThat(first.getItemsList().get(0).getStatus()).isEqualTo("pending");
        assertThat(first.getPage().getTotal()).isEqualTo(4);

        credits.refund(9_120L, "任务失败");

        ListTransactionsResponse second = list(newPageRequest(2, 2), USER);
        assertThat(second.getItemsList()).extracting(UserTransaction::getId)
                .containsExactly("lot:" + a, "lot:" + seed);
        assertThat(second.getPage().getTotal()).isEqualTo(4);

        List<String> seen = new ArrayList<>();
        first.getItemsList().forEach(item -> seen.add(item.getId()));
        second.getItemsList().forEach(item -> seen.add(item.getId()));
        assertThat(seen).hasSize(4).doesNotHaveDuplicates();
        assertThat(list("consume", USER).getItemsList()).hasSize(1);
        assertThat(list("refund", USER).getItemsList()).isEmpty();
    }

    @Test
    void 页码小于一_夹到第一页而不是报错() {
        List<String> firstPage = idsOf(list(newPageRequest(20, 1), USER));

        assertThat(idsOf(list(newPageRequest(20, 0), USER))).containsExactlyElementsOf(firstPage);
        assertThat(idsOf(list(newPageRequest(20, -3), USER))).containsExactlyElementsOf(firstPage);
    }

    private static List<String> idsOf(ListTransactionsResponse response) {
        return response.getItemsList().stream().map(UserTransaction::getId).toList();
    }


    @Test
    void 类型过滤_空字符串等于全部() {
        credits.grant(USER, CreditSource.DAILY, 10, null, "grant", "d", "filter-daily");
        stub.hold(hold("cmd-7", 9_107L));

        List<String> types = list(newPageRequest(20, 1), USER).getItemsList().stream()
                .map(UserTransaction::getType)
                .toList();
        assertThat(types).containsExactlyInAnyOrder("gift", "daily", "consume");

        assertThat(list(PageRequest.newBuilder().setPageSize(0).build(), USER).getItemsList())
                .hasSize(3);
    }

    @Test
    void 类型过滤_只返回该类型() {
        credits.grant(USER, CreditSource.DAILY, 10, null, "grant", "d", "filter-daily");
        stub.hold(hold("cmd-8", 9_108L));

        List<UserTransaction> consume = list("consume", USER).getItemsList();
        assertThat(consume).hasSize(1);
        assertThat(consume.get(0).getStatus()).isEqualTo("pending");

        List<UserTransaction> daily = list("daily", USER).getItemsList();
        assertThat(daily).hasSize(1);
        assertThat(daily.get(0).getAmount()).isEqualTo(10);

        assertThat(list("refund", USER).getItemsList()).isEmpty();
    }

    @Test
    void 类型过滤_可多值_一次取消耗与过期() {
        credits.grant(USER, CreditSource.DAILY, 10, null, "grant", "d", "filter-multi");
        stub.hold(hold("cmd-9", 9_109L));

        List<String> types = list(List.of("consume", "expire"), newPageRequest(20, 1), USER)
                .getItemsList().stream()
                .map(UserTransaction::getType)
                .toList();
        assertThat(types).containsExactly("consume");

        assertThatThrownBy(() -> list(List.of("consume", "bogus"), newPageRequest(20, 1), USER))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> assertThat(
                        ((StatusRuntimeException) thrown).getStatus().getCode())
                        .isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    @Test
    void 未配的类型_映射成INVALID_ARGUMENT() {
        assertThatThrownBy(() -> list("recharg", USER))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> {
                    Status status = ((StatusRuntimeException) thrown).getStatus();
                    assertThat(status.getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
                    assertThat(status.getDescription()).contains("recharg");
                });
    }


    @Test
    void 发放来源_逐个映射到用户可见类型() {
        assertThat(TYPE_OF_SOURCE).containsOnlyKeys(CreditSource.values());

        for (CreditSource source : CreditSource.values()) {
            credits.grant(USER, source, 1_000 + source.ordinal(), null,
                    "grant", source.key(), "src-" + source.key());
        }

        List<UserTransaction> items = list(newPageRequest(50, 1), USER).getItemsList();

        for (CreditSource source : CreditSource.values()) {
            long amount = 1_000 + source.ordinal();
            assertThat(items)
                    .filteredOn(item -> item.getAmount() == amount)
                    .singleElement()
                    .satisfies(item -> {
                        assertThat(item.getType()).isEqualTo(TYPE_OF_SOURCE.get(source));
                        assertThat(item.getDirection()).isEqualTo("in");
                        assertThat(item.getStatus()).isEqualTo("done");
                    });
        }
    }

    @Test
    void 过期核销_按账本凭证出一行() {
        ledger.insert(Voucher.base("expire:user-9501:2026-09", USER, BizType.EXPIRE, "2026-09")
                .debit(Account.WALLET, 500, "过期核销")
                .credit(Account.COST, 500, "过期核销")
                .build());

        List<UserTransaction> items = list("expire", USER).getItemsList();

        assertThat(items).hasSize(1);
        UserTransaction expired = items.get(0);
        assertThat(expired.getId()).startsWith("led:");
        assertThat(expired.getType()).isEqualTo("expire");
        assertThat(expired.getDirection()).isEqualTo("out");
        assertThat(expired.getAmount()).isEqualTo(500);
        assertThat(expired.getStatus()).isEqualTo("done");
        assertThat(expired.getSettledAt()).isNotEmpty();
    }

    @Test
    void 过期核销_走真实核销路径_流水里出一行积分过期() {
        long lot = credits.grant(USER, CreditSource.GIFT, 700,
                Instant.now().minus(1, ChronoUnit.HOURS), "grant", "exp-live", "exp-live");

        CreditExpirySweeper.SweepResult result = expirySweeper.sweepOnce();
        assertThat(result.expiredCredits()).as("到期的 700 分应被核销").isEqualTo(700);

        List<UserTransaction> items = list("expire", USER).getItemsList();

        assertThat(items).hasSize(1);
        UserTransaction expired = items.get(0);
        assertThat(expired.getType()).isEqualTo("expire");
        assertThat(expired.getTitle()).isEqualTo("积分过期");
        assertThat(expired.getDirection()).as("过期是用户资产减少").isEqualTo("out");
        assertThat(expired.getAmount()).isEqualTo(700);
        assertThat(expired.getId())
                .as("一凭证一行：键由行上的科目反推（expire:{lotId}:{version}），不是按位置切割")
                .startsWith("led:expire:" + lot);
    }


    private ListTransactionsResponse list(PageRequest page, long userId) {
        return list("", page, userId);
    }

    private ListTransactionsResponse list(String typeFilter, long userId) {
        return list(typeFilter, newPageRequest(20, 1), userId);
    }

    private ListTransactionsResponse list(String typeFilter, PageRequest page, long userId) {
        return list(typeFilter.isEmpty() ? List.of() : List.of(typeFilter), page, userId);
    }

    private ListTransactionsResponse list(List<String> typeFilters, PageRequest page, long userId) {
        return stub.listTransactions(ListTransactionsRequest.newBuilder()
                .setUserId(userId)
                .addAllTypeFilters(typeFilters)
                .setPage(page)
                .build());
    }

    private static PageRequest newPageRequest(int size, int page) {
        return PageRequest.newBuilder().setPageSize(size).setPage(page).build();
    }

    private static UserTransaction rowOf(List<UserTransaction> items, String type) {
        List<UserTransaction> matched = items.stream()
                .filter(item -> item.getType().equals(type))
                .toList();
        assertThat(matched).as("类型 %s 的行数", type).hasSize(1);
        return matched.get(0);
    }

    private HoldRequest hold(String commandId, long jobId) {
        return HoldRequest.newBuilder()
                .setUserId(USER)
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

    private long holdAndReturnReservationId(String commandId, long jobId) {
        stub.hold(hold(commandId, jobId));
        return jdbc.queryForObject(
                "SELECT id FROM billing_cost_reservations WHERE generation_job_id = ?",
                Long.class, jobId);
    }

    private int ledgerLegsOf(String idempotencyBase) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_ledger_entries WHERE idempotency_key LIKE ?",
                Integer.class, idempotencyBase + ":%");
        return count == null ? 0 : count;
    }

    private long lotIdOf(String grantKey) {
        return jdbc.queryForObject(
                "SELECT id FROM billing_credit_lots WHERE grant_key = ?", Long.class, grantKey);
    }
}
