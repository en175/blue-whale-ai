package com.bluewhale.billing.admin;

import com.bluewhale.billing.application.BillingApplicationService;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.CreditSource;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 流水管理端接口（{@code /admin/transactions}）的集成测试。
 *
 * <p>它钉住的是**用户面没有的那个自由度**：{@code userId} 可省略 = 全站流水。
 * 用户面的 {@code ListTransactions} 里 {@code user_id} 必填（那是「把我的账给我」），
 * 所以这条能力只可能由管理面提供——本测试就是它的存在证明。
 *
 * <p>用 MockMvc 而不是真端口：关心的是路由、参数绑定、异常映射与 SQL 投影，
 * 这些在 MockMvc 下全能验到（与 {@link AdminApiIntegrationTest} 同一立场）。
 */
@SpringBootTest(properties = "billing.admin.enabled=true")
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class AdminTransactionApiTest {

    private static final long USER_A = 9601L;
    private static final long USER_B = 9602L;

    @Autowired private MockMvc mvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private BillingApplicationService billing;
    @Autowired private CreditService credits;

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM billing_ledger_entries");
        jdbc.update("DELETE FROM billing_cost_reservations");
        jdbc.update("DELETE FROM billing_credit_lots");
    }

    /** 两个用户各发一笔充值：全局视图必须两行都在，且各自带得动归属。 */
    private void seedTwoUsers() {
        billing.grant(USER_A, CreditSource.PURCHASED, 1000, "recharge", "a-1", "purchased:a-1", null);
        billing.grant(USER_B, CreditSource.PURCHASED, 2000, "recharge", "b-1", "purchased:b-1", null);
    }

    @Test
    void 省略userId_看到全站流水且每行带归属() throws Exception {
        seedTwoUsers();

        mvc.perform(get("/admin/transactions").param("pageSize", "10"))
                .andExpect(status().isOk())
                // 全站 = 两个用户的行都在。只按 userId 过滤的旧查询在这里只能给出一半
                .andExpect(jsonPath("$.items.length()").value(2))
                // ⚠️ user_id 是管理面独有的列：没有它，全局流水是一列无法归属的账
                .andExpect(jsonPath("$.items[?(@.userId == " + USER_A + ")]").exists())
                .andExpect(jsonPath("$.items[?(@.userId == " + USER_B + ")]").exists())
                .andExpect(jsonPath("$.items[?(@.amount == 2000)]").exists());
    }

    @Test
    void 带userId_只看该用户() throws Exception {
        seedTwoUsers();

        mvc.perform(get("/admin/transactions")
                        .param("userId", String.valueOf(USER_A))
                        .param("pageSize", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].userId").value(USER_A))
                .andExpect(jsonPath("$.items[0].amount").value(1000));
    }

    /**
     * 未知类型**必须报错**，不能返回空列表。
     *
     * <p>空列表与「真的没有这个类型的流水」长得一模一样——查的是 {@code "recharg"}
     * 也发现不了。这条口径由 {@code TransactionType} 保证，这里验它经 HTTP 面照样成立。
     */
    @Test
    void 未知类型_400而不是空列表() throws Exception {
        seedTwoUsers();

        mvc.perform(get("/admin/transactions").param("type", "recharg"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_ARGUMENT"));
    }

    /** 游标翻页：每页一条，两次翻完两行，且不重不漏。 */
    @Test
    void 游标翻页_不重不漏() throws Exception {
        seedTwoUsers();

        String body = mvc.perform(get("/admin/transactions").param("pageSize", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andReturn().getResponse().getContentAsString();
        String firstId = JsonPath.read(body, "$.items[0].id");
        String nextToken = JsonPath.read(body, "$.nextPageToken");
        assertThat(nextToken).isNotEmpty();

        mvc.perform(get("/admin/transactions")
                        .param("pageSize", "1")
                        .param("pageToken", nextToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(org.hamcrest.Matchers.not(firstId)))
                // 最后一页的游标为空 = 没有下一页
                .andExpect(jsonPath("$.nextPageToken").value(""));
    }

    /** 坏游标要报错，不能悄悄当成首页——那表现为列表「自己跳回顶部」且日志里看不出异常。 */
    @Test
    void 坏游标_400() throws Exception {
        mvc.perform(get("/admin/transactions").param("pageToken", "not-a-cursor"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_ARGUMENT"));
    }

    /* ───────────────── 区间消耗合计（/admin/transactions/consumed-credits） ─────────────────
     *
     * 仪表盘的「总使用积分」用它。钉住三件事：**只算 settled**、**半开区间**、
     * **空区间给 0 而不是报错**。三者任一错了，仪表盘都会显示一个偏大或偏小的数，
     * 而那种数在界面上与真值长得一模一样。
     */

    private static final String FROM = "2026-09-25T00:00:00+08:00";
    private static final String TO = "2026-09-26T00:00:00+08:00";

    /**
     * 直接插一条预留行，时间点由测试给死。
     *
     * <p>不走 {@code hold/settle} 是因为要验**边界**（正好落在 from / 正好落在 to 的行），
     * 而走真实路径没法把 {@code gmt_modified} 设到指定的秒上。
     */
    private void insertReservation(long jobId, String status, Long actualCredits, String at) {
        jdbc.update("INSERT INTO billing_cost_reservations "
                        + "(generation_job_id, user_id, reserved_credits, actual_credits, status,"
                        + " allocations, catalog_version, gmt_create, gmt_modified) "
                        + "VALUES (?, ?, 100, ?, ?, '[]', 1, ?, ?)",
                jobId, USER_A, actualCredits, status, at, at);
    }

    /**
     * 半开区间 [from, to)：**正好落在起点的那秒算**、**正好落在终点的那秒不算**。
     *
     * <p>写成 `BETWEEN ... AND '2026-09-25 23:59:59'` 会漏掉 23:59:59 之后、次日零点之前
     * 落库的行——DATETIME 只到秒，那半秒里的行不在任何区间里，且没人会发现。
     */
    @Test
    void 消耗合计_半开区间且只算已结算() throws Exception {
        insertReservation(9801L, "settled", 1L, "2026-09-24 23:59:59"); // 区间前：不计
        insertReservation(9802L, "settled", 2L, "2026-09-25 00:00:00"); // = from：**计**
        insertReservation(9803L, "settled", 4L, "2026-09-25 23:59:59"); // 区间内：计
        insertReservation(9804L, "settled", 8L, "2026-09-26 00:00:00"); // = to：**不计**
        insertReservation(9805L, "held", null, "2026-09-25 12:00:00"); // 冻着的钱不是消耗
        insertReservation(9806L, "released", 0L, "2026-09-25 12:00:00"); // 退回的钱不是消耗

        mvc.perform(get("/admin/transactions/consumed-credits")
                        .param("from", FROM)
                        .param("to", TO))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.consumedCredits").value(6));
    }

    /** 区间内无已结算行 → 0。SUM 无行返回 NULL，没兜住就会 500（long 拆箱）。 */
    @Test
    void 消耗合计_空区间给0而不是报错() throws Exception {
        mvc.perform(get("/admin/transactions/consumed-credits")
                        .param("from", FROM)
                        .param("to", TO))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.consumedCredits").value(0));
    }

    /**
     * 走真实链路（预扣 → 结算）的那笔消耗，必须落在**当下**的区间里。
     *
     * <p>这一条钉的是「结算时刻写在 {@code gmt_modified} 上」这个前提：整条口径都建立在
     * 它上面，而它由 DDL 的 {@code ON UPDATE CURRENT_TIMESTAMP} 承担——不是代码里写死的，
     * 换成别的列或去掉那个 DDL 子句，这条会红。
     */
    @Test
    void 消耗合计_真结算的那笔落在当下区间() throws Exception {
        billing.grant(USER_A, CreditSource.PURCHASED, 1000, "recharge", "a-9", "purchased:a-9", null);
        credits.hold(USER_A, "cmd-cc-1", 9901L, 100, 1, 10000, "生成任务");
        credits.settle(9901L, 30);

        String now = java.time.OffsetDateTime.now(java.time.ZoneId.of("Asia/Shanghai"))
                .toString();
        String yesterday = java.time.OffsetDateTime.now(java.time.ZoneId.of("Asia/Shanghai"))
                .minusDays(1).toString();
        String tomorrow = java.time.OffsetDateTime.now(java.time.ZoneId.of("Asia/Shanghai"))
                .plusDays(1).toString();

        mvc.perform(get("/admin/transactions/consumed-credits")
                        .param("from", yesterday)
                        .param("to", tomorrow))
                .andExpect(status().isOk())
                // 实际 30，不是预扣 100 —— 预扣额不是消耗
                .andExpect(jsonPath("$.consumedCredits").value(30));

        // 完全落在过去一天的窗口里应当查不到这笔（它发生在今天）
        mvc.perform(get("/admin/transactions/consumed-credits")
                        .param("from", java.time.OffsetDateTime.now(java.time.ZoneId.of("Asia/Shanghai"))
                                .minusDays(2).toString())
                        .param("to", yesterday))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.consumedCredits").value(0));
    }

    /**
     * 缺参数 / 反向区间一律 400。
     *
     * <p>⚠️ 不能兜一个「最近 24 小时」之类的默认值：区间是调用方算出来的东西，
     *    兜底会让它拿到一段「不是自己要求的」数，而返回值里没有任何东西能暴露这件事。
     *    反向区间求和天然是 0，与「这段时间真的没有消耗」长得一模一样。
     */
    @Test
    void 消耗合计_缺参数或反向区间_400() throws Exception {
        mvc.perform(get("/admin/transactions/consumed-credits").param("from", FROM))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_ARGUMENT"));

        mvc.perform(get("/admin/transactions/consumed-credits")
                        .param("from", "不是时间")
                        .param("to", TO))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_ARGUMENT"));

        mvc.perform(get("/admin/transactions/consumed-credits")
                        .param("from", TO)
                        .param("to", FROM))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_ARGUMENT"));
    }
}
