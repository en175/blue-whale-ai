package com.blue.whale.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
                "DELETE FROM project");
    }

    @Test
    void rollbackChangesOnlyNewRunsAndWorkerReceivesThePinnedIdentity() throws Exception {
        jdbcTemplate.update("INSERT INTO project (id, owner_id, name) VALUES (93001, 10, 'pin-test')");
        jdbcTemplate.update("""
                INSERT INTO runtime_agent_definitions
                    (agent_definition_id, definition_key, display_name, description, active_bundle_version_id)
                VALUES ('pin_agent', 'pin-agent', 'Pin Agent', 'AgentRun pin test', 'pin_agent_v2_0_0')
                """);
        String digestV1 = insertVersion("pin_agent_v1_0_0", "1.0.0", "model_v1");
        String digestV2 = insertVersion("pin_agent_v2_0_0", "2.0.0", "model_v2");

        long runV2 = postMessage("run-v2", "first run");

        mockMvc.perform(post("/internal/runtime-bundles/agents/pin_agent/rollback")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "rollback-pin-v1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bundle_version_id\":\"pin_agent_v1_0_0\"}"))
                .andExpect(status().isOk());

        long runV1 = postMessage("run-v1", "second run");

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

        JsonNode claimed = objectMapper.readTree(mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", "pin-worker")
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString()).path("data");
        assertThat(claimed.path("agent_run_id").asLong()).isEqualTo(runV2);
        assertThat(claimed.path("bundle_version_id").asText()).isEqualTo("pin_agent_v2_0_0");
        assertThat(claimed.path("manifest_digest").asText()).isEqualTo(digestV2);
        assertThat(claimed.path("model_profile_id").asText()).isEqualTo("model_v2");
        assertThat(claimed.path("model_profile_version").asText()).isEqualTo("2.0.0");
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

    private String insertVersion(String versionId, String version, String modelProfileId) throws Exception {
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
}
