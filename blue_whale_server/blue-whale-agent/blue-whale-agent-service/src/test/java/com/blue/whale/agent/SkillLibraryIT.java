package com.blue.whale.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.blue.whale.agent.skill.CreativeSkillSeedRunner;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * library 列表携带 creative_skill_id（IK3NPB，1B service 双查）。
 */
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.generation.worker-scheduled=false"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SkillLibraryIT {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private CreativeSkillSeedRunner seedRunner;
    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void cleanTables() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM creative_skill_version",
                "DELETE FROM creative_skill",
                "DELETE FROM user_skill",
                "DELETE FROM skill");
    }

    @Test
    void libraryRecordCarriesCreativeSkillIdAlongsideLegacyFields() throws Exception {
        jdbcTemplate.update(
                "INSERT INTO skill (name, description, content, source, sort_order, version, is_delete) "
                        + "VALUES (?,?,?,?,?,?,0)",
                "Tvc Product Ad", "测试技能", CONTENT, "official", 1, 0);
        seedRunner.seed();

        String json = mockMvc.perform(post("/api/agent/skills/library")
                        .header("X-User-Id", "1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);

        JsonNode record = objectMapper.readTree(json).path("data").path("records").get(0);
        assertThat(record.path("creative_skill_id").asText())
                .matches("^[a-z][a-z0-9_]{2,79}$")
                .isEqualTo("cs_custom_ecom_tvc_product_ad");
        // 1B 回归：既有字段保持不变
        assertThat(record.path("id").asLong()).isPositive();
        assertThat(record.path("name").asText()).isEqualTo("Tvc Product Ad");
        assertThat(record.path("source").asText()).isEqualTo("official");
        assertThat(record.path("added").asBoolean()).isFalse();
    }

    private static final String CONTENT = """
            ---
            name: custom-ecom-tvc-product-ad
            description: 测试技能
            version: 0.1.0
            ---

            ## 说明
            正文内容
            """;
}
