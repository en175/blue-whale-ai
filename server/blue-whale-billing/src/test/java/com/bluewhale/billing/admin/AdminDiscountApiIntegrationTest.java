package com.bluewhale.billing.admin;

import com.bluewhale.billing.discount.MemberDiscountProvider;
import com.bluewhale.billing.discount.PromotionDiscountProvider;
import com.bluewhale.billing.pricing.BasePriceResolver;
import com.bluewhale.billing.pricing.CompiledRule;
import com.bluewhale.billing.pricing.PricingContext;
import com.bluewhale.billing.pricing.PricingRequest;
import com.bluewhale.billing.pricing.Usage;
import com.bluewhale.billing.pricing.UsageDim;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 折扣管理端接口的真库集成测试（会员折扣 / 营销活动）。
 *
 * <p>它替换的是「改 SQL」—— 而改 SQL 的代价不是麻烦，是**正确性**：
 * 一张表里有三处「配错了在计价侧是静默的」（空数组 = 不限、时段只填一半 = 全天、
 * 时区名拼错 = 预扣抛异常），手工 INSERT 时没有任何东西拦它们。
 *
 * <p>这个测试钉住三件事：
 * <ol>
 *   <li>接口写进去的**就是计价侧读出来的**（最后两条用例直接调 Provider 验命中）；</li>
 *   <li>「清空」真的落库（{@code LambdaUpdateWrapper} 显式 set 的理由，见
 *       {@code AdminPromotionController.update}）；</li>
 *   <li>校验失败是 400 + 人话，不是 500。</li>
 * </ol>
 *
 * <p>门控同 {@code DiscountResolverIntegrationTest}：只跑在 {@code bw_billing_test} 上。
 */
