package com.blue.whale.agent;

import static org.assertj.core.api.Assertions.assertThat;

import com.blue.whale.agent.runtimebundle.RuntimeBundleDigests;
import com.blue.whale.agent.skill.CreativeSkillSeedRunner;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

/**
 * Creative Skill seed 回填（IK3NPB，决策 2A/3A）：official skill → 版本化库。
 */
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.generation.worker-scheduled=false"
})
@ActiveProfiles("test")
class CreativeSkillSeedIT {

    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private CreativeSkillSeedRunner seedRunner;
    @Autowired
    private RuntimeBundleDigests digests;

    @BeforeEach
    void cleanTables() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM creative_skill_version",
                "DELETE FROM creative_skill",
                "DELETE FROM user_skill",
                "DELETE FROM skill");
    }

    @Test
    void backfillsOfficialSkillsAsVersionedLibrary() {
        insertOfficial("Tvc Product Ad", 1, CONTENT_A);
        insertOfficial("Ugc Ads Video", 2, CONTENT_B);
        seedRunner.seed();

        assertThat(count("creative_skill")).isEqualTo(2);
        assertThat(count("creative_skill_version")).isEqualTo(2);

        List<String> creativeIds = jdbcTemplate.queryForList(
                "SELECT creative_skill_id FROM creative_skill", String.class);
        assertThat(creativeIds)
                .containsExactlyInAnyOrder("cs_custom_ecom_tvc_product_ad", "cs_ugc_ads_video")
                .allMatch(id -> id.matches("^[a-z][a-z0-9_]{2,79}$"));

        String versionId = "csv_custom_ecom_tvc_product_ad_0_1_0";
        String body = jdbcTemplate.queryForObject(
                "SELECT body FROM creative_skill_version WHERE creative_skill_version_id = ?",
                String.class, versionId);
        String contentDigest = jdbcTemplate.queryForObject(
                "SELECT content_digest FROM creative_skill_version WHERE creative_skill_version_id = ?",
                String.class, versionId);
        String resourceDigest = jdbcTemplate.queryForObject(
                "SELECT resource_digest FROM creative_skill_version WHERE creative_skill_version_id = ?",
                String.class, versionId);
        String displayVersion = jdbcTemplate.queryForObject(
                "SELECT display_version FROM creative_skill_version WHERE creative_skill_version_id = ?",
                String.class, versionId);

        // 3A：body 已剥 frontmatter（不含 frontmatter name），digest 对纯正文算
        assertThat(body).contains("## 说明").doesNotContain("custom-ecom-tvc-product-ad");
        assertThat(contentDigest).startsWith("sha256:").hasSize(71);
        assertThat(contentDigest).isEqualTo(digests.content(body));
        assertThat(resourceDigest).isEqualTo(contentDigest);
        assertThat(displayVersion).isEqualTo("0.1.0");

        // active_version_id 指向新版本，source_skill_id 回指 skill.id（1B 映射）
        String activeVersionId = jdbcTemplate.queryForObject(
                "SELECT active_version_id FROM creative_skill WHERE creative_skill_id = ?",
                String.class, "cs_custom_ecom_tvc_product_ad");
        assertThat(activeVersionId).isEqualTo(versionId);
        Long sourceSkillId = jdbcTemplate.queryForObject(
                "SELECT source_skill_id FROM creative_skill WHERE creative_skill_id = ?",
                Long.class, "cs_custom_ecom_tvc_product_ad");
        assertThat(sourceSkillId).isNotNull();

        // 2A 幂等：二次 seed 不重复回填
        seedRunner.seed();
        assertThat(count("creative_skill")).isEqualTo(2);
        assertThat(count("creative_skill_version")).isEqualTo(2);
    }

    private void insertOfficial(String name, int sortOrder, String content) {
        jdbcTemplate.update(
                "INSERT INTO skill (name, description, content, source, sort_order, version, is_delete) "
                        + "VALUES (?,?,?,?,?,?,0)",
                name, "测试技能", content, "official", sortOrder, 0);
    }

    private Integer count(String table) {
        return jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
    }

    private static final String CONTENT_A = """
            ---
            name: custom-ecom-tvc-product-ad
            description: 测试技能 A
            version: 0.1.0
            ---

            ## 说明
            正文 A
            """;

    private static final String CONTENT_B = """
            ---
            name: ugc-ads-video
            description: 测试技能 B
            version: 0.2.0
            ---

            ## 说明
            正文 B
            """;
}
