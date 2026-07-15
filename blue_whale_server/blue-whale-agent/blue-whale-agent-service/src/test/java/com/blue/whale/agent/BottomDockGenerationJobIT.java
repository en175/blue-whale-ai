package com.blue.whale.agent;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.dto.GenerationAcceptanceResult;
import com.blue.whale.agent.model.dto.GenerationResultCommand;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
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

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(FakeGenerationConfiguration.class)
class BottomDockGenerationJobIT {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private AssetMapper assetMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private GenerationWorker generationWorker;
    @Autowired
    private FakeGenerationStorage storage;
    @Autowired
    private GenerationResultAcceptanceService generationResultAcceptanceService;

    @BeforeEach
    void cleanFacts() {
        storage.clear();
        jdbcTemplate.batchUpdate(
                "DELETE FROM generation_result_conflicts",
                "DELETE FROM generation_job_outputs",
                "DELETE FROM assets",
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
    void repeatedCommandReturnsFirstAcceptanceWithoutAgentFacts() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("bottom-dock-idempotency");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":1}";

        MvcResult first = postGenerationJob(project.getId(), "dock-key-1", body)
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.generation_job_id").isNumber())
                .andExpect(jsonPath("$.data.cursor").isNumber())
                .andReturn();
        MvcResult repeated = postGenerationJob(project.getId(), "dock-key-1", body)
                .andExpect(status().isAccepted())
                .andReturn();

        JsonNode firstData = objectMapper.readTree(first.getResponse().getContentAsString()).path("data");
        JsonNode repeatedData = objectMapper.readTree(repeated.getResponse().getContentAsString()).path("data");
        assertThat(repeatedData).isEqualTo(firstData);
        assertThat(count("generation_jobs", "project_id", project.getId())).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT source FROM generation_jobs WHERE project_id = ?", String.class, project.getId()))
                .isEqualTo("bottom_dock");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT input FROM generation_jobs WHERE project_id = ?", String.class, project.getId()))
                .doesNotContain("reference_asset_ids");
        assertThat(count("conversation_messages", "project_id", project.getId())).isZero();
        assertThat(count("agent_runs", "project_id", project.getId())).isZero();
        assertThat(count("project_events", "project_id", project.getId())).isEqualTo(1);
        assertThat(count("outbox_messages", "project_id", project.getId())).isEqualTo(1);
    }

    @Test
    void foreignInputAssetIsRejectedWithoutCreatingJob() throws Exception {
        Project owned = new Project().setOwnerId(10L).setName("owned-project");
        Project foreign = new Project().setOwnerId(11L).setName("foreign-project");
        projectMapper.insert(owned);
        projectMapper.insert(foreign);
        Asset foreignAsset = new Asset()
                .setProjectId(foreign.getId())
                .setUserId(11L)
                .setType(Asset.TYPE_IMAGE)
                .setStorageKey("foreign/input.png")
                .setContentSha256("a".repeat(64))
                .setSource(Asset.SOURCE_UPLOADED)
                .setStatus(Asset.STATUS_NORMAL);
        assetMapper.insert(foreignAsset);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[" + foreignAsset.getId() + "]," +
                "\"parameters\":{\"prompt\":\"参考素材生成\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":1}";

        postGenerationJob(owned.getId(), "foreign-asset-key", body)
                .andExpect(status().isNotFound());

        assertThat(count("generation_jobs", "project_id", owned.getId())).isZero();
        assertThat(count("project_events", "project_id", owned.getId())).isZero();
    }

    @Test
    void clientSourceProviderFieldsAndMediaUrlsAreRejected() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("product-neutral-command");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"source\":\"agent_run\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{" +
                "\"prompt\":\"蓝鲸海报\"," +
                "\"aspect_ratio\":\"1:1\"," +
                "\"provider_task_id\":\"private-task\"," +
                "\"reference_url\":\"https://temporary.example.test/input.png\"}," +
                "\"expected_output_count\":1}";

        postGenerationJob(project.getId(), "unsupported-fields-key", body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(100002));