@SpringBootTest(properties = "billing.admin.enabled=true")
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class AdminDiscountApiIntegrationTest {

    /** 周四 22:30（北京）——「夜间 7 折」的窗口内。 */
    private static final Instant NIGHT = Instant.parse("2026-10-15T22:30:00+08:00");

    @Autowired private MockMvc mvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private MemberDiscountProvider memberProvider;
    @Autowired private PromotionDiscountProvider promotionProvider;

    @BeforeEach
    void clean() {
        jdbc.update("DELETE FROM billing_member_discounts");
        jdbc.update("DELETE FROM billing_promotions");
    }

    // ─────────────────────────────────────────────────────────────
    // 会员折扣
    // ─────────────────────────────────────────────────────────────

    @Test
    void 会员折扣_增改删全链路() throws Exception {
        String created = mvc.perform(post("/admin/member-discounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tier":"pro","modelPattern":"*","taskPattern":"*","discountBp":9000}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("enabled"))   // 不填走默认值
                .andExpect(jsonPath("$.priority").value(0))
                // gmt_create 是列默认值，插入后要**再读一次**才拿得到 ——
                // 直接回插入的实体会给出 null，界面上就是一格空白
                .andExpect(jsonPath("$.gmtCreate").isNotEmpty())
                .andReturn().getResponse().getContentAsString();
        long id = idOf(created);

        mvc.perform(get("/admin/member-discounts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].tier").value("pro"))
                .andExpect(jsonPath("$[0].discountBp").value(9000));

        // 停用 + 改折扣：两条都是运营日常动作
        mvc.perform(put("/admin/member-discounts/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tier":"pro","modelPattern":"seedance-*","taskPattern":"text2video",
                                 "discountBp":8000,"status":"disabled","priority":10}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.discountBp").value(8000))
                .andExpect(jsonPath("$.status").value("disabled"))
                .andExpect(jsonPath("$.modelPattern").value("seedance-*"));

        // 停用的行**仍然列出来**：藏掉它，运营会以为已经删了、然后重新配一条一模一样的
        mvc.perform(get("/admin/member-discounts?tier=pro"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].status").value("disabled"));

        mvc.perform(delete("/admin/member-discounts/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted").value(true));

        mvc.perform(get("/admin/member-discounts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());
    }

    @Test
    void 会员折扣_校验失败是400加人话不是500() throws Exception {
        // 0 = 免费，不是「打 0 折」的笔误空间
        expectBadRequest("""
                {"tier":"pro","modelPattern":"*","taskPattern":"*","discountBp":0}
                """, "必须大于 0");

        // 等级不在 free/basic/pro/max 里
        expectBadRequest("""
                {"tier":"vip","modelPattern":"*","taskPattern":"*","discountBp":9000}
                """, "会员等级只能是");

        // 通配符在中间 —— 计价侧匹配不到任何东西，比配错更坏
        expectBadRequest("""
                {"tier":"pro","modelPattern":"seed-*-x","taskPattern":"*","discountBp":9000}
                """, "通配符只支持放在结尾");
    }

    @Test
    void 改一条不存在的会员折扣是404_不是400也不是500() throws Exception {
        mvc.perform(put("/admin/member-discounts/99999999")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tier":"pro","modelPattern":"*","taskPattern":"*","discountBp":9000}
                                """))
                .andExpect(status().isNotFound());
    }

    // ─────────────────────────────────────────────────────────────
    // 营销活动
    // ─────────────────────────────────────────────────────────────

    @Test
    void 活动_写入后回包是解析后的条件列() throws Exception {
        mvc.perform(post("/admin/promotions?operator=42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(promotionJson(7000)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value("night-70"))
                .andExpect(jsonPath("$.status").value("enabled"))
                .andExpect(jsonPath("$.createdBy").value("42"))
                .andExpect(jsonPath("$.modelIds[0]").value("seedance-*"))
                .andExpect(jsonPath("$.tierScope[1]").value("max"))
                // 生效星期是 [1,4,5]：NIGHT 是周四（4），所以它在范围内
                .andExpect(jsonPath("$.daysOfWeek[0]").value(1))
                .andExpect(jsonPath("$.tz").value("Asia/Shanghai"))
                .andExpect(jsonPath("$.dailyTimeStart").value("22:00:00"));
    }

    @Test
    void 活动_空的任务与等级范围归一成null_不限只能有一种表示() throws Exception {
        // 不传 taskTypes / tierScope 时回包必须是 null，不能是空数组 ——
        // 两种表示会让界面在下一次排查时多花半小时确认它们是不是同一个意思
        mvc.perform(post("/admin/promotions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"code":"all-day","name":"全天 9 折","discountBp":9000,
                                 "modelIds":["*"],"taskTypes":[],"tierScope":[],
                                 "startAt":"2026-10-01T00:00","endAt":"2026-11-01T00:00",
                                 "tz":"Asia/Shanghai","status":"enabled"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.taskTypes").doesNotExist())
                .andExpect(jsonPath("$.tierScope").doesNotExist())
                .andExpect(jsonPath("$.daysOfWeek").doesNotExist())
                .andExpect(jsonPath("$.dailyTimeStart").doesNotExist());
    }

    @Test
    void 活动_清空每日时段真的落库_不然会保存了却没生效() throws Exception {
        String created = mvc.perform(post("/admin/promotions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(promotionJson(7000)))
                .andReturn().getResponse().getContentAsString();
        long id = idOf(created);

        // 把 22:00–06:00 清掉（改成全天）：MyBatis-Plus 默认跳过 null 字段，
        // 用 updateById 的话这次保存会「看起来成功、实际没写进去」，活动继续只在那 8 小时生效
        mvc.perform(put("/admin/promotions/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"code":"night-70","name":"夜间 7 折（改全天）","discountBp":7000,
                                 "modelIds":["*"],"taskTypes":null,"tierScope":null,
                                 "startAt":"2026-10-01T00:00","endAt":"2026-11-01T00:00",
                                 "dailyTimeStart":null,"dailyTimeEnd":null,
                                 "daysOfWeek":null,"tz":"Asia/Shanghai","status":"enabled"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dailyTimeStart").doesNotExist());

        Map<String, Object> row = jdbc.queryForMap(
                "SELECT daily_time_start, daily_time_end, task_types FROM billing_promotions WHERE id = ?", id);
        assertThat(row.get("daily_time_start")).isNull();
        assertThat(row.get("daily_time_end")).isNull();
        assertThat(row.get("task_types")).isNull();
    }

    @Test
    void 活动_标识重复被拒且给人话() throws Exception {
        mvc.perform(post("/admin/promotions").contentType(MediaType.APPLICATION_JSON)
                .content(promotionJson(7000))).andExpect(status().isOk());

        mvc.perform(post("/admin/promotions").contentType(MediaType.APPLICATION_JSON)
                        .content(promotionJson(8000)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("活动标识已存在")));
    }

    @Test
    void 活动_模型范围为空被拒_空数组在计价侧等于全站打折() throws Exception {
        mvc.perform(post("/admin/promotions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(promotionJson(7000).replace("[\"seedance-*\"]", "[]")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("模型范围必填")));
    }

    @Test
    void 活动_时区名拼错被拒_否则预扣路径会抛异常() throws Exception {
        mvc.perform(post("/admin/promotions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(promotionJson(7000).replace("Asia/Shanghai", "Asia/Shangahi")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("时区名不合法")));
    }

    @Test
    void 活动_时段只填一半被拒_那在计价侧等于全天() throws Exception {
        mvc.perform(post("/admin/promotions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(promotionJson(7000).replace("\"dailyTimeEnd\":\"06:00\"", "\"dailyTimeEnd\":null")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("要么都填")));
    }

    @Test
    void 活动_删掉之后列表里就没有它了() throws Exception {
        String created = mvc.perform(post("/admin/promotions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(promotionJson(7000)))
                .andReturn().getResponse().getContentAsString();
        long id = idOf(created);

        mvc.perform(delete("/admin/promotions/" + id)).andExpect(status().isOk());
        mvc.perform(delete("/admin/promotions/" + id)).andExpect(status().isNotFound());
        mvc.perform(get("/admin/promotions")).andExpect(jsonPath("$").isEmpty());
    }

    // ─────────────────────────────────────────────────────────────
    // 接口写进去的 = 计价侧读出来的（这两条是整件事的意义所在）
    // ─────────────────────────────────────────────────────────────

    @Test
    void 管理端建的会员折扣_计价侧命中() throws Exception {
        mvc.perform(post("/admin/member-discounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tier":"pro","modelPattern":"*","taskPattern":"*","discountBp":9000}
                                """))
                .andExpect(status().isOk());

        var hit = memberProvider.resolve(ctx("pro", "seedance-2.5", "text2video", NIGHT));

        assertThat(hit).isPresent();
        assertThat(hit.get().factorBp()).isEqualTo(9000);
        assertThat(hit.get().source()).isEqualTo("member");
    }

    @Test
    void 管理端建的活动_计价侧按时段与等级命中() throws Exception {
        mvc.perform(post("/admin/promotions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(promotionJson(7000)))
                .andExpect(status().isOk());

        // 夹具限了 ["pro","max"]，所以必须用 pro 来验命中
        var hit = promotionProvider.resolve(ctx("pro", "seedance-2.5", "text2video", NIGHT));

        assertThat(hit).isPresent();
        assertThat(hit.get().factorBp()).isEqualTo(7000);
        assertThat(hit.get().code()).isEqualTo("night-70");
        // 等级范围外不命中（同一时刻、同一模型）
        assertThat(promotionProvider.resolve(ctx("free", "seedance-2.5", "text2video", NIGHT)))
                .isEmpty();
        // 周四 15:00 不在 22:00–06:00 里
        assertThat(promotionProvider.resolve(
                ctx("pro", "seedance-2.5", "text2video", Instant.parse("2026-10-15T15:00:00+08:00"))))
                .isEmpty();
    }

    // ── 夹具 ──

    /** 一条「夜间 7 折、限 seedance 系、pro 与 max 可用」的活动。 */
    private static String promotionJson(int bp) {
        return """
                {"code":"night-70","name":"夜间 7 折","discountBp":%d,
                 "modelIds":["seedance-*"],"taskTypes":["text2video"],"tierScope":["pro","max"],
                 "startAt":"2026-10-01T00:00","endAt":"2026-11-01T00:00",
                 "dailyTimeStart":"22:00","dailyTimeEnd":"06:00","daysOfWeek":[1,4,5],
                 "tz":"Asia/Shanghai","status":"enabled","priority":5}
                """.formatted(bp);
    }

    private void expectBadRequest(String body, String messageFragment) throws Exception {
        mvc.perform(post("/admin/member-discounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString(messageFragment)));
    }

    private static long idOf(String json) {
        return com.jayway.jsonpath.JsonPath.parse(json).read("$.id", Long.class);
    }

    private static PricingContext ctx(String tier, String model, String task, Instant at) {
        return new PricingContext(
                CompiledRule.of(UsageDim.CONSTANT_ONE, new BasePriceResolver.Constant(10_000L), 1L),
                new PricingRequest(42L, model, task, Map.of(), tier),
                Usage.empty(), at);
    }
}
