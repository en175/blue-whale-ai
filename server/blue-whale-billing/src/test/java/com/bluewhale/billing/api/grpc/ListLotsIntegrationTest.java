package com.bluewhale.billing.api.grpc;

import com.bluewhale.billing.application.CatalogHolder;
import com.bluewhale.billing.application.CreditService;
import com.bluewhale.billing.domain.ledger.CreditSource;
import com.bluewhale.contracts.billing.v1.BillingServiceGrpc;
import com.bluewhale.contracts.billing.v1.ListLotsRequest;
import com.bluewhale.contracts.billing.v1.ListLotsResponse;
import com.bluewhale.contracts.billing.v1.UserCreditLot;
import com.bluewhale.contracts.common.v1.PageRequest;
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
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(properties = {
        "billing.grpc.enabled=true",
        "billing.grpc.port=0"
})
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class ListLotsIntegrationTest {

    private static final long USER = 9601L;
    private static final long OTHER_USER = 9602L;

    private static final String CATALOG = """
            {"schemaVersion":1,"currency":"CNY","creditsPerYuan":15,
             "discountPolicy":{"stackMode":"multiply","floorFactorBp":3000}}
            """;

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
    void 用户id非正_直接拒而不是返回空页() {
        for (long bad : new long[] {0L, -1L}) {
            assertThatThrownBy(() -> list(bad, 20, 1))
                    .as("user_id = %s", bad)
                    .isInstanceOf(StatusRuntimeException.class)
                    .satisfies(thrown -> {
                        Status status = ((StatusRuntimeException) thrown).getStatus();
                        assertThat(status.getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
                        assertThat(status.getDescription()).contains("user_id");
                    });
        }
    }

    @Test
    void 别人的批次不会串进来() {
        credits.grant(USER, CreditSource.PURCHASED, 600, null, "recharge", "BW-1", "lot-u");
        credits.grant(OTHER_USER, CreditSource.PURCHASED, 999, null, "recharge", "BW-2", "lot-o");

        List<UserCreditLot> mine = list(USER, 20, 1).getItemsList();
        assertThat(mine).hasSize(1);
        assertThat(mine.get(0).getAmount()).isEqualTo(600);
        assertThat(mine.get(0).getBizId()).isEqualTo("BW-1");
    }


    @Test
    void 用光与已过期的批次依然在台账里() {
        long usedUp = credits.grant(USER, CreditSource.GIFT, 500, null, "grant", "g1", "lot-used");
        long expired = credits.grant(USER, CreditSource.DAILY, 300,
                LocalDateTime.now().minus(1, ChronoUnit.DAYS), "grant", "g2", "lot-expired");

        jdbc.update("UPDATE billing_credit_lots SET remaining = 0 WHERE id = ?", usedUp);

        List<UserCreditLot> items = list(USER, 20, 1).getItemsList();
        assertThat(items).extracting(UserCreditLot::getLotId)
                .containsExactlyInAnyOrder(String.valueOf(usedUp), String.valueOf(expired));
        assertThat(list(USER, 20, 1).getPage().getTotal()).isEqualTo(2);

        assertThat(items)
                .filteredOn(item -> item.getLotId().equals(String.valueOf(usedUp)))
                .singleElement()
                .satisfies(item -> {
                    assertThat(item.getRemaining()).isZero();
                    assertThat(item.getAmount()).isEqualTo(500);
                });
    }

    @Test
    void 永久批次_到期时间为空串() {
        credits.grant(USER, CreditSource.PURCHASED, 600, null, "recharge", "BW-3", "lot-forever");

        UserCreditLot row = list(USER, 20, 1).getItemsList().get(0);
        assertThat(row.getExpiresAt()).isEmpty();
        assertThat(row.getCreatedAt()).isNotBlank();
    }

    @Test
    void 有效期批次_到期时间非空() {
        credits.grant(USER, CreditSource.PURCHASED, 600,
                LocalDateTime.now().plus(730, ChronoUnit.DAYS), "recharge", "BW-4", "lot-dated");

        assertThat(list(USER, 20, 1).getItemsList().get(0).getExpiresAt()).isNotBlank();
    }


    @Test
    void 冻结中的部分不算在剩余里() {
        long lot = credits.grant(USER, CreditSource.PURCHASED, 600, null, "recharge", "BW-5", "lot-frozen");
        jdbc.update("UPDATE billing_credit_lots SET frozen = 100 WHERE id = ?", lot);

        UserCreditLot row = list(USER, 20, 1).getItemsList().get(0);
        assertThat(row.getAmount()).isEqualTo(600);
        assertThat(row.getRemaining()).as("600 − 100 冻结").isEqualTo(500);
    }


    @Test
    void 分页_总数与切分正确() {
        for (int i = 0; i < 5; i++) {
            credits.grant(USER, CreditSource.GIFT, 10 + i, null, "grant", "g" + i, "lot-p" + i);
        }

        ListLotsResponse first = list(USER, 2, 1);
        assertThat(first.getItemsList()).hasSize(2);
        assertThat(first.getPage().getTotal()).isEqualTo(5);

        assertThat(list(USER, 2, 3).getItemsList()).hasSize(1);
        assertThat(list(USER, 2, 9).getItemsList()).isEmpty();
        assertThat(list(USER, 2, 9).getPage().getTotal()).isEqualTo(5);
    }


    private ListLotsResponse list(long userId, int pageSize, int page) {
        return stub.listLots(ListLotsRequest.newBuilder()
                .setUserId(userId)
                .setPage(PageRequest.newBuilder().setPageSize(pageSize).setPage(page))
                .build());
    }
}
