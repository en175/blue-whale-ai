package com.blue.whale.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.blue.whale.agent.runtimebundle.RuntimeBundleDigests;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.agent-orchestrator.engine=fake",
        "blue-whale.agent-orchestrator.engine-version=1",
        "blue-whale.agent-orchestrator.adapter-schema-version=1",
        "blue-whale.runtime-bundle.admin-user-ids=10",
        "blue-whale.runtime-bundle.enforcement-enabled=true",
        "blue-whale.runtime-bundle.default-agent-definition-id=pin_agent"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RuntimeBundleAgentRunPinIT {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void cleanFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM runtime_bundle_audit_records",
                "DELETE FROM runtime_bundle_write_idempotency",
                "DELETE FROM runtime_bundle_resources",
                "DELETE FROM runtime_bundle_versions",
                "DELETE FROM runtime_bundle_drafts",
                "DELETE FROM runtime_agent_definitions",
                "DELETE FROM user_input_requests",
                "DELETE FROM run_commits",
                "DELETE FROM runtime_checkpoints",
                "DELETE FROM command_idempotency",
                "DELETE FROM conversation_messages",
                "DELETE FROM agent_runs",
                "DELETE FROM conversations",
                "DELETE FROM outbox_messages",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project",
                "DELETE FROM creative_skill_version",
                "DELETE FROM creative_skill");
    }

    @Test
    void rollbackChangesOnlyNewRunsAndWorkerReceivesThePinnedIdentity() throws Exception {
        jdbcTemplate.update("INSERT INTO project (id, owner_id, name) VALUES (93001, 10, 'pin-test')");
        jdbcTemplate.update("""
                INSERT INTO runtime_agent_definitions
                    (agent_definition_id, definition_key, display_name, description, active_bundle_version_id)
                VALUES ('pin_agent', 'pin-agent', 'Pin Agent', 'AgentRun pin test', 'pin_agent_v2_0_0')
                """);
        String digestV1 = insertVersion("pin_agent_v1_0_0", "1.0.0", "model_v1", "canvas.read", "read");
        String digestV2 = insertVersion("pin_agent_v2_0_0", "2.0.0", "model_v2", "generate_image", "side_effect");

        long runV2 = postMessage("run-v2", "first run");

        // IK3BG2（ADR-0043）：新消息会原子取代同 Conversation 在途 Run——先认领 runV2
        // （Worker 工作包携带其 pin），再发第二条消息；第二条消息把 runV2 置为 superseded，
        // rollback 只影响之后创建的 Run 的 pin。
        JsonNode claimed = objectMapper.readTree(mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", "pin-worker")
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString()).path("data");

        mockMvc.perform(post("/internal/runtime-bundles/agents/pin_agent/rollback")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "rollback-pin-v1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bundle_version_id\":\"pin_agent_v1_0_0\"}"))
                .andExpect(status().isOk());

        long runV1 = postMessage("run-v1", "second run");

        // 在途 runV2 被新消息取代（superseded 终态），其 pin 不回溯改写。
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM agent_runs WHERE id = ?", String.class, runV2))
                .isEqualTo("superseded");

        Map<String, Object> oldPin = jdbcTemplate.queryForMap("""
                SELECT bundle_version_id, manifest_digest, model_profile_id, model_profile_version
                FROM agent_runs WHERE id = ?
                """, runV2);
        Map<String, Object> newPin = jdbcTemplate.queryForMap("""
                SELECT bundle_version_id, manifest_digest, model_profile_id, model_profile_version
                FROM agent_runs WHERE id = ?
                """, runV1);
        assertThat(oldPin).containsEntry("bundle_version_id", "pin_agent_v2_0_0")
                .containsEntry("manifest_digest", digestV2)
                .containsEntry("model_profile_id", "model_v2")
                .containsEntry("model_profile_version", "2.0.0");
        assertThat(newPin).containsEntry("bundle_version_id", "pin_agent_v1_0_0")
                .containsEntry("manifest_digest", digestV1)
                .containsEntry("model_profile_id", "model_v1")
                .containsEntry("model_profile_version", "1.0.0");

        // claimed 为 rollback 前认领的 runV2 工作包：Worker 收到的 pin 身份固定于 Run 创建时。
        assertThat(claimed.path("agent_run_id").asLong()).isEqualTo(runV2);
        assertThat(claimed.path("bundle_version_id").asText()).isEqualTo("pin_agent_v2_0_0");
        assertThat(claimed.path("manifest_digest").asText()).isEqualTo(digestV2);
        assertThat(claimed.path("model_profile_id").asText()).isEqualTo("model_v2");
        assertThat(claimed.path("model_profile_version").asText()).isEqualTo("2.0.0");
        // Worker 工作包携带当次 Run 钉住的 ToolGrant（JSON 文本），未授权工具不出现（IK2QBS）。
        JsonNode claimedToolGrants = objectMapper.readTree(claimed.path("tool_grants").asText());
        assertThat(claimedToolGrants.get(0).path("toolName").asText()).isEqualTo("generate_image");
        assertThat(claimedToolGrants.get(0).path("effect").asText()).isEqualTo("side_effect");
    }

    @Test
    void forcedMessagePinsCreativeSkillActivationSingleton() throws Exception {
        pinAgentFixture();
        insertCreativeSkill("cs_poster_design", "海报设计", "csv_poster_1_0_0");
        insertCreativeSkillVersion("csv_poster_1_0_0", "cs_poster_design",
                "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

        long run = postForcedMessage("forced-1", "生成海报", "cs_poster_design");

        String pinned = jdbcTemplate.queryForObject(
                "SELECT activated_creative_skill_versions FROM agent_runs WHERE id = ?",
                String.class, run);
        JsonNode activation = objectMapper.readTree(pinned);
        assertThat(activation.isArray()).isTrue();
        assertThat(activation).hasSize(1);
        assertThat(activation.get(0).path("creative_skill_id").asText()).isEqualTo("cs_poster_design");
        assertThat(activation.get(0).path("creative_skill_version_id").asText()).isEqualTo("csv_poster_1_0_0");
        assertThat(activation.get(0).path("source").asText()).isEqualTo("forced_use");
        assertThat(activation.get(0).path("reason").path("type").asText()).isEqualTo("user_use");
        assertThat(activation.get(0).path("resource_digest").asText())
                .isEqualTo("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    }

    @Test
    void plainMessageWithoutForcedPinsEmptyCreativeSkillVersions() throws Exception {
        pinAgentFixture();
        long run = postMessage("plain-1", "普通消息");
        String pinned = jdbcTemplate.queryForObject(
                "SELECT activated_creative_skill_versions FROM agent_runs WHERE id = ?",
                String.class, run);
        JsonNode node = objectMapper.readTree(pinned);
        assertThat(node.isArray()).isTrue();
        assertThat(node).isEmpty();
    }

    @Test
    void forcedMessageWithUnknownSkillRejectedAsUnavailable() throws Exception {
        pinAgentFixture();
        mockMvc.perform(post("/api/projects/93001/conversation/messages")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "forced-unknown")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"client_message_id\":\"client-x\",\"content\":\"x\","
                                + "\"forced_creative_skill_id\":\"cs_no_such_skill\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100306));
        assertThat(count("agent_runs")).isEqualTo(0);
    }

    @Test
    void forcedMessageWithMissingActiveVersionRejectedAsVersionUnavailable() throws Exception {
        pinAgentFixture();
        insertCreativeSkill("cs_orphan", "孤儿技能", null);
        mockMvc.perform(post("/api/projects/93001/conversation/messages")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "forced-orphan")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"client_message_id\":\"client-y\",\"content\":\"y\","
                                + "\"forced_creative_skill_id\":\"cs_orphan\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100307));
    }

    @Test
    void forcedMessageWithMissingVersionRowRejectedAsVersionUnavailable() throws Exception {
        pinAgentFixture();
        // active_version_id 指向 csv_no_such_version，但该版本行未插入 → selectOne 查无 → 100307
        insertCreativeSkill("cs_ghost_version", "幽灵版本技能", "csv_no_such_version");
        mockMvc.perform(post("/api/projects/93001/conversation/messages")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "forced-ghost-version")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"client_message_id\":\"client-gv\",\"content\":\"gv\","
                                + "\"forced_creative_skill_id\":\"cs_ghost_version\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100307));
    }

    @Test
    void forcedMessageWithInvalidDigestRejectedAsVersionUnavailable() throws Exception {
        pinAgentFixture();
        insertCreativeSkill("cs_bad_digest", "无效摘要技能", "csv_bad");
        // resource_digest 不匹配 ^sha256:[0-9a-f]{64}$ → 100307
        insertCreativeSkillVersion("csv_bad", "cs_bad_digest", "not-a-valid-digest");
        mockMvc.perform(post("/api/projects/93001/conversation/messages")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "forced-bad-digest")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"client_message_id\":\"client-bd\",\"content\":\"bd\","
                                + "\"forced_creative_skill_id\":\"cs_bad_digest\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(100307));
    }

    private long postMessage(String idempotencyKey, String content) throws Exception {
        String response = mockMvc.perform(post("/api/projects/93001/conversation/messages")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"client_message_id\":\"client-" + idempotencyKey
                                + "\",\"content\":\"" + content + "\"}"))
                .andExpect(status().isAccepted())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(response).path("data").path("agent_run_id").asLong();
    }

    private String insertVersion(String versionId, String version, String modelProfileId,
            String toolGrantName, String toolGrantEffect) throws Exception {
        ObjectNode manifest = objectMapper.createObjectNode()
                .put("formatVersion", 1)
                .put("baseUri", "bw-bundle://" + versionId + "/")
                .put("digestAlgorithm", "sha256");
        manifest.set("resources", objectMapper.createArrayNode());
        String digest = new RuntimeBundleDigests(objectMapper).canonicalJson(manifest);
        manifest.put("manifestDigest", digest);
        ObjectNode composition = objectMapper.createObjectNode();
        composition.set("modelProfiles", objectMapper.createArrayNode().add(
                objectMapper.createObjectNode()
                        .put("modelProfileId", modelProfileId)
                        .put("version", version)));
        ObjectNode grant = objectMapper.createObjectNode()
                .put("toolName", toolGrantName)
                .put("registryVersion", 1)
                .put("effect", toolGrantEffect)
                .put("proposalOnly", true);
        grant.set("argumentSchema", objectMapper.createObjectNode()
                .put("$schema", "https://json-schema.org/draft/2020-12/schema")
                .put("type", "object"));
        grant.set("constraints", objectMapper.createObjectNode());
        composition.set("toolGrants", objectMapper.createArrayNode().add(grant));
        composition.set("resourceManifest", manifest);
        ObjectNode snapshot = objectMapper.createObjectNode()
                .put("bundleVersionId", versionId);
        snapshot.set("composition", composition);
        jdbcTemplate.update("""
                INSERT INTO runtime_bundle_versions
                    (bundle_version_id, agent_definition_id, semantic_version, source_draft_id,
                     source_draft_revision, manifest_digest, snapshot_json, published_by)
                VALUES (?, 'pin_agent', ?, 'pin-agent-draft', 1, ?, ?, 10)
                """, versionId, version, digest, objectMapper.writeValueAsString(snapshot));
        return digest;
    }

    /**
     * IK3NPC forced 测试共用的最小 pin_agent 夹具（对齐 rollback 测试的发布基线）：
     * project 93001 + 默认 agent_definition pin_agent 激活到 pin_agent_v2_0_0。
     * forced 解析路径要先穿过默认 BundleVersion 校验才进入 resolveForcedActivation，
     * 故拒绝测试（100306/100307）与成功测试都需要该夹具存在。
     */
    private void pinAgentFixture() throws Exception {
        jdbcTemplate.update("INSERT INTO project (id, owner_id, name) VALUES (93001, 10, 'pin-test')");
        jdbcTemplate.update("""
                INSERT INTO runtime_agent_definitions
                    (agent_definition_id, definition_key, display_name, description, active_bundle_version_id)
                VALUES ('pin_agent', 'pin-agent', 'Pin Agent', 'AgentRun pin test', 'pin_agent_v2_0_0')
                """);
        insertVersion("pin_agent_v2_0_0", "2.0.0", "model_v2", "generate_image", "side_effect");
    }

    private void insertCreativeSkill(String skillId, String name, String activeVersionId) {
        jdbcTemplate.update("""
                INSERT INTO creative_skill (creative_skill_id, name, description, active_version_id)
                VALUES (?, ?, ?, ?)
                """, skillId, name, "测试技能", activeVersionId);
    }

    private void insertCreativeSkillVersion(String versionId, String skillId, String resourceDigest) {
        jdbcTemplate.update("""
                INSERT INTO creative_skill_version
                    (creative_skill_version_id, creative_skill_id, display_version, body,
                     content_digest, resource_digest, media_type)
                VALUES (?, ?, '0.1.0', '正文', ?, ?, 'text/markdown')
                """, versionId, skillId, resourceDigest, resourceDigest);
    }

    private long postForcedMessage(String idempotencyKey, String content, String forcedId) throws Exception {
        String body = "{\"client_message_id\":\"client-" + idempotencyKey + "\",\"content\":\"" + content
                + "\",\"forced_creative_skill_id\":\"" + forcedId + "\"}";
        String response = mockMvc.perform(post("/api/projects/93001/conversation/messages")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).path("data").path("agent_run_id").asLong();
    }

    private Integer count(String table) {
        return jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
    }
}
