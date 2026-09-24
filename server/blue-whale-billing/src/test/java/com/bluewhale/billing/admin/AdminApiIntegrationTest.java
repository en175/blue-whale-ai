package com.bluewhale.billing.admin;

import com.bluewhale.billing.application.BillingApplicationService;
import com.bluewhale.billing.application.HoldCommand;
import com.bluewhale.billing.catalog.CatalogHolder;
import com.bluewhale.billing.ledger.CreditService;
import com.bluewhale.billing.ledger.CreditSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 管理端接口的集成测试：发布目录、发放积分（《架构设计》§12）。
 *
 * <p>它替换的是两段手工 SQL —— 发布目录、发放积分。**手工写库的代价不是麻烦，
 * 是正确性**：发放要同时写批次与两条账本分录并算 {@code balance_after}，
 * 漏一步账就不平；而写库没有幂等保护，手抖两次就是双倍发放。
 *
 * <p>用 MockMvc 而不是真实端口：本测试关心的是路由、参数绑定、异常映射与副作用，
 * 这些在 MockMvc 下全能验到；绑端口只会带来冲突。
 */
@SpringBootTest(properties = "billing.admin.enabled=true")
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class AdminApiIntegrationTest {

    private static final String CATALOG = """
            {"schemaVersion":1,"currency":"CNY","creditsPerYuan":15,
             "models":{"seedance-2.5":{"text2video":{
               "baseUnit":"constant:1","basePrice":{"kind":"const","value":100000},
               "unitDenominator":1,"minCredits":1}}},
             "discountPolicy":{"stackMode":"multiply","floorFactorBp":3000}}
            """;

    /** 改了单价的一份：用来验「发新版本会把旧版本降级」。 */
    private static final String CATALOG_V2 = CATALOG.replace("100000", "200000");

    /** baseUnit 指向一个不存在的维度 —— 编译期就该被拒。 */
    private static final String BAD_CATALOG = CATALOG.replace("constant:1", "usage.不存在的维度");

    /** 手动结算/返还要造出真实预扣，单独用一个用户，免得和发放类用例互相干扰。 */
    private static final long USER_HOLD = 9306L;
    private static final String MODEL = "seedance-2.5";
    private static final String TASK = "text2video";

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

    // ─────────────────────────────────────────────────────────────
    // 发布目录
    // ─────────────────────────────────────────────────────────────

    @Test
    void 发布目录_立即生效不必重启() throws Exception {
        mvc.perform(post("/admin/catalogs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(CATALOG)
                        .param("publishedBy", "ops")
                        .param("note", "首版"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.catalogVersion").value(1))
                .andExpect(jsonPath("$.ruleCount").value(1));

        // ★ 关键：同一进程内马上就能用，不需要重启 —— 这正是把发布做成接口的意义。
        //   假如只写库不调 reload()，这里会是 -1。
        assertThat(catalog.currentVersion()).isEqualTo(1);

        mvc.perform(get("/admin/catalogs/active"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.catalogVersion").value(1));
    }

    @Test
    void 再发一版_版本号递增且旧版降级() throws Exception {
        publish(CATALOG);
        publish(CATALOG_V2);

        assertThat(catalog.currentVersion()).isEqualTo(2);

        // 全表至多一条 active —— 两条 active 会让「当前版本」变成不确定的
        Integer activeCount = jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_pricing_catalogs WHERE status = 'active'", Integer.class);
        assertThat(activeCount).isEqualTo(1);
        // 旧版必须留着：已提交的 job 冻结了 v1，结算时要按它复现定价
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
    void 编译不过的目录_发不出去() throws Exception {
        int versionBefore = catalog.currentVersion();

        // 编译是发布时**唯一**的验证时机：放过去了，影响的是已经用这个版本计过价的 job
        mvc.perform(post("/admin/catalogs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BAD_CATALOG))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_ARGUMENT"));

        // 一行都没落库 —— 编不过的文档不该留下任何痕迹
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM billing_pricing_catalogs", Integer.class)).isZero();
        // 生效版本原封不动。⚠️ 这里比对「发布前」而不是断言 -1：
        //   CatalogHolder 是内存态，而 @BeforeEach 只清库；reload() 在「没有 active 版本」时
        //   刻意保留旧版本（免得一次读库失败让全站算不出价），所以内存里的版本号
        //   不会因为清库而归零。断言「没变化」才是这条路径真正要保证的。
        assertThat(catalog.currentVersion()).isEqualTo(versionBefore);
    }

    // ─────────────────────────────────────────────────────────────
    // 发放积分
    // ─────────────────────────────────────────────────────────────

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

        // ★ 手工 SQL 最容易漏的就是账本：只插批次会让「wallet + frozen == Σ remaining」当场破。
        //   走接口的话，两条分录由 CreditService 在一个事务里写完。
        assertThat(latestBalance("wallet")).isEqualTo(1000);
        assertThat(latestBalance("cost")).isEqualTo(1000);

        mvc.perform(get("/admin/credits/balances/9301"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availableCredits").value(1000))
                .andExpect(jsonPath("$.frozenCredits").value(0))
                // 充值本金永久，不出现在临期列表里
                .andExpect(jsonPath("$.expiring").isEmpty());
    }

    @Test
    void 赠送类来源_按策略带默认有效期() throws Exception {
        mvc.perform(post("/admin/credits/grants")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"userId":9302,"source":"gift","amount":500,"bizId":"g-1"}
                                """))
                .andExpect(status().isOk());

        // 有效期由 GrantPolicy 决定，不由调用方传 —— 入口只该关心「发什么、发多少」
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

        // 关键：只发了一笔。手抖两次不该变成双倍发放。
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

    // ─────────────────────────────────────────────────────────────
    // 手动结算 / 返还（运维兜底）
    // ─────────────────────────────────────────────────────────────

    @Test
    void 手动返还_能解掉卡住的冻结() throws Exception {
        // 走真实的预扣路径造出「预扣成功但完成事件丢了」的状态。
        // ⚠️ 不能手工往表里插一条 frozen=40 的批次 + 一条预留就完事：
        //    预扣必然同时写两条账本分录（借 wallet / 贷 frozen），漏掉它们之后
        //    frozen 科目的余额就是 0，再一笔返还借 frozen 就变成 -40。
        //    账本会当场把这个不一致显示出来——这正是复式记账该有的样子。
        seedHoldable();
        long jobId = 9_500L;
        billing.hold(new HoldCommand(USER_HOLD, "cmd-lost", jobId, MODEL, TASK,
                Map.of(), "free", Instant.now()));

        mvc.perform(post("/admin/credits/jobs/" + jobId + "/refund")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"reason":"事件进死信，人工释放"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("released"));

        // 冻结解掉了，钱回到可用
        mvc.perform(get("/admin/credits/balances/" + USER_HOLD))
                .andExpect(jsonPath("$.availableCredits").value(1_000))
                .andExpect(jsonPath("$.frozenCredits").value(0));
    }

    @Test
    void 手动结算_按给定实际额扣减() throws Exception {
        seedHoldable();
        long jobId = 9_501L;
        billing.hold(new HoldCommand(USER_HOLD, "cmd-stuck", jobId, MODEL, TASK,
                Map.of(), "free", Instant.now()));

        mvc.perform(post("/admin/credits/jobs/" + jobId + "/settle")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"actualCredits":30}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("settled"));

        // 扣 30，差额 10 回可用；冻结归零
        mvc.perform(get("/admin/credits/balances/" + USER_HOLD))
                .andExpect(jsonPath("$.availableCredits").value(970))
                .andExpect(jsonPath("$.frozenCredits").value(0));
    }

    // ─────────────────────────────────────────────────────────────

    private void publish(String document) throws Exception {
        mvc.perform(post("/admin/catalogs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(document))
                .andExpect(status().isOk());
    }

    /** 发一份目录 + 给 USER_HOLD 发 1000 积分，让手动结算/返还用例有真实预扣可解。 */
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

    /**
     * 该科目的当前余额。
     *
     * <p>读的是**落库的 {@code balance_after} 快照**，不是自己按 direction 求和：
     * 求和要先知道每个科目的自然余额方向（wallet 贷方为正、cost 借方为正），
     * 在测试里重写一遍那个规则，等于把被测逻辑抄进断言——抄错了测试反而变绿。
     */
    private long latestBalance(String account) {
        java.math.BigDecimal value = jdbc.queryForObject(
                "SELECT balance_after FROM billing_ledger_entries WHERE account = ? "
                        + "ORDER BY id DESC LIMIT 1",
                java.math.BigDecimal.class, account);
        return value == null ? 0L : value.longValueExact();
    }
}
