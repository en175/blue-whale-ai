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

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@code ListTransactions} 的**端到端**测试：真库 + 真 gRPC 端口 + 真实的预扣/结算路径。
 *
 * <p>它替掉的是 new-api 的 {@code GET /api/log/self}——统一 key 之后那边返回的是
 * **项目维度**的数，不是调用者的（ADR-0114）。所以这一页必须由 billing 自己答。
 *
 * <h2>本文件钉住的三条契约约束</h2>
 *
 * <ol>
 *   <li><b>一个业务动作一行</b>——账本是复式的（预扣 2 腿、结算 3 腿），
 *       把分录直接摊给用户会变成「同一个操作扣了两次」。
 *       {@link #结算凭证多腿_流水里只出一行()} 用真实凭证把这条钉住。</li>
 *   <li><b>永远只有一个金额</b>——{@code UserTransaction} 没有 reserved_amount 字段。
 *       未结算的行（pending）用**同一个 amount 字段**显示预计消耗，结算后变成实际消耗，
 *       见 {@link #未结算_显示预计消耗且没有结算时刻()}。</li>
 *   <li><b>游标分页</b>——{@code PageResponse} 只有 next_page_token（没有总数），
 *       且账本与流水持续新增，offset 会漏数据。见 {@link #游标翻页_跨三类来源不重不漏()}。</li>
 *   <li><b>退回不新增一行、也不另立类型</b>——任务失败全额退回就是「结算到 0」，
 *       那条 pending 行原地变成 {@code amount=0} 的消费行（{@code id} 不变、方向恒 out），
 *       预扣额另走管理面的 {@code reserved_credits} 注解。不是「消费一行 + 退回一行」，
 *       也不是「退款 +N」——后者会让流水里多出一笔无对应支出的进账。
 *       见 {@link #全额返还_那条pending行结算到0而不是消失()}。</li>
 * </ol>
 *
 * <p>门控与其它集成测试同一口径（{@code BILLING_DB_PASSWORD}）：本切片的价值全在
 * **跨三张表的投影**上，mock 掉任何一张表，测的就只是自己的期望。
 */
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

    /**
     * 目录：只有换算率与折扣策略（**规则不在目录里**——它随每次 Hold 请求送来）。
     *
     * <p>仍然要发一份：预扣要把 {@code catalog_version} 冻进预留行。
     */
    private static final String CATALOG = """
            {"schemaVersion":1,"currency":"CNY","creditsPerYuan":15,
             "discountPolicy":{"stackMode":"multiply","floorFactorBp":3000}}
            """;

    /**
     * 规则快照：单价 100000 mc → 100 积分（mc 只在计价管线内部）。
     *
     * <p>形态 = 能力行的 {@code pricing} 列，随每次 Hold 请求送来。
     */
    private static final String RULE = """
            {"baseUnit":"constant:1","basePrice":{"kind":"const","value":100000},
             "unitDenominator":1,"minCredits":1}
            """;

    /**
     * 发放来源 → 用户可见类型。
     *
     * <p>每个 {@link CreditSource} 都必须在这里表态：{@link #发放来源_逐个映射到用户可见类型()}
     * 会断言本表**覆盖全部枚举值**，所以新增来源时这条会红——而不是让它在界面上
     * 悄悄归进错误的类别（register 在契约的类型枚举里没有对应值，归入 gift）。
     */
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

        // 两个用户各有起点 10000 积分：用来验「别人的流水不会串到我这里」
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

    // ─────────────────────────────────────────────────────────────
    // 空流水
    // ─────────────────────────────────────────────────────────────

    @Test
    void 空流水_返回空页且不给下一页游标() {
        // 一个从没发生过任何动作的用户
        ListTransactionsResponse response = list(newPageRequest(20, ""), 9_599L);

        // 空 ≠ 未实现：这一页必须答得出来（曾经这里是 UNIMPLEMENTED，
        // 调用方只能把「还没做」显示成「暂无记录」）
        assertThat(response.getItemsList()).isEmpty();
        assertThat(response.getPage().getNextPageToken()).isEmpty();
    }

    // ─────────────────────────────────────────────────────────────
    // 两类来源的合并
    // ─────────────────────────────────────────────────────────────

    @Test
    void 发放与预扣_各出一行_字段齐备() {
        stub.hold(hold("cmd-1", 9_101L));

        List<UserTransaction> items = list(newPageRequest(20, ""), USER).getItemsList();

        // 两行：setUp 的发放 + 这次预扣产生的「处理中」消费行
        assertThat(items).hasSize(2);

        UserTransaction consume = rowOf(items, "consume");
        assertThat(consume.getDirection()).isEqualTo("out");
        assertThat(consume.getStatus()).isEqualTo("pending");
        assertThat(consume.getAmount()).isEqualTo(100);
        // 展示文案是提交时的快照（HoldRequest.title），不是事后拼的
        assertThat(consume.getTitle()).isEqualTo(TITLE);
        // 未结算没有「结算时刻」
        assertThat(consume.getSettledAt()).isEmpty();
        // RFC3339 带时区（契约约定，与 QueryBalance 同口径）
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

        UserTransaction pending = rowOf(list(newPageRequest(20, ""), USER).getItemsList(), "consume");

        // ★ 「任何用户可见界面永远只出现一个金额」：UserTransaction 里没有 reserved_amount，
        //    未结算行的金额就落在这唯一的 amount 字段上——它是预扣时按契约用量算出的
        //    **预计消耗**（《计费逻辑详细设计》§2.3：「处理中 · 预计消耗 40」）。
        //    预扣明细（分配了哪些批次、冻结了多少）只对客服/运营后台可见。
        assertThat(pending.getStatus()).isEqualTo("pending");
        assertThat(pending.getAmount()).isEqualTo(100);
    }

    @Test
    void 别人的流水不会串进来() {
        stub.hold(hold("cmd-3", 9_103L));

        List<UserTransaction> mine = list(newPageRequest(20, ""), USER).getItemsList();
        List<UserTransaction> theirs = list(newPageRequest(20, ""), OTHER_USER).getItemsList();

        // 每人各一行发放 + 只有我这个用户有消费
        assertThat(mine).hasSize(2);
        assertThat(theirs).hasSize(1);
        assertThat(theirs.get(0).getType()).isEqualTo("gift");
    }

    // ─────────────────────────────────────────────────────────────
    // 一条业务动作一行（账本多腿 → 用户一行）
    // ─────────────────────────────────────────────────────────────

    @Test
    void 结算凭证多腿_流水里只出一行() {
        stub.hold(hold("cmd-4", 9_104L));          // 预扣：借 wallet / 贷 frozen，2 腿
        credits.settle(9_104L, 30);                // 结算：解冻 100 + 消耗 30 + 退 70，3 腿

        List<UserTransaction> items = list(newPageRequest(20, ""), USER).getItemsList();

        // 本用户此刻只有两个业务动作：一次发放、一次消费。分录却有 5 条。
        assertThat(ledgerLegsOf("hold:cmd-4")).isEqualTo(2);
        assertThat(ledgerLegsOf("settle:9104")).isEqualTo(3);
        assertThat(items).hasSize(2);
        assertThat(items).filteredOn(item -> item.getType().equals("consume")).hasSize(1);

        UserTransaction consume = rowOf(items, "consume");
        assertThat(consume.getStatus()).isEqualTo("done");
        // ★ 金额是**最终值**：结算定下来的实际消耗 30，不是预扣的 100
        assertThat(consume.getAmount()).isEqualTo(30);
        assertThat(consume.getSettledAt()).isNotEmpty();
        assertThat(consume.getTitle()).isEqualTo(TITLE);

        // 预扣凭证不出行：它不改用户总资产（钱只是从可用挪到冻结）。
        // 结算凭证也不出行：它的用户可见形态就是上面这一行——
        // 若按分录逐腿暴露，这里会是 2 + 3 = 5 行，用户看到的是「一次操作扣了两次」。
        assertThat(items).noneMatch(item -> item.getId().startsWith("led:"));
    }

    @Test
    void 全额返还_那条pending行结算到0而不是消失() {
        stub.hold(hold("cmd-5", 9_105L));

        // 先记下「处理中」那一刻的 id —— 结算到 0 之后这行必须**还是它**
        String pendingId = rowOf(list(newPageRequest(20, ""), USER).getItemsList(), "consume").getId();

        credits.refund(9_105L, "任务失败");

        List<UserTransaction> items = list(newPageRequest(20, ""), USER).getItemsList();

        // 两行：setUp 的发放 + 这条消费。**那行没有消失**。
        // 用户提交时已经看到过那条「-100 处理中」（可用余额也确实降过），
        // 失败后让它凭空消失，等于流水在用户眼皮底下少了一行。
        assertThat(items).hasSize(2);

        UserTransaction consume = rowOf(items, "consume");
        // ★ 退回不是另一种流水，是「结算到 0」——与多退少补同一条口径：
        //    行里取终态实际值，预扣额另走管理面的 reserved_credits 注解。
        assertThat(consume.getDirection()).isEqualTo("out");
        assertThat(consume.getStatus()).isEqualTo("done");
        // 全额退回就是退到 0 —— 这笔钱从头到尾没真正被扣走
        assertThat(consume.getAmount()).isEqualTo(0);
        // ★ 同一个 job 只有一条预留（uk_reservation__job），所以是**替换不是新增**：
        //    id 与那条 pending 行逐字相同，永远不会出现「消费一行 + 退回一行」
        assertThat(consume.getId()).isEqualTo(pendingId);
        // 文案以预扣时的快照作前缀 + 「 · 退回」后缀 —— 金额是 0，这一句是它唯一的解释。
        // ⚠️ 刻意**不用** Reservation.releaseNote —— 那列装的是「任务失败」这类内部原文，
        //    还有「超时兜底释放」那种更不该对客的说法；这一行就是钉「没用它」。
        assertThat(consume.getTitle()).isEqualTo(TITLE + " · 退回");
        assertThat(consume.getSettledAt()).isNotEmpty();

        // 退回凭证（借 frozen / 贷 wallet，净变化 0）本身依然不出行
        assertThat(items).noneMatch(item -> item.getId().startsWith("led:"));

        // 类型过滤：refund 这条路径已经没有来源了（预留表不再产它），查它永远是空页；
        // 而那行退回后仍是 consume —— 用户端消费页签因此**看得见**它，不用改前端。
        assertThat(list("refund", USER).getItemsList()).isEmpty();
        assertThat(list("consume", USER).getItemsList()).hasSize(1);
    }

    // ─────────────────────────────────────────────────────────────
    // 分页（游标）
    // ─────────────────────────────────────────────────────────────

    @Test
    void 游标翻页_跨三类来源不重不漏() {
        // 六条业务动作：一次发放（setUp）+ 四次发放 + 一次预扣。
        // 时间用 INTERVAL 拉开——DATETIME 只到秒，靠同一秒内的次级键排序是另一条测试的事。
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
        String token = "";
        int pages = 0;
        do {
            ListTransactionsResponse page = list(newPageRequest(2, token), USER);
            assertThat(page.getItemsList()).hasSizeLessThanOrEqualTo(2);
            page.getItemsList().forEach(item -> seen.add(item.getId()));
            token = page.getPage().getNextPageToken();
            pages++;
        } while (!token.isEmpty() && pages < 10);

        // 每页 2 行 → 3 页；6 条动作的 id 恰好各出现一次：
        // 不漏（6 条都在）也不重（没有重复 id）——游标是「严格排在最后一条之后」，
        // 而排序三元组全是不可变量，所以翻页途中新插入的行只会出现在更前面。
        assertThat(seen).hasSize(6).doesNotHaveDuplicates();
        assertThat(seen).containsExactly(
                "res:" + res, "lot:" + d, "lot:" + c, "lot:" + b, "lot:" + a, "lot:" + seed);
        assertThat(pages).isEqualTo(3);
    }

    /**
     * 翻页途中那行**原地转换**——排序三元组不变，所以既不重复也不漏。
     *
     * <p>这是本设计最依赖的一条不变量：预留行由 {@code held} 转 {@code settled} 或
     * {@code released} 时，{@code amount} 与 {@code status} 变
     * （{@code type}/{@code direction} 现在恒为 {@code consume}/{@code out} —— 退回是结算到 0，
     * 不另立形态），
     * 但 {@code created_at}（= {@code gmt_create}，DDL 上没有 ON UPDATE）、
     * {@code kind}（字面量）、{@code src_id}（= {@code id}）三个都不动。
     * 客户端拿上一页的 token 接着翻时，那一行既不会被当成新行重新出现，也不会被跳过。
     */
    @Test
    void 游标翻页_跨状态转换不重不漏() {
        long a = credits.grant(USER, CreditSource.DAILY, 10, null, "grant", "d", "tr-a");
        long b = credits.grant(USER, CreditSource.INVITE, 20, null, "grant", "i", "tr-b");
        long res = holdAndReturnReservationId("cmd-tr", 9_120L);
        long seed = lotIdOf("seed-1");
        jdbc.update("UPDATE billing_credit_lots SET gmt_create = NOW() - INTERVAL 4 HOUR WHERE id = ?", seed);
        jdbc.update("UPDATE billing_credit_lots SET gmt_create = NOW() - INTERVAL 3 HOUR WHERE id = ?", a);
        jdbc.update("UPDATE billing_credit_lots SET gmt_create = NOW() - INTERVAL 2 HOUR WHERE id = ?", b);
        jdbc.update("UPDATE billing_cost_reservations SET gmt_create = NOW() - INTERVAL 1 HOUR WHERE id = ?", res);

        // 第一页（倒序取 2 行）= 最新的两行：预留 + b。预留那行此刻还是「处理中」
        ListTransactionsResponse first = list(newPageRequest(2, ""), USER);
        assertThat(first.getItemsList()).extracting(UserTransaction::getId)
                .containsExactly("res:" + res, "lot:" + b);
        assertThat(first.getItemsList().get(0).getType()).isEqualTo("consume");
        assertThat(first.getItemsList().get(0).getStatus()).isEqualTo("pending");
        String token = first.getPage().getNextPageToken();
        assertThat(token).as("后面还有行，游标必须给出").isNotEmpty();

        // ★ 拿到 token 之后、翻第二页之前，第一页那行**换了形态**
        credits.refund(9_120L, "任务失败");

        // 第二页照旧：不重复第一页的行，也没漏掉剩下的
        ListTransactionsResponse second = list(newPageRequest(2, token), USER);
        assertThat(second.getItemsList()).extracting(UserTransaction::getId)
                .containsExactly("lot:" + a, "lot:" + seed);
        assertThat(second.getPage().getNextPageToken()).isEmpty();

        // 四行、id 各一次；那行现在结算到 0（仍是 consume），而且**只出现一次**
        List<String> seen = new ArrayList<>();
        first.getItemsList().forEach(item -> seen.add(item.getId()));
        second.getItemsList().forEach(item -> seen.add(item.getId()));
        assertThat(seen).hasSize(4).doesNotHaveDuplicates();
        assertThat(list("consume", USER).getItemsList()).hasSize(1);
        assertThat(list("refund", USER).getItemsList()).isEmpty();
    }

    @Test
    void 坏游标_映射成INVALID_ARGUMENT而不是当首页重来() {
        // 两种坏法：不是合法 base64，以及是合法 base64 但格式/版本不对
        String notBase64 = "!!!!";
        String wrongVersion = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("2|1|grant|1".getBytes(StandardCharsets.UTF_8));

        for (String token : List.of(notBase64, wrongVersion)) {
            assertThatThrownBy(() -> list(newPageRequest(20, token), USER))
                    .isInstanceOf(StatusRuntimeException.class)
                    .satisfies(thrown -> {
                        Status status = ((StatusRuntimeException) thrown).getStatus();
                        // 静默当首页，界面会「翻着翻着自己跳回顶部」，而日志里什么都看不出来
                        assertThat(status.getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
                        assertThat(status.getDescription()).contains("游标");
                    });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 类型过滤
    // ─────────────────────────────────────────────────────────────

    @Test
    void 类型过滤_空字符串等于全部() {
        credits.grant(USER, CreditSource.DAILY, 10, null, "grant", "d", "filter-daily");
        stub.hold(hold("cmd-7", 9_107L));

        List<String> types = list(newPageRequest(20, ""), USER).getItemsList().stream()
                .map(UserTransaction::getType)
                .toList();
        assertThat(types).containsExactlyInAnyOrder("gift", "daily", "consume");

        // page_size 缺省（0）：按服务端默认值答，不是返回空页
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

        // 没有该类型的行 = 空页（与「类型非法」是两回事，后者见下一条）
        assertThat(list("refund", USER).getItemsList()).isEmpty();
    }

    @Test
    void 未配的类型_映射成INVALID_ARGUMENT() {
        assertThatThrownBy(() -> list("recharg", USER))
                .isInstanceOf(StatusRuntimeException.class)
                .satisfies(thrown -> {
                    Status status = ((StatusRuntimeException) thrown).getStatus();
                    // ★ 不能返回空列表：空列表与「真的没有充值记录」长得一模一样，
                    //   拼错一个字母的调用方会得到「不报错的错答案」
                    assertThat(status.getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
                    assertThat(status.getDescription()).contains("recharg");
                });
    }

    // ─────────────────────────────────────────────────────────────
    // 三类来源各自的形状
    // ─────────────────────────────────────────────────────────────

    @Test
    void 发放来源_逐个映射到用户可见类型() {
        // 新增 CreditSource 时这里会先红：映射表必须覆盖全部枚举值，
        // 否则新来源会在界面上静默归进别的类别
        assertThat(TYPE_OF_SOURCE).containsOnlyKeys(CreditSource.values());

        for (CreditSource source : CreditSource.values()) {
            credits.grant(USER, source, 1_000 + source.ordinal(), null,
                    "grant", source.key(), "src-" + source.key());
        }

        List<UserTransaction> items = list(newPageRequest(50, ""), USER).getItemsList();

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
        // 过期核销目前还没有业务路径（扫描/定时是独立的一刀），这里直接写一张
        // 真实形状的凭证：借 wallet / 贷 cost。凭证键里**自带冒号**（grantKey 那类键
        // 都会这样），正好验证「一凭证一行」的分组键是从行上的科目反推出来的，
        // 而不是按位置切割：按位置切会在这里切错，且不报错。
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
        // 上一条用的是手工凭证（钉投影的分组键）；这一条从**核销任务**走一遍，
        // 钉的是「任务真的写出了能被投影认出来的凭证」——中间任何一环改了键的形态，
        // 用户就会看不到这行流水，而账上看起来一切正常。
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

    // ─────────────────────────────────────────────────────────────

    private ListTransactionsResponse list(PageRequest page, long userId) {
        return list("", page, userId);
    }

    /** 带类型过滤的一页；空串 = 全部。 */
    private ListTransactionsResponse list(String typeFilter, long userId) {
        return list(typeFilter, newPageRequest(20, ""), userId);
    }

    private ListTransactionsResponse list(String typeFilter, PageRequest page, long userId) {
        return stub.listTransactions(ListTransactionsRequest.newBuilder()
                .setUserId(userId)
                .setTypeFilter(typeFilter)
                .setPage(page)
                .build());
    }

    private static PageRequest newPageRequest(int size, String token) {
        return PageRequest.newBuilder().setPageSize(size).setPageToken(token).build();
    }

    /** 取该类型的那一行；不唯一直接失败（断言意图就是「恰好一行」）。 */
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
                // 规则快照随每次请求来 —— 没有它就算不出价（规则住在能力行，billing 读不到）
                .setRuleSnapshot(RULE)
                .build();
    }

    private long holdAndReturnReservationId(String commandId, long jobId) {
        stub.hold(hold(commandId, jobId));
        return jdbc.queryForObject(
                "SELECT id FROM billing_cost_reservations WHERE generation_job_id = ?",
                Long.class, jobId);
    }

    /** 一张凭证落了几条分录——用来对照「多腿 → 用户一行」。 */
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
