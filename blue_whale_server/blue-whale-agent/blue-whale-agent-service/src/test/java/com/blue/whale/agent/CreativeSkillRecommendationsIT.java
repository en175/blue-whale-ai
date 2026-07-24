package com.blue.whale.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.Project;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * §7 Creative Skill 推荐查询端到端 IT（IK3NPI）：数据源从 Runtime Bundle 快照迁到
 * Java Skill Library，响应为契约封闭形状（4 字段，恒 {@code requires_user_use}），
 * 并冻结差集语义——排除本 Run 已冻结的 auto 候选。
 *
 * <p>覆盖：内部路由（租约鉴权，{@code bundle_version_id} 为 NULL 证明不再读 Bundle 快照）、
 * 候选差集（冻结候选被排除、候选为空时全部返回、active_version_id 为空不进入推荐）、
 * 公开路由（owner → 200 同形状；非 owner 与 Run 不存在统一 404，不泄漏资源存在性）。
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
class CreativeSkillRecommendationsIT {

    private static final long OWNER_ID = 10L;
    private static final Set<String> CONTRACT_FIELDS =
            Set.of("creative_skill_id", "name", "description", "activation_eligibility");

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void cleanTables() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM run_commits",
                "DELETE FROM runtime_checkpoints",
                "DELETE FROM conversation_messages",
                "DELETE FROM agent_runs",
                "DELETE FROM creative_skill_version",
                "DELETE FROM creative_skill",
                "DELETE FROM user_skill",
                "DELETE FROM skill",
                "DELETE FROM conversations",
                "DELETE FROM project_event_stream",
                "DELETE FROM project");
    }

    @Test
    void internalRouteReadsSkillLibraryEvenWithoutBundleSnapshot() throws Exception {
        // bundle_version_id 为 NULL：迁移的关键证据——数据源是 Skill Library，不再读 Bundle 快照。
        seedVisibleSkill("cs_poster_design", "poster-design", "海报设计创作方法。", 0);
        Long runId = seedLeasedRun("worker-1", null);

        JsonNode item = getRecommendations("/internal/agent-runs/{runId}/creative-skills", runId,
                "X-Worker-Id", "worker-1");

        assertThat(fieldNames(item)).isEqualTo(CONTRACT_FIELDS);
        assertThat(item.path("creative_skill_id").asText()).isEqualTo("cs_poster_design");
        assertThat(item.path("name").asText()).isEqualTo("poster-design");
        assertThat(item.path("description").asText()).isEqualTo("海报设计创作方法。");
        assertThat(item.path("activation_eligibility").asText()).isEqualTo("requires_user_use");
    }

    @Test
    void recommendationsExcludeFrozenAutoCandidates() throws Exception {
        // user 两个可见 Skill：cs_frozen（auto=1，已冻结为本 Run 候选）与 cs_kept（auto=0）。
        seedVisibleSkill("cs_frozen", "frozen-skill", "已冻结候选。", 1);
        seedVisibleSkill("cs_kept", "kept-skill", "仍可推荐。", 0);
        String candidates = "[{\"creative_skill_id\":\"cs_frozen\","
                + "\"name\":\"frozen-skill\",\"description\":\"已冻结候选。\","
                + "\"creative_skill_version_id\":\"csv_frozen_1_0_0\","
                + "\"display_version\":\"1.0.0\","
                + "\"resource_digest\":\"sha256:" + "0".repeat(64) + "\"}]";
        Long runId = seedLeasedRun("worker-1", null);
        jdbcTemplate.update(
                "UPDATE agent_runs SET auto_creative_skill_candidates = ? WHERE id = ?",
                candidates, runId);

        JsonNode data = getRecommendationsArray(
                "/internal/agent-runs/{runId}/creative-skills", runId, "X-Worker-Id", "worker-1");
        assertThat(data).hasSize(1);
        assertThat(data.get(0).path("creative_skill_id").asText()).isEqualTo("cs_kept");

        // 候选 JSON 为 [] 时（如 forced Run）全部可见 Skill 都可推荐，按 creative_skill_id 稳定排序。
        jdbcTemplate.update(
                "UPDATE agent_runs SET auto_creative_skill_candidates = '[]' WHERE id = ?", runId);
        JsonNode all = getRecommendationsArray(
                "/internal/agent-runs/{runId}/creative-skills", runId, "X-Worker-Id", "worker-1");
        assertThat(all).hasSize(2);
        assertThat(all.get(0).path("creative_skill_id").asText()).isEqualTo("cs_frozen");
        assertThat(all.get(1).path("creative_skill_id").asText()).isEqualTo("cs_kept");
    }

    @Test
    void recommendationsSkipSkillWithoutPublishedVersion() throws Exception {
        // active_version_id 为空的 Skill 无可用版本，不进入推荐（与候选冻结的同源语义）。
        seedVisibleSkill("cs_no_version", "no-version", "无发布版本。", 0, null);
        seedVisibleSkill("cs_ready", "ready", "可推荐。", 0);
        Long runId = seedLeasedRun("worker-1", null);

        JsonNode data = getRecommendationsArray(
                "/internal/agent-runs/{runId}/creative-skills", runId, "X-Worker-Id", "worker-1");
        assertThat(data).hasSize(1);
        assertThat(data.get(0).path("creative_skill_id").asText()).isEqualTo("cs_ready");
    }

    @Test
    void recommendationsSkipSkillWithBlankDescription() throws Exception {
        // description 为空的 Skill 违反契约 SkillDescription（minLength 1），fail closed 剔除。
        seedVisibleSkill("cs_blank_desc", "blank-desc", "", 0);
        seedVisibleSkill("cs_ready", "ready", "可推荐。", 0);
        Long runId = seedLeasedRun("worker-1", null);

        JsonNode data = getRecommendationsArray(
                "/internal/agent-runs/{runId}/creative-skills", runId, "X-Worker-Id", "worker-1");
        assertThat(data).hasSize(1);
        assertThat(data.get(0).path("creative_skill_id").asText()).isEqualTo("cs_ready");
    }

    @Test
    void publicRouteReturnsSameShapeForOwner() throws Exception {
        seedVisibleSkill("cs_poster_design", "poster-design", "海报设计创作方法。", 0);
        Long runId = seedLeasedRun("worker-1", null);

        JsonNode item = getRecommendations(
                "/api/agent/runs/{runId}/creative-skill-recommendations", runId,
                "X-User-Id", String.valueOf(OWNER_ID));

        assertThat(fieldNames(item)).isEqualTo(CONTRACT_FIELDS);
        assertThat(item.path("creative_skill_id").asText()).isEqualTo("cs_poster_design");
        assertThat(item.path("activation_eligibility").asText()).isEqualTo("requires_user_use");
    }

    @Test
    void publicRouteRejectsNonOwnerWith404() throws Exception {
        Long runId = seedLeasedRun("worker-1", null);
        mockMvc.perform(get("/api/agent/runs/{runId}/creative-skill-recommendations", runId)
                        .header("X-User-Id", "999"))
                .andExpect(status().isNotFound());
    }

    @Test
    void publicRouteRejectsMissingRunWith404() throws Exception {
        mockMvc.perform(get("/api/agent/runs/{runId}/creative-skill-recommendations", 424242L)
                        .header("X-User-Id", String.valueOf(OWNER_ID)))
                .andExpect(status().isNotFound());
    }

    /** GET 并断言 200，返回 {@code data} 数组的第一项（调用方保证恰有一项）。 */
    private JsonNode getRecommendations(String url, Long runId, String header, String headerValue)
            throws Exception {
        JsonNode data = getRecommendationsArray(url, runId, header, headerValue);
        assertThat(data).hasSize(1);
        return data.get(0);
    }

    private JsonNode getRecommendationsArray(String url, Long runId, String header, String headerValue)
            throws Exception {
        String json = mockMvc.perform(get(url, runId).header(header, headerValue))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        return objectMapper.readTree(json).path("data");
    }

    private static Set<String> fieldNames(JsonNode node) {
        Set<String> names = new TreeSet<>();
        for (Iterator<String> it = node.fieldNames(); it.hasNext(); ) {
            names.add(it.next());
        }
        return names;
    }

    private void seedVisibleSkill(String creativeSkillId, String name, String description, int auto) {
        seedVisibleSkill(creativeSkillId, name, description, auto, "csv_" + creativeSkillId + "_1_0_0");
    }

    /** 造一条 user 可见的 Creative Skill：skill + user_skill + creative_skill（source_skill_id 回链）。 */
    private void seedVisibleSkill(
            String creativeSkillId, String name, String description, int auto, String activeVersionId) {
        jdbcTemplate.update(
                "INSERT INTO skill (name, description, content, source, sort_order, version, is_delete) "
                        + "VALUES (?,?,?,?,?,?,0)",
                name, description, "正文", "official", 0, 0);
        Long skillId = jdbcTemplate.queryForObject(
                "SELECT id FROM skill WHERE name = ?", Long.class, name);
        jdbcTemplate.update("INSERT INTO user_skill (user_id, skill_id, auto) VALUES (?, ?, ?)",
                OWNER_ID, skillId, auto);
        jdbcTemplate.update(
                "INSERT INTO creative_skill (creative_skill_id, name, description, source_skill_id, "
                        + "active_version_id) VALUES (?,?,?,?,?)",
                creativeSkillId, name, description, skillId, activeVersionId);
    }

    private Long seedLeasedRun(String workerId, String bundleVersionId) {
        Project project = new Project().setOwnerId(OWNER_ID).setName("cs-recommendations");
        projectMapper.insert(project);
        jdbcTemplate.update("INSERT INTO conversations (project_id) VALUES (?)", project.getId());
        Long conversationId = jdbcTemplate.queryForObject(
                "SELECT MAX(id) FROM conversations WHERE project_id = ?", Long.class, project.getId());
        jdbcTemplate.update(
                "INSERT INTO agent_runs (project_id, conversation_id, user_id, status, engine, "
                        + "engine_version, adapter_schema_version, bundle_version_id, lease_owner, "
                        + "lease_expires_at, fencing_token) "
                        + "VALUES (?,?,?,?,?,?,?,?,?, DATEADD('MINUTE', 5, CURRENT_TIMESTAMP), 1)",
                project.getId(), conversationId, OWNER_ID, AgentRun.STATUS_RUNNING,
                "fake", "1", 1, bundleVersionId, workerId);
        return jdbcTemplate.queryForObject(
                "SELECT MAX(id) FROM agent_runs WHERE conversation_id = ?", Long.class, conversationId);
    }
}
