package com.blue.whale.agent;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.AgentRun;
import com.blue.whale.agent.model.entity.Project;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * §6 已激活 Creative Skill 正文 / 引用资源读取端点端到端 IT（IK3NPD-T3）。
 *
 * <p>覆盖 Java §6 端点的固定版本派生（从 Run pin 的 activated_creative_skill_versions 派生）、
 * 跨 Run / 跨版本拒绝（无激活 → 100311；版本不可读 → 100307）、引用资源缺失（首批 seed 无引用
 * 资源 → 100311）、摘要正确性（返回 content_digest == sha256(body)）、租约鉴权（跨 worker → 100303）。
 * Worker 侧的双重 digest 校验由 Python 测试覆盖（test_creative_skill_gate）。
 */
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.agent-orchestrator.engine=fake",
        "blue-whale.agent-orchestrator.engine-version=1",
        "blue-whale.agent-orchestrator.adapter-schema-version=1"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CreativeSkillActivationReadIT {

    private static final String SKILL_ID = "cs_poster_design";
    private static final String VERSION_ID = "csv_poster_design_1_0_0";
    private static final String BODY = "# 海报设计\n1. 明确主题 2. 版式网格 3. 主视觉草稿。";

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void cleanCreativeSkillFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM run_commits",
                "DELETE FROM runtime_checkpoints",
                "DELETE FROM conversation_messages",
                "DELETE FROM agent_runs",
                "DELETE FROM creative_skill_version",
                "DELETE FROM creative_skill",
                "DELETE FROM conversations",
                "DELETE FROM project_event_stream",
                "DELETE FROM project");
    }

    @Test
    void readBodyReturnsPinnedVersionBodyAndDigest() throws Exception {
        // 固定版本派生：从 Run pin 派生 Skill / 版本，返回正文与 content_digest（= sha256(body)）。
        seedCreativeSkillVersion();
        Long runId = seedLeasedRunWithActivation();
        mockMvc.perform(get("/internal/agent-runs/{runId}/creative-skill-body", runId)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.creative_skill_id").value(SKILL_ID))
                .andExpect(jsonPath("$.data.creative_skill_version_id").value(VERSION_ID))
                .andExpect(jsonPath("$.data.media_type").value("text/markdown"))
                .andExpect(jsonPath("$.data.body").value(BODY))
                .andExpect(jsonPath("$.data.content_digest").value(sha256(BODY)));
    }

    @Test
    void readBodyRejectsRunWithoutActivation() throws Exception {
        // 无激活 pin 的 Run 请求正文 → CONTENT_MISSING（100311），不伪造 / 不降级。
        Long runId = seedLeasedRun("worker-1");
        mockMvc.perform(get("/internal/agent-runs/{runId}/creative-skill-body", runId)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().is5xxServerError())
                .andExpect(jsonPath("$.code").value(100311));
    }

    @Test
    void readBodyRejectsPinnedVersionNotReadable() throws Exception {
        // pin 指向的版本不在版本库 → VERSION_UNAVAILABLE（100307），不换版本 / 不降级。
        Long runId = seedLeasedRunWithActivation();
        mockMvc.perform(get("/internal/agent-runs/{runId}/creative-skill-body", runId)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100307));
    }

    @Test
    void readBodyReturnsStoredDigestWithoutRecalculation() throws Exception {
        // Java §6 透传 DB content_digest，不重算（双重 digest 校验在 Worker，契约 §6）：
        // seed content_digest 与 body 真实摘要不符 → Java 仍返回 DB 存储值，交 Worker fail closed。
        String stored = "sha256:" + "0".repeat(64);
        seedCreativeSkillVersion(stored);
        Long runId = seedLeasedRunWithActivation();
        mockMvc.perform(get("/internal/agent-runs/{runId}/creative-skill-body", runId)
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.body").value(BODY))
                .andExpect(jsonPath("$.data.content_digest").value(stored));
    }

    @Test
    void readReferenceReturnsContentMissingForSeedWithoutReferences() throws Exception {
        // 首批 seed 无引用资源：请求任何引用资源 fail closed（100311），不伪造引用内容。
        seedCreativeSkillVersion();
        Long runId = seedLeasedRunWithActivation();
        mockMvc.perform(get("/internal/agent-runs/{runId}/creative-skill-references/{path}",
                        runId, "references/layout-checklist.md")
                        .header("X-Worker-Id", "worker-1"))
                .andExpect(status().is5xxServerError())
                .andExpect(jsonPath("$.code").value(100311));
    }

    @Test
    void readBodyRejectsForeignWorker() throws Exception {
        // 跨 worker 读他人租约的 Run → AGENT_RUN_CONFLICT（100303）。
        seedCreativeSkillVersion();
        Long runId = seedLeasedRunWithActivation();
        mockMvc.perform(get("/internal/agent-runs/{runId}/creative-skill-body", runId)
                        .header("X-Worker-Id", "worker-2"))
                .andExpect(status().is4xxClientError())
                .andExpect(jsonPath("$.code").value(100303));
    }

    private Long newProject(long ownerId) {
        Project project = new Project().setOwnerId(ownerId).setName("cs-activation-read-" + ownerId);
        projectMapper.insert(project);
        return project.getId();
    }

    private Long seedConversation(Long projectId) {
        jdbcTemplate.update("INSERT INTO conversations (project_id) VALUES (?)", projectId);
        return jdbcTemplate.queryForObject(
                "SELECT MAX(id) FROM conversations WHERE project_id = ?", Long.class, projectId);
    }

    private Long seedLeasedRun(String workerId) {
        Long projectId = newProject(10L);
        Long conversationId = seedConversation(projectId);
        jdbcTemplate.update(
                "INSERT INTO agent_runs (project_id, conversation_id, user_id, status, engine, engine_version, "
                        + "adapter_schema_version, lease_owner, lease_expires_at, fencing_token) "
                        + "VALUES (?,?,?,?,?,?,?,?, DATEADD('MINUTE', 5, CURRENT_TIMESTAMP), 1)",
                projectId, conversationId, 10L, AgentRun.STATUS_RUNNING, "fake", "1", 1, workerId);
        return jdbcTemplate.queryForObject(
                "SELECT MAX(id) FROM agent_runs WHERE conversation_id = ?", Long.class, conversationId);
    }

    private Long seedLeasedRunWithActivation() throws Exception {
        Long runId = seedLeasedRun("worker-1");
        // Run pin 的 activated_creative_skill_versions：JSON 文本（0/1 单例，与 RunPinResolver 同形态）。
        String pin = "[{\"creative_skill_id\":\"" + SKILL_ID + "\","
                + "\"creative_skill_version_id\":\"" + VERSION_ID + "\","
                + "\"source\":\"forced_use\","
                + "\"reason\":{\"type\":\"user_use\"},"
                + "\"resource_digest\":\"" + sha256(BODY) + "\"}]";
        jdbcTemplate.update(
                "UPDATE agent_runs SET activated_creative_skill_versions = ? WHERE id = ?", pin, runId);
        return runId;
    }

    private void seedCreativeSkillVersion() throws Exception {
        seedCreativeSkillVersion(sha256(BODY));
    }

    private void seedCreativeSkillVersion(String contentDigest) {
        jdbcTemplate.update(
                "INSERT INTO creative_skill (creative_skill_id, name, description, active_version_id) "
                        + "VALUES (?,?,?,?)",
                SKILL_ID, "poster-design", "海报设计创作方法。", VERSION_ID);
        jdbcTemplate.update(
                "INSERT INTO creative_skill_version "
                        + "(creative_skill_version_id, creative_skill_id, display_version, body, "
                        + "content_digest, resource_digest, media_type) VALUES (?,?,?,?,?,?,?)",
                VERSION_ID, SKILL_ID, "1.0.0", BODY, contentDigest, contentDigest, "text/markdown");
    }

    private static String sha256(String text) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(text.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder("sha256:");
        for (byte b : hash) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
