package com.blue.whale.agent;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.generation.GenerationWorker;
import com.blue.whale.agent.support.FakeGenerationConfiguration;
import com.blue.whale.agent.support.FakeGenerationStorage;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import javax.imageio.ImageIO;
import java.io.ByteArrayInputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
@Import(FakeGenerationConfiguration.class)
class GenerationWorkerIT {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private GenerationJobMapper generationJobMapper;
    @Autowired
    private AssetMapper assetMapper;
    @Autowired
    private GenerationWorker generationWorker;
    @Autowired
    private FakeGenerationStorage storage;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void cleanFacts() {
        storage.clear();
        jdbcTemplate.batchUpdate(
                "DELETE FROM generation_result_conflicts",
                "DELETE FROM generation_job_outputs",
                "DELETE FROM assets",
                "DELETE FROM run_commits",
                "DELETE FROM runtime_checkpoints",
                "DELETE FROM command_idempotency",
                "DELETE FROM conversation_messages",
                "DELETE FROM generation_jobs",
                "DELETE FROM agent_runs",
                "DELETE FROM conversations",
                "DELETE FROM outbox_messages",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project");
    }

    @Test
    void conversationRunJobWorkerProducesOneImmutableImageAsset() throws Exception {
        Long jobId = createJobThroughAgentRun("蓝鲸海报");

        assertThat(generationWorker.runOnce("generation-worker-1")).isTrue();
        assertThat(generationWorker.runOnce("generation-worker-1")).isFalse();

        GenerationJob job = generationJobMapper.selectById(jobId);
        assertThat(job.getStatus()).isEqualTo(GenerationJob.STATUS_SUCCEEDED);
        assertThat(job.getOutputAssetIds()).hasSize(1);
        Long assetId = job.getOutputAssetIds().get(0);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT content_sha256 FROM assets WHERE id = ?", String.class, assetId))
                .matches("[0-9a-f]{64}");
        String storageKey = jdbcTemplate.queryForObject(
                "SELECT storage_key FROM assets WHERE id = ?", String.class, assetId);
        byte[] storedImage = storage.read(storageKey);
        assertThat(storedImage).startsWith(
                (byte) 0x89, (byte) 0x50, (byte) 0x4e, (byte) 0x47);
        assertThat(ImageIO.read(new ByteArrayInputStream(storedImage))).isNotNull();
        assertThat(count("generation_job_outputs", "generation_job_id", jobId)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForList(
                "SELECT event_type FROM project_events WHERE project_id = ? ORDER BY cursor",
                String.class, job.getProjectId()))
                .contains("asset.created", "generation_job.output_attached");

        MvcResult snapshot = mockMvc.perform(get("/api/projects/{id}/snapshot", job.getProjectId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode snapshotData = objectMapper.readTree(snapshot.getResponse().getContentAsString()).path("data");
        JsonNode output = snapshotData.path("generation_jobs").get(0).path("outputs").get(0);
        assertThat(output.path("slot_index").asInt()).isZero();
        assertThat(output.path("asset_id").asLong()).isEqualTo(assetId);
        String accessUrl = snapshotData.path("assets").path(String.valueOf(assetId))
                .path("access_url").asText();
        assertThat(accessUrl).isEqualTo(
                "/api/projects/" + job.getProjectId() + "/assets/" + assetId + "/content");
        mockMvc.perform(get(accessUrl).header("X-User-Id", "10"))
                .andExpect(status().isOk());
        mockMvc.perform(get(accessUrl).header("X-User-Id", "11"))
                .andExpect(status().isNotFound());
    }

    @Test
    void providerFailureMarksJobFailedWithoutAsset() throws Exception {
        Long jobId = createJobThroughAgentRun("fake:failure");

        assertThat(generationWorker.runOnce("generation-worker-failure")).isTrue();

        assertFailedWithoutAsset(jobId, "provider_failed");
    }

    @Test
    void providerNoResultMarksJobFailedWithoutAsset() throws Exception {
        Long jobId = createJobThroughAgentRun("fake:no-result");

        assertThat(generationWorker.runOnce("generation-worker-no-result")).isTrue();

        assertFailedWithoutAsset(jobId, "no_result");
    }

    @Test
    void snapshotKeepsLegacyDockOutputAssetReachable() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("legacy-dock");
        projectMapper.insert(project);
        Asset asset = new Asset()
                .setUserId(10L)
                .setType(Asset.TYPE_IMAGE)
                .setUrl("https://legacy.example.test/image.png")
                .setSource(Asset.SOURCE_GENERATED)
                .setStatus(Asset.STATUS_NORMAL);
        assetMapper.insert(asset);
        GenerationJob job = new GenerationJob()
                .setProjectId(project.getId())
                .setUserId(10L)
                .setType(GenerationJob.TYPE_IMAGE)
                .setSource(GenerationJob.SOURCE_DOCK)
                .setStatus(GenerationJob.STATUS_SUCCEEDED)
                .setProgress(100)
                .setOutputAssetIds(java.util.List.of(asset.getId()));
        generationJobMapper.insert(job);

        MvcResult snapshot = mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode data = objectMapper.readTree(snapshot.getResponse().getContentAsString()).path("data");

        assertThat(data.path("assets").path(String.valueOf(asset.getId()))
                .path("access_url").asText()).isEqualTo(asset.getUrl());
    }

    private Long createJobThroughAgentRun(String prompt) throws Exception {
        Project project = new Project().setOwnerId(10L).setName("generation-worker");
        projectMapper.insert(project);
        MvcResult message = mockMvc.perform(post("/api/projects/{id}/conversation/messages", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "message-" + project.getId())
                        .contentType("application/json")
                        .content("{\"client_message_id\":\"client-" + project.getId()
                                + "\",\"content\":\"生成图片\"}"))
                .andExpect(status().isAccepted())
                .andReturn();
        long runId = objectMapper.readTree(message.getResponse().getContentAsString())
                .path("data").path("agent_run_id").asLong();
        MvcResult claimed = mockMvc.perform(post("/internal/agent-runs/claim")
                        .header("X-Worker-Id", "agent-worker")
                        .header("X-Orchestrator-Engine", "fake"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode work = objectMapper.readTree(claimed.getResponse().getContentAsString()).path("data");
        String commit = "{" +
                "\"commit_id\":\"commit-1\"," +
                "\"project_id\":" + project.getId() + "," +
                "\"user_id\":10," +
                "\"expected_run_version\":" + work.path("run_version").asInt() + "," +
                "\"fencing_token\":" + work.path("fencing_token").asLong() + "," +
                "\"engine\":\"fake\"," +
                "\"engine_version\":\"1\"," +
                "\"adapter_schema_version\":1," +
                "\"visible_text\":\"已接纳，正在生成图片。\"," +
                "\"checkpoint\":{\"opaque_payload\":{\"step\":\"proposed\"}}," +
                "\"actions\":[{\"action_id\":\"action-1\",\"action_type\":\"generate_image\"," +
                "\"arguments\":{\"prompt\":\"" + prompt + "\",\"aspect_ratio\":\"1:1\"}}]}";
        MvcResult committed = mockMvc.perform(post("/internal/agent-runs/{id}/commits", runId)
                        .header("X-Worker-Id", "agent-worker")
                        .contentType("application/json")
                        .content(commit))
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(committed.getResponse().getContentAsString())
                .path("data").path("generation_job_id").asLong();
    }

    private void assertFailedWithoutAsset(Long jobId, String errorCode) {
        GenerationJob job = generationJobMapper.selectById(jobId);
        assertThat(job.getStatus()).isEqualTo(GenerationJob.STATUS_FAILED);
        assertThat(job.getError()).containsEntry("code", errorCode);
        assertThat(count("assets", "generation_job_id", jobId)).isZero();
        assertThat(count("generation_job_outputs", "generation_job_id", jobId)).isZero();
    }

    private long count(String table, String column, Long value) {
        Long result = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?", Long.class, value);
        return result == null ? 0 : result;
    }
}
