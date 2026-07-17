package com.blue.whale.agent;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.dto.GenerationAcceptanceResult;
import com.blue.whale.agent.model.dto.GenerationResultCommand;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
import com.blue.whale.agent.service.governance.CostControlProperties;
import com.blue.whale.agent.service.governance.GenerationCostAdmissionService;
import com.blue.whale.agent.service.governance.GovernanceException;
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
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.concurrent.CompletableFuture;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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
    @Autowired
    private CostControlProperties costControlProperties;
    @Autowired
    private GenerationCostAdmissionService costAdmissionService;

    @BeforeEach
    void cleanFacts() {
        costControlProperties.setImageReservationFen(25L);
        storage.clear();
        jdbcTemplate.batchUpdate(
                "DELETE FROM audit_records",
                "DELETE FROM cost_reservations",
                "DELETE FROM cost_budget_locks",
                "DELETE FROM user_input_requests",
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
    void costlyBottomDockActionCanBeConfirmedAndResubmittedWithBoundInputRequest() throws Exception {
        costControlProperties.setImageReservationFen(75L);
        Project project = new Project().setOwnerId(10L).setName("standalone-confirmation");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"四张蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":4}";

        MvcResult pending = postGenerationJob(project.getId(), "standalone-confirm", body)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.data.code").value("INPUT_REQUIRED"))
                .andExpect(jsonPath("$.data.input_request_id").isNumber())
                .andReturn();
        long inputRequestId = responseData(pending).path("input_request_id").asLong();
        assertThat(count("generation_jobs", "project_id", project.getId())).isZero();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM user_input_requests WHERE id = ?", String.class, inputRequestId))
                .isEqualTo("pending");

        mockMvc.perform(post("/api/projects/{projectId}/input-requests/{requestId}/confirm",
                        project.getId(), inputRequestId)
                        .header("X-User-Id", "10")
                        .contentType("application/json")
                        .content("{\"content\":\"确认继续执行\"}"))
                .andExpect(status().isOk());

        MvcResult accepted = mockMvc.perform(post(
                        "/api/projects/{id}/generation-jobs", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "standalone-confirm")
                        .header("X-Input-Request-Id", inputRequestId)
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isAccepted())
                .andReturn();
        long jobId = responseData(accepted).path("generation_job_id").asLong();

        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM user_input_requests WHERE id = ?", String.class, inputRequestId))
                .isEqualTo("consumed");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT reserved_amount_fen FROM cost_reservations WHERE generation_job_id = ?",
                Long.class, jobId)).isEqualTo(300L);
        assertThat(jdbcTemplate.queryForList(
                "SELECT action FROM audit_records WHERE target_id = ? ORDER BY id",
                String.class, String.valueOf(inputRequestId)))
                .containsExactly("user_input_request.confirm", "user_input_request.consume");
    }

    @Test
    void repeatedInputRequiredCommandReusesOnePendingRequest() throws Exception {
        costControlProperties.setImageReservationFen(250L);
        Project project = new Project().setOwnerId(10L).setName("input-required-idempotency");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":1}";

        MvcResult first = postGenerationJob(project.getId(), "pending-idempotency", body)
                .andExpect(status().isConflict())
                .andReturn();
        MvcResult repeated = postGenerationJob(project.getId(), "pending-idempotency", body)
                .andExpect(status().isConflict())
                .andReturn();

        assertThat(responseData(repeated).path("input_request_id").asLong())
                .isEqualTo(responseData(first).path("input_request_id").asLong());
        assertThat(count("user_input_requests", "project_id", project.getId())).isEqualTo(1);
    }

    @Test
    void confirmedStandaloneRequestCannotMoveToAnotherIdempotencyKey() throws Exception {
        costControlProperties.setImageReservationFen(250L);
        Project project = new Project().setOwnerId(10L).setName("confirmation-command-binding");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":1}";

        MvcResult pending = postGenerationJob(project.getId(), "bound-key-a", body)
                .andExpect(status().isConflict())
                .andReturn();
        long inputRequestId = responseData(pending).path("input_request_id").asLong();
        mockMvc.perform(post("/api/projects/{projectId}/input-requests/{requestId}/confirm",
                        project.getId(), inputRequestId)
                        .header("X-User-Id", "10")
                        .contentType("application/json")
                        .content("{\"content\":\"确认继续执行\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/projects/{id}/generation-jobs", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "bound-key-b")
                        .header("X-Input-Request-Id", inputRequestId)
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.data.code").value("ACTION_NOT_ALLOWED"));
        assertThat(count("generation_jobs", "project_id", project.getId())).isZero();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM user_input_requests WHERE id = ?", String.class,
                inputRequestId)).isEqualTo("confirmed");

        mockMvc.perform(post("/api/projects/{id}/generation-jobs", project.getId())
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "bound-key-a")
                        .header("X-Input-Request-Id", inputRequestId)
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isAccepted());
        assertThat(count("generation_jobs", "project_id", project.getId())).isEqualTo(1);
    }

    @Test
    void legacyContinuationUsesTheIdentityStoredByItsInputRequest() throws Exception {
        costControlProperties.setImageReservationFen(250L);
        Project project = new Project().setOwnerId(10L).setName("legacy-confirmation-continuation");
        projectMapper.insert(project);
        Map<String, Object> arguments = Map.of(
                "prompt", "蓝鲸海报",
                "expected_output_count", 1,
                "_cost_provider", "volcengine");

        GovernanceException pending = org.assertj.core.api.Assertions.catchThrowableOfType(
                () -> costAdmissionService.authorizeRequest(
                        10L, project.getId(), "LegacyGenerationRequest", "legacy-action",
                        "legacy-action", "generate_image", arguments, false, null),
                GovernanceException.class);
        assertThat(pending.publicCode()).isEqualTo("INPUT_REQUIRED");

        mockMvc.perform(post("/api/projects/{projectId}/input-requests/{requestId}/confirm",
                        project.getId(), pending.getInputRequestId())
                        .header("X-User-Id", "10")
                        .contentType("application/json")
                        .content("{\"content\":\"确认继续执行\"}"))
                .andExpect(status().isOk());

        var authorized = costAdmissionService.authorizeRequest(
                10L, project.getId(), "LegacyGenerationRequest", null,
                null, "generate_image", arguments, false, pending.getInputRequestId());
        assertThat(authorized.actionIdentity()).isEqualTo("legacy-action");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM user_input_requests WHERE id = ?", String.class,
                pending.getInputRequestId())).isEqualTo("consumed");
    }

    @Test
    void legacyJobStatusAndStreamRequireTheOwningUser() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("legacy-job-owner");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":1}";
        long jobId = responseData(postGenerationJob(project.getId(), "owner-check", body)
                .andExpect(status().isAccepted()).andReturn()).path("generation_job_id").asLong();

        mockMvc.perform(get("/api/jobs/{id}", jobId)).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/jobs/{id}", jobId).header("X-User-Id", "11"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/jobs/{id}/stream", jobId).header("X-User-Id", "11"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/jobs/{id}", jobId).header("X-User-Id", "10"))
                .andExpect(status().isOk());
    }

    @Test
    void paidProviderCallRequiresReservationAndSettlesAcceptedResult() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("cost-controlled-image");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"有成本边界的蓝鲸\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":1}";

        long jobId = responseData(postGenerationJob(project.getId(), "cost-controlled-image", body)
                .andExpect(status().isAccepted()).andReturn()).path("generation_job_id").asLong();

        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM cost_reservations WHERE generation_job_id = ?", String.class, jobId))
                .isEqualTo("ACTIVE");
        assertThat(generationWorker.runOnce("cost-worker")).isTrue();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM cost_reservations WHERE generation_job_id = ?", String.class, jobId))
                .isEqualTo("SETTLED");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT actual_amount_fen FROM cost_reservations WHERE generation_job_id = ?", Long.class, jobId))
                .isEqualTo(25L);
        assertThat(jdbcTemplate.queryForList(
                "SELECT action FROM audit_records WHERE correlation_id = ? ORDER BY id",
                String.class, "generation-job:" + jobId))
                .containsExactly(
                        "cost_reservation.create",
                        "cost_reservation.provider_admission",
                        "generation_provider.call_outcome",
                        "cost_reservation.settle");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM audit_records WHERE action = 'generation_action.authorize' " +
                        "AND request_id = (SELECT action_identity FROM generation_jobs WHERE id = ?)",
                Long.class, jobId)).isEqualTo(1L);
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
    void projectIdentityRolloutAllowsHistoricalRunScopedDuplicatesAndProtectsNewRows() {
        Project project = new Project().setOwnerId(10L).setName("action-identity-rollout");
        projectMapper.insert(project);
        String insert = "INSERT INTO generation_jobs "
                + "(project_id, user_id, agent_run_id, action_identity, project_action_identity, "
                + "type, source, status) VALUES (?, 10, ?, 'action-1', ?, 'image', 'agent_run', 'queued')";

        jdbcTemplate.update(insert, project.getId(), 101L, null);
        jdbcTemplate.update(insert, project.getId(), 102L, null);
        jdbcTemplate.update(insert, project.getId(), 103L, "action-1");

        assertThatThrownBy(() -> jdbcTemplate.update(
                insert, project.getId(), 104L, "action-1"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void videoCommandFreezesServerStrategyAndReservesOneOutputSlot() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("bottom-dock-video");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"video\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{" +
                "\"prompt\":\"蓝鲸跃出海面\"," +
                "\"aspect_ratio\":\"16:9\"," +
                "\"resolution\":\"480p\"," +
                "\"duration\":4}," +
                "\"expected_output_count\":1}";

        MvcResult accepted = postGenerationJob(project.getId(), "video-key-1", body)
                .andExpect(status().isAccepted())
                .andReturn();
        long jobId = objectMapper.readTree(accepted.getResponse().getContentAsString())
                .path("data").path("generation_job_id").asLong();

        assertThat(jdbcTemplate.queryForObject(
                "SELECT type FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("video");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT source FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("bottom_dock");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT strategy_version FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("seedance-2.0-v1");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT TIMESTAMPDIFF(MINUTE, CURRENT_TIMESTAMP, execution_deadline_at) " +
                        "FROM generation_jobs WHERE id = ?", Integer.class, jobId))
                .isBetween(29, 30);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT progress FROM generation_jobs WHERE id = ?", Integer.class, jobId))
                .isNull();
        assertThat(count("generation_job_outputs", "generation_job_id", jobId)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT input FROM generation_jobs WHERE id = ?", String.class, jobId))
                .contains("\"resolution\":\"480p\"")
                .contains("\"duration\":4")
                .doesNotContain("provider")
                .doesNotContain("model")
                .doesNotContain("callback")
                .doesNotContain("url");
    }

    @Test
    void imageAndVideoCommandsReserveEveryExpectedOutputSlot() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("bottom-dock-multi-output");
        projectMapper.insert(project);
        String imageBody = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"四张蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":4}";
        String videoBody = "{" +
                "\"type\":\"video\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{" +
                "\"prompt\":\"四段蓝鲸视频\"," +
                "\"aspect_ratio\":\"16:9\"," +
                "\"resolution\":\"480p\"," +
                "\"duration\":4}," +
                "\"expected_output_count\":4}";

        long imageJobId = responseData(postGenerationJob(project.getId(), "multi-image", imageBody)
                .andExpect(status().isAccepted()).andReturn()).path("generation_job_id").asLong();
        long videoJobId = responseData(postGenerationJob(project.getId(), "multi-video", videoBody)
                .andExpect(status().isAccepted()).andReturn()).path("generation_job_id").asLong();

        assertThat(jdbcTemplate.queryForObject(
                "SELECT expected_output_count FROM generation_jobs WHERE id = ?",
                Integer.class, imageJobId)).isEqualTo(4);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT expected_output_count FROM generation_jobs WHERE id = ?",
                Integer.class, videoJobId)).isEqualTo(4);
        assertThat(jdbcTemplate.queryForList(
                "SELECT slot_index FROM generation_job_outputs " +
                        "WHERE generation_job_id = ? ORDER BY slot_index", Integer.class, imageJobId))
                .containsExactly(0, 1, 2, 3);
        assertThat(jdbcTemplate.queryForList(
                "SELECT status FROM generation_job_outputs " +
                        "WHERE generation_job_id = ? ORDER BY slot_index", String.class, videoJobId))
                .containsExactly("pending", "pending", "pending", "pending");
    }

    @Test
    void cancellingQueuedMultiOutputImageCancelsEveryUnsubmittedSlotIdempotently() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("queued-image-cancel");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"三张蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":3}";
        long jobId = responseData(postGenerationJob(project.getId(), "queued-image-cancel", body)
                .andExpect(status().isAccepted()).andReturn()).path("generation_job_id").asLong();

        cancel(project.getId(), jobId).andExpect(status().isAccepted());
        long eventCountAfterFirstCancel = count("project_events", "project_id", project.getId());
        cancel(project.getId(), jobId).andExpect(status().isAccepted());

        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("cancelled");
        assertThat(jdbcTemplate.queryForList(
                "SELECT status FROM generation_job_outputs WHERE generation_job_id = ? " +
                        "ORDER BY slot_index", String.class, jobId))
                .containsExactly("cancelled", "cancelled", "cancelled");
        assertThat(count("project_events", "project_id", project.getId()))
                .isEqualTo(eventCountAfterFirstCancel);
        assertThat(generationWorker.runOnce("queued-image-cancel-worker")).isFalse();

        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_jobs[0].status").value("cancelled"))
                .andExpect(jsonPath("$.data.generation_jobs[0].outputs[0].status").value("cancelled"))
                .andExpect(jsonPath("$.data.generation_jobs[0].outputs[1].status").value("cancelled"))
                .andExpect(jsonPath("$.data.generation_jobs[0].outputs[2].status").value("cancelled"));
    }

    @Test
    void snapshotDoesNotExposeLegacyImageRootCause() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("snapshot-error-redaction");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":1}";
        MvcResult accepted = postGenerationJob(project.getId(), "snapshot-error-key", body)
                .andExpect(status().isAccepted())
                .andReturn();
        long jobId = objectMapper.readTree(accepted.getResponse().getContentAsString())
                .path("data").path("generation_job_id").asLong();
        jdbcTemplate.update("UPDATE generation_jobs SET status = 'failed', " +
                "error = '{\"code\":500,\"message\":\"jdbc://private-host/root-password\"}' " +
                "WHERE id = ?", jobId);

        MvcResult snapshot = mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andReturn();

        assertThat(snapshot.getResponse().getContentAsString())
                .doesNotContain("private-host")
                .doesNotContain("root-password");
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

    @Test
    void retryCreatesOneIdempotentJobForFailedSlotsWithoutChangingOriginalFacts() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("missing-output-retry");
        projectMapper.insert(project);
        String body = "{" +
                "\"type\":\"image\"," +
                "\"input_asset_ids\":[]," +
                "\"parameters\":{\"prompt\":\"四张蓝鲸海报\",\"aspect_ratio\":\"1:1\"}," +
                "\"expected_output_count\":4}";
        long originalJobId = responseData(postGenerationJob(project.getId(), "retry-original", body)
                .andExpect(status().isAccepted()).andReturn()).path("generation_job_id").asLong();

        Asset first = generatedAsset(project.getId(), originalJobId, "retry/original-0.png", "a");
        Asset third = generatedAsset(project.getId(), originalJobId, "retry/original-2.png", "c");
        jdbcTemplate.update("UPDATE generation_job_outputs SET status = 'succeeded', asset_id = ?, " +
                        "content_sha256 = ?, delivery_id = 'original-0' WHERE generation_job_id = ? AND slot_index = 0",
                first.getId(), first.getContentSha256(), originalJobId);
        jdbcTemplate.update("UPDATE generation_job_outputs SET status = 'failed', " +
                        "error = '{\"code\":\"provider_failed\",\"message\":\"slot 1 failed\"}' " +
                        "WHERE generation_job_id = ? AND slot_index = 1", originalJobId);
        jdbcTemplate.update("UPDATE generation_job_outputs SET status = 'succeeded', asset_id = ?, " +
                        "content_sha256 = ?, delivery_id = 'original-2' WHERE generation_job_id = ? AND slot_index = 2",
                third.getId(), third.getContentSha256(), originalJobId);
        jdbcTemplate.update("UPDATE generation_job_outputs SET status = 'failed', " +
                        "error = '{\"code\":\"provider_failed\",\"message\":\"slot 3 failed\"}' " +
                        "WHERE generation_job_id = ? AND slot_index = 3", originalJobId);
        jdbcTemplate.update("UPDATE generation_jobs SET status = 'partially_succeeded', progress = 100, " +
                "output_asset_ids = ? WHERE id = ?", "[" + first.getId() + "," + third.getId() + "]", originalJobId);

        MvcResult firstRetry = postRetry(project.getId(), originalJobId, "missing-retry-key")
                .andExpect(status().isAccepted())
                .andReturn();
        MvcResult repeatedRetry = postRetry(project.getId(), originalJobId, "missing-retry-key")
                .andExpect(status().isAccepted())
                .andReturn();
        assertThat(responseData(repeatedRetry)).isEqualTo(responseData(firstRetry));
        long retryJobId = responseData(firstRetry).path("generation_job_id").asLong();

        assertThat(retryJobId).isNotEqualTo(originalJobId);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT retry_of_job_id FROM generation_jobs WHERE id = ?", Long.class, retryJobId))
                .isEqualTo(originalJobId);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT expected_output_count FROM generation_jobs WHERE id = ?", Integer.class, retryJobId))
                .isEqualTo(2);
        assertThat(jdbcTemplate.queryForList(
                "SELECT slot_index FROM generation_job_outputs WHERE generation_job_id = ? ORDER BY slot_index",
                Integer.class, retryJobId)).containsExactly(1, 3);
        assertThat(jdbcTemplate.queryForList(
                "SELECT status FROM generation_job_outputs WHERE generation_job_id = ? ORDER BY slot_index",
                String.class, originalJobId))
                .containsExactly("succeeded", "failed", "succeeded", "failed");
        assertThat(count("assets", "generation_job_id", originalJobId)).isEqualTo(2);
        assertThat(count("generation_jobs", "project_id", project.getId())).isEqualTo(2);
        mockMvc.perform(get("/api/projects/{projectId}/generation-jobs/{jobId}",
                        project.getId(), retryJobId)
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.job_id").value(retryJobId))
                .andExpect(jsonPath("$.data.expected_output_count").value(2))
                .andExpect(jsonPath("$.data.retry_of_job_id").value(originalJobId))
                .andExpect(jsonPath("$.data.outputs[0].slot_index").value(1))
                .andExpect(jsonPath("$.data.outputs[0].status").value("pending"))
                .andExpect(jsonPath("$.data.outputs[1].slot_index").value(3));
        mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_jobs[0].job_id").value(retryJobId))
                .andExpect(jsonPath("$.data.generation_jobs[0].expected_output_count").value(2))
                .andExpect(jsonPath("$.data.generation_jobs[0].retry_of_job_id").value(originalJobId))
                .andExpect(jsonPath("$.data.generation_jobs[1].outputs[1].status").value("failed"))
                .andExpect(jsonPath("$.data.generation_jobs[1].outputs[1].error.code")
                        .value("provider_failed"));
        assertThat(jdbcTemplate.queryForObject(
                "SELECT payload FROM project_events WHERE aggregate_id = ? AND event_type = 'generation_job.created'",
                String.class, String.valueOf(retryJobId)))
                .contains("\"retry_of_job_id\":" + originalJobId)
                .contains("\"slot_index\":1")
                .contains("\"status\":\"pending\"");

        String secondBody = body.replace("四张蓝鲸海报", "另一组蓝鲸海报").replace(":4}", ":1}");
        long otherJobId = responseData(postGenerationJob(project.getId(), "retry-other", secondBody)
                .andExpect(status().isAccepted()).andReturn()).path("generation_job_id").asLong();
        jdbcTemplate.update("UPDATE generation_job_outputs SET status = 'failed', " +
                        "error = '{\"code\":\"provider_failed\",\"message\":\"failed\"}' " +
                        "WHERE generation_job_id = ?", otherJobId);
        jdbcTemplate.update("UPDATE generation_jobs SET status = 'failed', progress = 100 WHERE id = ?", otherJobId);
        postRetry(project.getId(), otherJobId, "missing-retry-key")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(100302));
    }

    private Asset generatedAsset(
            Long projectId,
            Long jobId,
            String storageKey,
            String digestCharacter) {
        Asset asset = new Asset()
                .setProjectId(projectId)
                .setUserId(10L)
                .setGenerationJobId(jobId)
                .setType(Asset.TYPE_IMAGE)
                .setStorageKey(storageKey)
                .setContentSha256(digestCharacter.repeat(64))
                .setMime("image/png")
                .setSize(1L)
                .setSource(Asset.SOURCE_GENERATED)
                .setStatus(Asset.STATUS_NORMAL);
        assetMapper.insert(asset);
        return asset;
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

    private org.springframework.test.web.servlet.ResultActions postRetry(
            Long projectId, Long jobId, String idempotencyKey) throws Exception {
        return mockMvc.perform(post("/api/projects/{projectId}/generation-jobs/{jobId}/retry",
                        projectId, jobId)
                .header("X-User-Id", "10")
                .header("Idempotency-Key", idempotencyKey));
    }

    private org.springframework.test.web.servlet.ResultActions cancel(Long projectId, Long jobId)
            throws Exception {
        return mockMvc.perform(post(
                        "/api/projects/{projectId}/generation-jobs/{jobId}/cancel",
                        projectId, jobId)
                .header("X-User-Id", "10"));
    }

    private long count(String table, String column, Long value) {
        Long result = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?", Long.class, value);
        return result == null ? 0 : result;
    }
}