        assertThat(count("generation_jobs", "project_id", project.getId())).isZero();
        assertThat(count("project_events", "project_id", project.getId())).isZero();
    }

    @Test
    void commandRequiresAuthenticationAndProjectOwnership() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("owned-project");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":1}";

        mockMvc.perform(post("/api/projects/{id}/generation-jobs", project.getId())
                        .header("Idempotency-Key", "missing-user")
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/projects/{id}/generation-jobs", project.getId())
                        .header("X-User-Id", "11")
                        .header("Idempotency-Key", "wrong-user")
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isNotFound());

        mockMvc.perform(post("/api/projects/{id}/generation-jobs", project.getId())
                        .header("X-User-Id", "10")
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(400));

        assertThat(count("generation_jobs", "project_id", project.getId())).isZero();
        assertThat(count("project_events", "project_id", project.getId())).isZero();
    }

    @Test
    void reusedKeyWithDifferentRequestConflicts() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("idempotency-conflict");
        projectMapper.insert(project);
        String firstBody = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":1}";
        String changedBody = firstBody.replace("蓝鲸海报", "白鲸海报");

        postGenerationJob(project.getId(), "conflicting-key", firstBody)
                .andExpect(status().isAccepted());
        postGenerationJob(project.getId(), "conflicting-key", changedBody)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100302));

        assertThat(count("generation_jobs", "project_id", project.getId())).isEqualTo(1);
        assertThat(count("project_events", "project_id", project.getId())).isEqualTo(1);
        assertThat(count("outbox_messages", "project_id", project.getId())).isEqualTo(1);
    }

    @Test
    void concurrentRepeatedCommandCreatesOneJobEventAndOutbox() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("concurrent-idempotency");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"并发蓝鲸\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":1}";
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            CompletableFuture<MvcResult> first = postConcurrently(executor, start, project.getId(), body);
            CompletableFuture<MvcResult> second = postConcurrently(executor, start, project.getId(), body);
            start.countDown();

            JsonNode firstData = responseData(first.get(10, TimeUnit.SECONDS));
            JsonNode secondData = responseData(second.get(10, TimeUnit.SECONDS));
            assertThat(firstData).isEqualTo(secondData);
        } finally {
            executor.shutdownNow();
        }

        assertThat(count("generation_jobs", "project_id", project.getId())).isEqualTo(1);
        assertThat(count("project_events", "project_id", project.getId())).isEqualTo(1);
        assertThat(count("outbox_messages", "project_id", project.getId())).isEqualTo(1);
    }

    @Test
    void workerProducesOneAssetThatSnapshotCanRecover() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("bottom-dock-worker");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":1}";
        MvcResult accepted = postGenerationJob(project.getId(), "worker-key", body)
                .andExpect(status().isAccepted())
                .andReturn();
        long jobId = objectMapper.readTree(accepted.getResponse().getContentAsString())
                .path("data").path("generation_job_id").asLong();

        assertThat(generationWorker.runOnce("bottom-dock-worker-1")).isTrue();
        assertThat(generationWorker.runOnce("bottom-dock-worker-1")).isFalse();

        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("succeeded");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT agent_run_id FROM generation_jobs WHERE id = ?", Long.class, jobId))
                .isNull();
        assertThat(count("assets", "generation_job_id", jobId)).isEqualTo(1);
        assertThat(count("generation_job_outputs", "generation_job_id", jobId)).isEqualTo(1);
        assertThat(count("agent_runs", "project_id", project.getId())).isZero();

        Long fencingToken = jdbcTemplate.queryForObject(
                "SELECT fencing_token FROM generation_jobs WHERE id = ?", Long.class, jobId);
        Long assetId = jdbcTemplate.queryForObject(
                "SELECT asset_id FROM generation_job_outputs WHERE generation_job_id = ?", Long.class, jobId);
        String contentSha256 = jdbcTemplate.queryForObject(
                "SELECT content_sha256 FROM generation_job_outputs WHERE generation_job_id = ?", String.class, jobId);
        String storageKey = jdbcTemplate.queryForObject(
                "SELECT storage_key FROM assets WHERE id = ?", String.class, assetId);
        GenerationAcceptanceResult repeated = generationResultAcceptanceService.acceptSuccess(
                new GenerationResultCommand(jobId, 0, 0, fencingToken, "stale-worker",
                        "duplicate-delivery", storageKey, contentSha256, "image/png", 1));
        assertThat(repeated.status()).isEqualTo(GenerationAcceptanceResult.Status.IDEMPOTENT);
        assertThat(repeated.assetId()).isEqualTo(assetId);
        assertThat(count("assets", "generation_job_id", jobId)).isEqualTo(1);
        assertThat(count("generation_job_outputs", "generation_job_id", jobId)).isEqualTo(1);

        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_jobs[0].job_id").value(jobId))
                .andExpect(jsonPath("$.data.generation_jobs[0].source").value("bottom_dock"))
                .andExpect(jsonPath("$.data.generation_jobs[0].status").value("succeeded"))
                .andExpect(jsonPath("$.data.generation_jobs[0].outputs[0].asset_id").isNumber());
    }

    private CompletableFuture<MvcResult> postConcurrently(
            ExecutorService executor, CountDownLatch start, Long projectId, String body) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                assertThat(start.await(5, TimeUnit.SECONDS)).isTrue();
                return postGenerationJob(projectId, "concurrent-key", body)
                        .andExpect(status().isAccepted())
                        .andReturn();
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        }, executor);
    }

    private JsonNode responseData(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
    }

    private org.springframework.test.web.servlet.ResultActions postGenerationJob(
            Long projectId, String idempotencyKey, String body) throws Exception {
        return mockMvc.perform(post("/api/projects/{id}/generation-jobs", projectId)
                .header("X-User-Id", "10")
                .header("Idempotency-Key", idempotencyKey)
                .contentType("application/json")
                .content(body));
    }

    private long count(String table, String column, Long value) {
        Long result = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?", Long.class, value);
        return result == null ? 0 : result;
    }
}
