package com.bluewhale.billing.admin;

import com.bluewhale.billing.application.BillingApplicationService;
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
}
