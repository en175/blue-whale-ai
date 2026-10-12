package com.bluewhale.billing.api;

import com.bluewhale.billing.application.BillingApplicationService;
import com.bluewhale.billing.application.command.ChargeCommand;
import com.bluewhale.billing.application.CatalogHolder;
import com.bluewhale.billing.application.CreditService;
import com.bluewhale.billing.domain.ledger.CreditSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;











@SpringBootTest(properties = "billing.admin.enabled=true")
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class AdminApiIntegrationTest {


    private static final String CATALOG = """
            {"schemaVersion":1,"currency":"CNY","creditsPerYuan":15,
             "discountPolicy":{"stackMode":"multiply","floorFactorBp":3000}}
            """;


    private static final String CATALOG_V2 = CATALOG.replace("\"creditsPerYuan\":15",
            "\"creditsPerYuan\":20");


    private static final String BAD_CATALOG = CATALOG.replace("\"creditsPerYuan\":15",
            "\"creditsPerYuan\":0");






    private static final String RULE = """
            {"baseUnit":"constant:1","basePrice":{"kind":"const","value":100000},
             "unitDenominator":1,"minCredits":1}
            """;


    private static final long USER_HOLD = 9306L;
    private static final String MODEL = "seedance-2.5";
    private static final String TASK = "text2video";

    private static final String TITLE = "视频生成 · 测试";

    @Autowired private MockMvc mvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private CatalogHolder catalog;
    @Autowired private BillingApplicationService billing;
    @Autowired private CreditService credits;

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM billing_ledger_entries");
        jdbc.update("DELETE FROM billing_cost_reservations");
        jdbc.update("DELETE FROM billing_credit_lots");
        jdbc.update("DELETE FROM billing_pricing_catalogs");
    }





    @Test
    void 发布目录_立即生效不必重启() throws Exception {
        mvc.perform(post("/admin/catalogs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(CATALOG)
                        .param("publishedBy", "ops")
                        .param("note", "首版"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.catalogVersion").value(1));



        assertThat(catalog.currentVersion()).isEqualTo(1);
    }






    @Test
    void 再发一版_版本号递增且旧版降级() throws Exception {
        publish(CATALOG);
        publish(CATALOG_V2);

        assertThat(catalog.currentVersion()).isEqualTo(2);


        Integer activeCount = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_pricing_catalogs WHERE status = 'active'", Integer.class);
        assertThat(activeCount).isEqualTo(1);

        assertThat(statusOf(1)).isEqualTo("retired");
    }

    @Test
    void 重复发布同一内容_不新开版本号() throws Exception {
        publish(CATALOG);
        publish(CATALOG);

        assertThat(catalog.currentVersion()).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_pricing_catalogs", Integer.class)).isEqualTo(1);
    }

    @Test
    void 文档不是合法JSON_返回400() throws Exception {
        mvc.perform(post("/admin/catalogs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{ 这不是 JSON"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_ARGUMENT"));
    }

    @Test
    void 校验不过的目录_发不出去() throws Exception {
        int versionBefore = catalog.currentVersion();


        mvc.perform(post("/admin/catalogs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BAD_CATALOG))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_ARGUMENT"));


        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_pricing_catalogs", Integer.class)).isZero();




        assertThat(catalog.currentVersion()).isEqualTo(versionBefore);
    }





    @Test
    void 发放积分_批次与账本同时落库_余额可查() throws Exception {
        mvc.perform(post("/admin/credits/grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"userId":9301,"source":"purchased","amount":1000,"bizId":"local-1"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lotId").isNumber())
                .andExpect(jsonPath("$.source").value("purchased"));



        assertThat(latestBalance("wallet")).isEqualTo(1000);
        assertThat(latestBalance("cost")).isEqualTo(1000);

        mvc.perform(get("/admin/credits/balances/9301"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availableCredits").value(1000))
                .andExpect(jsonPath("$.expiring[0].source").value("purchased"))
                .andExpect(jsonPath("$.expiring[0].credits").value(1000));
    }

    @Test
    void 幂等键撞车_409要带回既有那一笔的归属() throws Exception {




        mvc.perform(post("/admin/credits/grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"userId":9321,"source":"bonus","amount":1000,"bizId":"owner-first",
                                 "grantKey":"bonus:tier:9321:7"}
                                """))
                .andExpect(status().isOk());


        mvc.perform(post("/admin/credits/grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"userId":9321,"source":"bonus","amount":1000,"bizId":"owner-second",
                                 "grantKey":"bonus:tier:9321:7"}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DUPLICATE"))
                .andExpect(jsonPath("$.existingBizId").value("owner-first"));
    }

    @Test
    void 充值本金_按两年策略带有效期_而不是永久() throws Exception {
        mvc.perform(post("/admin/credits/grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"userId":9311,"source":"purchased","amount":1000,"bizId":"exp-1"}
                                """))
                .andExpect(status().isOk());





        LocalDateTime expiresAt = jdbc.queryForObject(
                "SELECT expires_at FROM billing_credit_lots WHERE user_id = 9311",
                LocalDateTime.class);
        assertThat(expiresAt).as("本金批次必须带有效期（永久 = expires_at 为 NULL）").isNotNull();




        LocalDateTime expected = LocalDateTime.now().plusYears(2);
        assertThat(expiresAt)
                .as("到期时刻应≈2 年后（日历口径，不是 730 天）")
                .isBetween(expected.minusSeconds(60), expected.plusSeconds(60));
    }

    @Test
    void 赠送类来源_按策略带默认有效期() throws Exception {
        mvc.perform(post("/admin/credits/grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"userId":9302,"source":"gift","amount":500,"bizId":"g-1"}
                                """))
                .andExpect(status().isOk());


        java.sql.Timestamp expiresAt = jdbc.queryForObject(
                "SELECT expires_at FROM billing_credit_lots WHERE user_id = 9302",
                java.sql.Timestamp.class);
        assertThat(expiresAt).isNotNull();

        mvc.perform(get("/admin/credits/balances/9302"))
                .andExpect(jsonPath("$.expiring[0].source").value("gift"))
                .andExpect(jsonPath("$.expiring[0].credits").value(500));
    }

    @Test
    void 同一bizId重复发放_返回409而不是发两次() throws Exception {
        exchangeGrant("""
                {"userId":9303,"source":"purchased","amount":1000,"bizId":"dup-1"}
                """);
        mvc.perform(post("/admin/credits/grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"userId":9303,"source":"purchased","amount":1000,"bizId":"dup-1"}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DUPLICATE"));


        mvc.perform(get("/admin/credits/balances/9303"))
                .andExpect(jsonPath("$.availableCredits").value(1000));
    }

    @Test
    void 缺bizId_返回400() throws Exception {
        mvc.perform(post("/admin/credits/grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"userId":9304,"source":"gift","amount":100}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_ARGUMENT"));
    }

    @Test
    void 未知来源_返回400() throws Exception {
        mvc.perform(post("/admin/credits/grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"userId":9305,"source":"不存在的来源","amount":100,"bizId":"x"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("INVALID_ARGUMENT")));
    }





    @Test
    void 手动返还_能把扣掉的钱退回去() throws Exception {





        seedHoldable();
        long jobId = 9_500L;
        billing.charge(new ChargeCommand(USER_HOLD, "cmd-lost", jobId, MODEL, TASK,
                Map.of(), "free", TITLE, LocalDateTime.now(), RULE));

        mvc.perform(post("/admin/credits/jobs/" + jobId + "/refund")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"reason":"事件进死信，人工返还"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("refunded"));


        mvc.perform(get("/admin/credits/balances/" + USER_HOLD))
                .andExpect(jsonPath("$.availableCredits").value(1_000));
    }



    private void publish(String document) throws Exception {
        mvc.perform(post("/admin/catalogs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(document))
                .andExpect(status().isOk());
    }


    private void seedHoldable() throws Exception {
        publish(CATALOG);
        credits.grant(USER_HOLD, CreditSource.GIFT, 1_000, null, "grant", "hold-seed", "hold-seed");
    }

    private void exchangeGrant(String body) throws Exception {
        mvc.perform(post("/admin/credits/grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private String statusOf(int catalogVersion) {
        return jdbc.queryForObject(
                "SELECT status FROM billing_pricing_catalogs WHERE catalog_version = ?",
                String.class, catalogVersion);
    }








    private long latestBalance(String account) {
        java.math.BigDecimal value = jdbc.queryForObject(
                "SELECT balance_after FROM billing_ledger_entries WHERE account = ? "
                        + "ORDER BY id DESC LIMIT 1",
                java.math.BigDecimal.class, account);
        return value == null ? 0L : value.longValueExact();
    }
}
