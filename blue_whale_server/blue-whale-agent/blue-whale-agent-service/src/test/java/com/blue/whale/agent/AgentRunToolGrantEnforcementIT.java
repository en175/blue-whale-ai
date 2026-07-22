package com.blue.whale.agent;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.runtimebundle.RuntimeBundleDigests;
import com.blue.whale.agent.runtimebundle.ToolDefinition;
import com.blue.whale.agent.runtimebundle.ToolRegistry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

/**
 * 验证 enforcement=true（生产路径）下 commit 校验由注册表 + Run 钉住 grants 驱动：
 * Run Bundle 授权的 tool_id 通过并创建 GenerationJob；注册表存在但 Run 未授权的 tool_id 被拒。
 *
 * <p>与 {@link AgentActionGovernanceIT}（enforcement=false，注册表 + 业务约束 + Gate + 幂等 + 互斥）
 * 互补，覆盖 ADR-0040「注册表 + Run 钉住 grants 服务端复验」的端到端路径。
 */
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.agent-orchestrator.engine=fake",
        "blue-whale.agent-orchestrator.engine-version=1",
        "blue-whale.agent-orchestrator.adapter-schema-version=1",
        "blue-whale.runtime-bundle.enforcement-enabled=true",
        "blue-whale.runtime-bundle.default-agent-definition-id=grant_agent",
        "blue-whale.cost-control.image-reservation-fen=100"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AgentRunToolGrantEnforcementIT {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private ToolRegistry toolRegistry;

    @BeforeEach
    void cleanFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM audit_records",
                "DELETE FROM cost_reservations",
                "DELETE FROM cost_budget_locks",
                "DELETE FROM user_input_requests",
                "DELETE FROM run_commits",
                "DELETE FROM runtime_checkpoints",
                "DELETE FROM command_idempotency",
                "DELETE FROM conversation_messages",
                "DELETE FROM generation_job_outputs",
                "DELETE FROM generation_jobs",
                "DELETE FROM agent_runs",
                "DELETE FROM conversations",
                "DELETE FROM outbox_messages",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project",
                "DELETE FROM runtime_bundle_versions",
                "DELETE FROM runtime_agent_definitions");
    }

    @Test
    void runPinnedGrantAuthorizesCreateImageGenerationJob() throws Exception {
        publishBundleWithImageGrant("grant_agent_v1", "1.0.0", "model_v1");
        Project project = new Project().setOwnerId(10L).setName("grant-authorized");
        projectMapper.insert(project);
        JsonNode run = postMessage(project.getId(), "grant-auth-msg", "生成蓝鲸海报").path("agent_run_id");
        JsonNode work = claim(run.asLong(), "grant-auth-worker");

        commit(run.asLong(), "grant-auth-worker",
                commitBody(project.getId(), work, "grant-auth-commit", "create_image_generation_job"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_job_id").isNumber());

        org.assertj.core.api.Assertions.assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM generation_jobs WHERE agent_run_id = ?", Long.class, run.asLong()))
                .isEqualTo(1);
    }

    @Test
    void toolRegisteredButNotGrantedToRunIsRejected() throws Exception {
        publishBundleWithImageGrant("grant_agent_v1", "1.0.0", "model_v1");
        Project project = new Project().setOwnerId(10L).setName("grant-missing");
        projectMapper.insert(project);
        JsonNode run = postMessage(project.getId(), "grant-missing-msg", "读取画布").path("agent_run_id");
        JsonNode work = claim(run.asLong(), "grant-missing-worker");

        commit(run.asLong(), "grant-missing-worker",
                commitBody(project.getId(), work, "grant-missing-commit", "canvas.read"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("ACTION_NOT_ALLOWED"));

        org.assertj.core.api.Assertions.assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM generation_jobs", Long.class)).isZero();
        org.assertj.core.api.Assertions.assertThat(jdbcTemplate.queryForObject(
                "SELECT reason_code FROM audit_records WHERE decision = 'denied' ORDER BY id DESC LIMIT 1",
                String.class)).isEqualTo("ACTION_SCHEMA_OR_OWNERSHIP_REJECTED");
    }

    @Test
    void grantArgumentSchemaWiderThanRegistryIsRejected() throws Exception {
        publishBundleWithWiderImageGrant("grant_agent_v1", "1.0.0", "model_v1");
        Project project = new Project().setOwnerId(10L).setName("grant-wider");
        projectMapper.insert(project);
        JsonNode run = postMessage(project.getId(), "grant-wider-msg", "生成海报").path("agent_run_id");
        JsonNode work = claim(run.asLong(), "grant-wider-worker");

        commit(run.asLong(), "grant-wider-worker",
                commitBody(project.getId(), work, "grant-wider-commit", "create_image_generation_job"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("ACTION_NOT_ALLOWED"));

        org.assertj.core.api.Assertions.assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM generation_jobs", Long.class)).isZero();
        org.assertj.core.api.Assertions.assertThat(jdbcTemplate.queryForObject(
                "SELECT reason_code FROM audit_records WHERE decision = 'denied' ORDER BY id DESC LIMIT 1",
                String.class)).isEqualTo("ACTION_SCHEMA_OR_OWNERSHIP_REJECTED");
    }

    @Test
    void clarificationProposalRejectedWhenRequestUserInputNotGranted() throws Exception {
        // IK3AH2：未授予 request_user_input 的 Run 发起创作澄清 → 软回喂（200，run queued/awaiting_retry，
        // 不创建 input request），堵住绕过动作路径 grant 铁闸的盲点。
        publishBundleWithImageGrant("grant_agent_v1", "1.0.0", "model_v1");
        Project project = new Project().setOwnerId(10L).setName("clarification-grant-missing");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "clar-missing-msg", "生成蓝鲸海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId, "clar-missing-worker");

        commit(runId, "clar-missing-worker", clarificationProposalCommitBody(
                        project.getId(), work, "clar-missing-commit", "Which style?"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.input_request_id").doesNotExist())
                .andExpect(jsonPath("$.data.generation_job_id").doesNotExist());

        // run 软回喂进入 queued / awaiting_retry，未创建 user_input_request。
        org.assertj.core.api.Assertions.assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM agent_runs WHERE id = ?", String.class, runId)).isEqualTo("queued");
        org.assertj.core.api.Assertions.assertThat(jdbcTemplate.queryForObject(
                "SELECT stage FROM agent_runs WHERE id = ?", String.class, runId)).isEqualTo("awaiting_retry");
        org.assertj.core.api.Assertions.assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM user_input_requests", Long.class)).isZero();
        // RunCommitRecord 落 rejected_action_id，audit 记 CLARIFICATION_TOOL_NOT_GRANTED。
        org.assertj.core.api.Assertions.assertThat(jdbcTemplate.queryForObject(
                "SELECT rejected_action_id FROM run_commits WHERE agent_run_id = ?",
                String.class, runId)).isEqualTo("clarification:" + runId);
        org.assertj.core.api.Assertions.assertThat(jdbcTemplate.queryForObject(
                "SELECT reason_code FROM audit_records WHERE reason_code = 'CLARIFICATION_TOOL_NOT_GRANTED'",
                String.class)).isEqualTo("CLARIFICATION_TOOL_NOT_GRANTED");
        // 再次 claim：accepted_results 回喂 rejected（软回喂）。
        JsonNode reclaimed = claim(runId, "clar-missing-worker");
        org.assertj.core.api.Assertions.assertThat(
                reclaimed.path("accepted_results").get(0).path("status").asText()).isEqualTo("rejected");
        org.assertj.core.api.Assertions.assertThat(
                reclaimed.path("accepted_results").get(0).path("action_id").asText())
                .isEqualTo("clarification:" + runId);
    }

    @Test
    void clarificationProposalAcceptedWhenGranted() throws Exception {
        // IK3AH2：授予 request_user_input 的 Run 发起创作澄清 → 正常 awaiting_input（不回归）。
        publishBundleWithGrants("grant_agent_v2", "2.0.0", "model_v1",
                toolRegistry.find("create_image_generation_job", 1).orElseThrow(),
                toolRegistry.find("request_user_input", 1).orElseThrow());
        Project project = new Project().setOwnerId(10L).setName("clarification-granted");
        projectMapper.insert(project);
        long runId = postMessage(project.getId(), "clar-granted-msg", "生成蓝鲸海报")
                .path("agent_run_id").asLong();
        JsonNode work = claim(runId, "clar-granted-worker");

        commit(runId, "clar-granted-worker", clarificationProposalCommitBody(
                        project.getId(), work, "clar-granted-commit", "Which style?"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.input_request_id").isNumber());

        org.assertj.core.api.Assertions.assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM agent_runs WHERE id = ?", String.class, runId)).isEqualTo("awaiting_input");
        org.assertj.core.api.Assertions.assertThat(jdbcTemplate.queryForObject(
                "SELECT stage FROM agent_runs WHERE id = ?", String.class, runId))
                .isEqualTo("awaiting_clarification");
        org.assertj.core.api.Assertions.assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM user_input_requests", Long.class)).isEqualTo(1L);
    }

    private void publishBundleWithImageGrant(String versionId, String version, String modelProfileId) throws Exception {
        ToolDefinition definition = toolRegistry.find("create_image_generation_job", 1).orElseThrow();
        publishBundle(versionId, version, modelProfileId, definition.inputSchema(), definition.constraints());
    }

    private void publishBundleWithWiderImageGrant(String versionId, String version, String modelProfileId) throws Exception {
        ToolDefinition definition = toolRegistry.find("create_image_generation_job", 1).orElseThrow();
        ObjectNode widerSchema = definition.inputSchema().deepCopy();
        ((ObjectNode) widerSchema.get("properties")).putObject("extra").put("type", "string");
        publishBundle(versionId, version, modelProfileId, widerSchema, definition.constraints());
    }

    private void publishBundle(String versionId, String version, String modelProfileId,
                               JsonNode argumentSchema, JsonNode constraints) throws Exception {
        jdbcTemplate.update("""
                INSERT INTO runtime_agent_definitions
                    (agent_definition_id, definition_key, display_name, description, active_bundle_version_id)
                VALUES ('grant_agent', 'grant-agent', 'Grant Agent', 'tool grant enforcement', ?)
                """, versionId);
        ObjectNode manifest = objectMapper.createObjectNode()
                .put("formatVersion", 1)
                .put("baseUri", "bw-bundle://" + versionId + "/")
                .put("digestAlgorithm", "sha256");
        manifest.set("resources", objectMapper.createArrayNode());
        String digest = new RuntimeBundleDigests(objectMapper).canonicalJson(manifest);
        manifest.put("manifestDigest", digest);
        ObjectNode grant = objectMapper.createObjectNode()
                .put("toolName", "create_image_generation_job")
                .put("registryVersion", 1)
                .put("effect", "side_effect")
                .put("proposalOnly", true);
        grant.set("argumentSchema", argumentSchema);
        grant.set("constraints", constraints);
        ObjectNode composition = objectMapper.createObjectNode();
        composition.set("modelProfiles", objectMapper.createArrayNode().add(
                objectMapper.createObjectNode().put("modelProfileId", modelProfileId).put("version", version)));
        composition.set("toolGrants", objectMapper.createArrayNode().add(grant));
        composition.set("resourceManifest", manifest);
        ObjectNode snapshot = objectMapper.createObjectNode().put("bundleVersionId", versionId);
        snapshot.set("composition", composition);
        jdbcTemplate.update("""
                INSERT INTO runtime_bundle_versions
                    (bundle_version_id, agent_definition_id, semantic_version, source_draft_id,
                     source_draft_revision, manifest_digest, snapshot_json, published_by)
                VALUES (?, 'grant_agent', ?, 'grant-agent-draft', 1, ?, ?, 10)
                """, versionId, version, digest, objectMapper.writeValueAsString(snapshot));
    }

    private void publishBundleWithGrants(String versionId, String version, String modelProfileId,
                                         ToolDefinition... granted) throws Exception {
        jdbcTemplate.update("""
                INSERT INTO runtime_agent_definitions
                    (agent_definition_id, definition_key, display_name, description, active_bundle_version_id)
                VALUES ('grant_agent', 'grant-agent', 'Grant Agent', 'tool grant enforcement', ?)
                """, versionId);
        ObjectNode manifest = objectMapper.createObjectNode()
                .put("formatVersion", 1)
                .put("baseUri", "bw-bundle://" + versionId + "/")
                .put("digestAlgorithm", "sha256");
        manifest.set("resources", objectMapper.createArrayNode());
        String digest = new RuntimeBundleDigests(objectMapper).canonicalJson(manifest);
        manifest.put("manifestDigest", digest);
        ArrayNode grants = objectMapper.createArrayNode();
        for (ToolDefinition def : granted) {
            ObjectNode grant = objectMapper.createObjectNode()
                    .put("toolName", def.toolId())
                    .put("registryVersion", def.registryVersion())
                    .put("effect", def.effect())
                    .put("proposalOnly", true);
            grant.set("argumentSchema", def.inputSchema());
            grant.set("constraints", def.constraints());
            grants.add(grant);
        }
        ObjectNode composition = objectMapper.createObjectNode();
        composition.set("modelProfiles", objectMapper.createArrayNode().add(
                objectMapper.createObjectNode().put("modelProfileId", modelProfileId).put("version", version)));
        composition.set("toolGrants", grants);
        composition.set("resourceManifest", manifest);
        ObjectNode snapshot = objectMapper.createObjectNode().put("bundleVersionId", versionId);
        snapshot.set("composition", composition);
        jdbcTemplate.update("""
                INSERT INTO runtime_bundle_versions
                    (bundle_version_id, agent_definition_id, semantic_version, source_draft_id,
                     source_draft_revision, manifest_digest, snapshot_json, published_by)
                VALUES (?, 'grant_agent', ?, 'grant-agent-draft', 1, ?, ?, 10)
                """, versionId, version, digest, objectMapper.writeValueAsString(snapshot));
    }

    private String clarificationProposalCommitBody(long projectId, JsonNode work, String commitId, String question) {
        return "{"
                + "\"commit_id\":\"" + commitId + "\","
                + "\"project_id\":" + projectId + ","
                + "\"user_id\":10,"
                + "\"expected_run_version\":" + work.path("run_version").asInt() + ","
                + "\"fencing_token\":" + work.path("fencing_token").asLong() + ","
                + "\"engine\":\"fake\","
                + "\"engine_version\":\"1\","
                + "\"adapter_schema_version\":1,"
                + "\"visible_text\":\"" + question + "\","
                + "\"checkpoint\":{\"opaque_payload\":{\"step\":\"clarification_proposed\"}},"
                + "\"actions\":[],"
                + "\"user_input_request\":{\"request_type\":\"creation_clarification\",\"question\":\"" + question + "\"}}";
    }

    private JsonNode postMessage(long projectId, String key, String content) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/projects/{id}/conversation/messages", projectId)
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", key)
                        .contentType("application/json")
                        .content(messageBody("client-" + key, content)))
                .andExpect(status().isAccepted())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private JsonNode claim(long runId, String workerId) throws Exception {
        MvcResult result = mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", workerId)
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private ResultActions commit(long runId, String workerId, String body) throws Exception {
        return mockMvc.perform(post("/internal/agent-runs/{id}/commits", runId)
                .header("X-Worker-Id", workerId)
                .contentType("application/json")
                .content(body));
    }

    private String commitBody(long projectId, JsonNode work, String commitId, String toolId) {
        return "{" +
                "\"commit_id\":\"" + commitId + "\"," +
                "\"project_id\":" + projectId + "," +
                "\"user_id\":10," +
                "\"expected_run_version\":" + work.path("run_version").asInt() + "," +
                "\"fencing_token\":" + work.path("fencing_token").asLong() + "," +
                "\"engine\":\"fake\"," +
                "\"engine_version\":\"1\"," +
                "\"adapter_schema_version\":1," +
                "\"visible_text\":\"准备执行图片生成。\"," +
                "\"checkpoint\":{\"opaque_payload\":{\"step\":\"proposed\"}}," +
                "\"actions\":[{\"action_id\":\"" + commitId + "\"," +
                "\"tool_id\":\"" + toolId + "\",\"registry_version\":1," +
                "\"arguments\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}}]}";
    }

    private String messageBody(String clientId, String content) {
        return "{\"client_message_id\":\"" + clientId + "\",\"content\":\"" + content + "\"}";
    }
}
