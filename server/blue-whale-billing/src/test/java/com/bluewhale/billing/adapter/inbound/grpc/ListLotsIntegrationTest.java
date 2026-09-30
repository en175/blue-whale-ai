package com.bluewhale.billing.adapter.inbound.grpc;

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

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@code ListLots} 的**端到端**测试：真库 + 真 gRPC 端口。
 *
 * <p>它是「已获取」页签的数据源 —— 与 {@code ListTransactions}（流水）是两个维度：
 * 流水「一个业务动作一行」，批次「一笔发放一行」。**到期明细只有这条给得出**，
 * 因为流水行没有 {@code expires_at}（PRD §9.5 要求用户侧能查到期明细）。
 *
 * <h2>本文件钉住的三条</h2>
 *
 * <ol>
 *   <li><b>越权闸</b>——{@code user_id <= 0} 直接拒，**不是**返回空页、更不是查全部。
 *       用户面没有「不限用户」这个模式（运营面才有 {@code user_id = 0 = 全站}）。
 *       见 {@link #用户id非正_直接拒而不是返回空页()}</li>
 *   <li><b>台账是完整的</b>——用光的、已过期的批次同样在列表里。
 *       少了它们，「我已获取」会变成一份自己缩短的清单。
 *       见 {@link #用光与已过期的批次依然在台账里()}</li>
 *   <li><b>{@code remaining} 是可用量</b>（{@code remaining − frozen}），不是表里那一列：
 *       冻结中的部分已经许给在途任务，对用户来说「不能用」。
 *       见 {@link #冻结中的部分不算在剩余里()}</li>
 * </ol>
 *
 * <p>门控与其它集成测试同一口径（{@code BILLING_DB_PASSWORD}）：这一条的价值全在
 * **「筛了什么、没筛什么」** 上，mock 掉库就只是在测自己的期望。
 */
@SpringBootTest(properties = {
        "billing.grpc.enabled=true",
        "billing.grpc.port=0"
})
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class ListLotsIntegrationTest {

    private static final long USER = 9601L;
    private static final long OTHER_USER = 9602L;

    /** 起一个 active 目录：Hold 才用得到，但上下文启动会读它。 */
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

    // ─────────────────────────────────────────────────────────────
    // 越权闸
    // ─────────────────────────────────────────────────────────────

    /**
     * ★ {@code user_id <= 0} 一律拒。
     *
     * <p>⚠️ 为什么是报错而不是空页：调用方（backend）只会填会话解析出来的 id，
     * 那个值恒 &gt; 0。收到 0 说明上游写错了、或者有人在试探 —— 两种都该吵得响，
     * 而不是安静地回一页空数据让人以为「这个人没有批次」。
     *
     * <p>⚠️ 也不要「顺手」把它实现成运营面那种 {@code 0 = 全部用户}：用户面开这个口子
     * 等于给每个持 token 的调用者一份全站台账。
     */
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

    /**
     * 别人的批次不会串进来。
     *
     * <p>两个用户各发一批，只查自己的那个 —— 上游 SQL 是 {@code WHERE user_id = ?}，
     * 但这条断言是**对外行为**上的保证：调用方永远只拿得到自己那份。
     */
    @Test
    void 别人的批次不会串进来() {
        credits.grant(USER, CreditSource.PURCHASED, 600, null, "recharge", "BW-1", "lot-u");
        credits.grant(OTHER_USER, CreditSource.PURCHASED, 999, null, "recharge", "BW-2", "lot-o");

        List<UserCreditLot> mine = list(USER, 20, 1).getItemsList();
        assertThat(mine).hasSize(1);
        assertThat(mine.get(0).getAmount()).isEqualTo(600);
        assertThat(mine.get(0).getBizId()).isEqualTo("BW-1");
    }

    // ─────────────────────────────────────────────────────────────
    // 台账是完整的
    // ─────────────────────────────────────────────────────────────

    /**
     * ★ 用光的、已过期的批次**依然在列表里**。
     *
     * <p>⚠️ 这一条和 {@code listExpiring} 是相反的取向，不要照着那边加过滤：
     * 那条问的是「该提醒我什么」，这条问的是「我拿到过什么」。抹掉用光/过期的批次
     * 等于让一行从用户眼皮底下消失 —— 与流水里 released 行凭空消失是同一类问题。
     */
    @Test
    void 用光与已过期的批次依然在台账里() {
        long usedUp = credits.grant(USER, CreditSource.GIFT, 500, null, "grant", "g1", "lot-used");
        long expired = credits.grant(USER, CreditSource.DAILY, 300,
                Instant.now().minus(1, ChronoUnit.DAYS), "grant", "g2", "lot-expired");

        // 直接改库造出「用光」这一态（走真实结算路径要建 job/预留，与本条无关）
        jdbc.update("UPDATE billing_credit_lots SET remaining = 0 WHERE id = ?", usedUp);

        List<UserCreditLot> items = list(USER, 20, 1).getItemsList();
        assertThat(items).extracting(UserCreditLot::getLotId)
                .containsExactlyInAnyOrder(String.valueOf(usedUp), String.valueOf(expired));
        assertThat(list(USER, 20, 1).getPage().getTotal()).isEqualTo(2);

        // 用光的那一行可用量是 0，但它**在**列表里；不是「查不到」也不是被过滤掉
        assertThat(items)
                .filteredOn(item -> item.getLotId().equals(String.valueOf(usedUp)))
                .singleElement()
                .satisfies(item -> {
                    assertThat(item.getRemaining()).isZero();
                    assertThat(item.getAmount()).isEqualTo(500);
                });
    }

    /** 到期时间为空 = 永久有效；契约用空串表达（proto3 的 string 没有 null）。 */
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
                Instant.now().plus(730, ChronoUnit.DAYS), "recharge", "BW-4", "lot-dated");

        assertThat(list(USER, 20, 1).getItemsList().get(0).getExpiresAt()).isNotBlank();
    }

    // ─────────────────────────────────────────────────────────────
    // remaining 是可用量
    // ─────────────────────────────────────────────────────────────

    /**
     * ★ 冻结中的部分**不算**在「剩余」里。
     *
     * <p>{@code remaining} 在契约里是「该批尚未消耗的**可用量**」，不是表里那一列 ——
     * 冻结（预扣）已经把这笔钱许给在途任务了，对用户来说不能用。
     * 与 {@code available_credits} / {@code by_source} 同一个口径（那两处也是
     * {@code remaining − frozen}），三个数才能对得上。
     */
    @Test
    void 冻结中的部分不算在剩余里() {
        long lot = credits.grant(USER, CreditSource.PURCHASED, 600, null, "recharge", "BW-5", "lot-frozen");
        jdbc.update("UPDATE billing_credit_lots SET frozen = 100 WHERE id = ?", lot);

        UserCreditLot row = list(USER, 20, 1).getItemsList().get(0);
        assertThat(row.getAmount()).isEqualTo(600);
        assertThat(row.getRemaining()).as("600 − 100 冻结").isEqualTo(500);
    }

    // ─────────────────────────────────────────────────────────────
    // 分页
    // ─────────────────────────────────────────────────────────────

    @Test
    void 分页_总数与切分正确() {
        for (int i = 0; i < 5; i++) {
            credits.grant(USER, CreditSource.GIFT, 10 + i, null, "grant", "g" + i, "lot-p" + i);
        }

        ListLotsResponse first = list(USER, 2, 1);
        assertThat(first.getItemsList()).hasSize(2);
        assertThat(first.getPage().getTotal()).isEqualTo(5);

        assertThat(list(USER, 2, 3).getItemsList()).hasSize(1);
        // 越界页：空列表 + 总数照旧，不报错
        assertThat(list(USER, 2, 9).getItemsList()).isEmpty();
        assertThat(list(USER, 2, 9).getPage().getTotal()).isEqualTo(5);
    }

    // ─────────────────────────────────────────────────────────────

    private ListLotsResponse list(long userId, int pageSize, int page) {
        return stub.listLots(ListLotsRequest.newBuilder()
                .setUserId(userId)
                .setPage(PageRequest.newBuilder().setPageSize(pageSize).setPage(page))
                .build());
    }
}
