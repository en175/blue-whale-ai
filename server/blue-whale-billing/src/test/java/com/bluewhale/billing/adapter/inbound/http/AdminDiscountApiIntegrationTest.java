package com.bluewhale.billing.adapter.inbound.http;

import com.bluewhale.billing.adapter.outbound.discount.MemberDiscountProvider;
import com.bluewhale.billing.adapter.outbound.discount.PromotionDiscountProvider;
import com.bluewhale.billing.domain.pricing.BasePriceResolver;
import com.bluewhale.billing.domain.pricing.CompiledRule;
import com.bluewhale.billing.domain.pricing.PricingContext;
import com.bluewhale.billing.domain.pricing.PricingRequest;
import com.bluewhale.billing.domain.pricing.Usage;
import com.bluewhale.billing.domain.pricing.UsageDim;
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

@SpringBootTest(properties = "billing.admin.enabled=true")
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD", matches = ".+")
class AdminDiscountApiIntegrationTest {

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


    @Test
    void 会员折扣_增改删全链路() throws Exception {
        String created = mvc.perform(post("/admin/member-discounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tier":"pro","modelPattern":"*","taskPattern":"*","discountBp":9000}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("enabled"))
                .andExpect(jsonPath("$.priority").value(0))
                .andExpect(jsonPath("$.gmtCreate").isNotEmpty())
                .andReturn().getResponse().getContentAsString();
        long id = idOf(created);

        mvc.perform(get("/admin/member-discounts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].tier").value("pro"))
                .andExpect(jsonPath("$[0].discountBp").value(9000));

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
        expectBadRequest("""
                {"tier":"pro","modelPattern":"*","taskPattern":"*","discountBp":0}
                """, "必须大于 0");

        expectBadRequest("""
                {"tier":"vip","modelPattern":"*","taskPattern":"*","discountBp":9000}
                """, "会员等级只能是");

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
                .andExpect(jsonPath("$.daysOfWeek[0]").value(1))
                .andExpect(jsonPath("$.tz").value("Asia/Shanghai"))
                .andExpect(jsonPath("$.dailyTimeStart").value("22:00:00"));
    }

    @Test
    void 活动_空的任务与等级范围归一成null_不限只能有一种表示() throws Exception {
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

        var hit = promotionProvider.resolve(ctx("pro", "seedance-2.5", "text2video", NIGHT));

        assertThat(hit).isPresent();
        assertThat(hit.get().factorBp()).isEqualTo(7000);
        assertThat(hit.get().code()).isEqualTo("night-70");
        assertThat(promotionProvider.resolve(ctx("free", "seedance-2.5", "text2video", NIGHT)))
                .isEmpty();
        assertThat(promotionProvider.resolve(
                ctx("pro", "seedance-2.5", "text2video", Instant.parse("2026-10-15T15:00:00+08:00"))))
                .isEmpty();
    }


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
