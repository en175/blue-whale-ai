package com.blue.whale.agent;

import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.model.dto.GenerationJobClaim;
import com.blue.whale.agent.service.GenerationJobClaimService;
import com.blue.whale.agent.service.SeedanceProviderTaskService;
import com.blue.whale.agent.service.generation.GenerationWorker;
import com.blue.whale.agent.service.generation.ProviderObservation;
import com.blue.whale.agent.support.FakeAsyncGenerationProvider;
import com.blue.whale.agent.support.FakeGenerationConfiguration;
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

import java.net.URI;
import java.util.concurrent.CompletableFuture;
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
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.generation.seedance.callback-base-url=https://callback.example.test",
        "blue-whale.generation.worker-scheduled=false"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(FakeGenerationConfiguration.class)
class SeedanceVideoGenerationIT {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private GenerationWorker generationWorker;
    @Autowired
    private GenerationJobClaimService claimService;
    @Autowired
    private SeedanceProviderTaskService taskService;
    @Autowired
    private FakeAsyncGenerationProvider provider;

    @BeforeEach
    void cleanFacts() {
        provider.reset();
        jdbcTemplate.batchUpdate(
                "DELETE FROM seedance_callback_security_audits",
                "DELETE FROM seedance_callback_inbox",
                "DELETE FROM generation_provider_tasks",
                "DELETE FROM generation_result_conflicts",
                "DELETE FROM generation_job_outputs",
                "DELETE FROM assets",
                "DELETE FROM command_idempotency",
                "DELETE FROM generation_jobs",
                "DELETE FROM outbox_messages",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project");
    }

    @Test
    void callbackWakesServerVerificationAndOneVideoAssetIsAccepted() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("seedance-success");
        projectMapper.insert(project);
        long jobId = createVideoJob(project.getId(), "seedance-success-key");

        assertThat(generationWorker.runOnce("video-worker-1")).isTrue();
        assertThat(provider.submissionCount()).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("processing");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT callback_capability_digest FROM generation_provider_tasks " +
                        "WHERE generation_job_id = ?", String.class, jobId))
                .matches("[0-9a-f]{64}");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT provider_task_id FROM generation_provider_tasks " +
                        "WHERE generation_job_id = ?", String.class, jobId))
                .isEqualTo(provider.taskId());

        provider.succeed();
        String callbackBody = "{" +
                "\"id\":\"" + provider.taskId() + "\"," +
                "\"status\":\"succeeded\"," +
                "\"content\":{\"video_url\":\"https://provider.invalid/temp.mp4\"}," +
                "\"duration\":4}";
        mockMvc.perform(post(URI.create(provider.callbackUrl().replaceFirst(
                                "capability=[^&]+", "capability=wrong")))
                        .contentType("application/json")
                        .content(callbackBody))
                .andExpect(status().isNoContent());
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM seedance_callback_security_audits WHERE generation_job_id = ?",
                Long.class, jobId)).isEqualTo(1L);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM seedance_callback_inbox WHERE generation_job_id = ?",
                Long.class, jobId)).isZero();
        mockMvc.perform(post(URI.create(provider.callbackUrl()))
                        .contentType("application/json")
                        .content(callbackBody))
                .andExpect(status().isAccepted());
        mockMvc.perform(post(URI.create(provider.callbackUrl()))
                        .contentType("application/json")
                        .content(callbackBody))
                .andExpect(status().isAccepted());

        assertThat(generationWorker.runOnce("video-worker-2")).isTrue();
        assertThat(provider.observationCount()).isEqualTo(1);
        assertThat(provider.submissionCount()).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("succeeded");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT type FROM assets WHERE generation_job_id = ?", String.class, jobId))
                .isEqualTo("video");
        Long assetId = jdbcTemplate.queryForObject(
                "SELECT id FROM assets WHERE generation_job_id = ?", Long.class, jobId);
        assertThat(count("generation_job_outputs", "generation_job_id", jobId)).isEqualTo(1);
        assertThat(count("assets", "generation_job_id", jobId)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM seedance_callback_inbox WHERE generation_job_id = ?",
                Long.class, jobId)).isEqualTo(1L);

        MvcResult snapshot = mockMvc.perform(get("/api/projects/{id}/snapshot", project.getId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generation_jobs[0].type").value("video"))
                .andExpect(jsonPath("$.data.generation_jobs[0].status").value("succeeded"))
                .andExpect(jsonPath("$.data.generation_jobs[0].outputs[0].asset_id").isNumber())
                .andExpect(jsonPath("$.data.assets.*.access_url").value(
                        org.hamcrest.Matchers.hasItem(
                                "/api/projects/" + project.getId() + "/assets/" + assetId)))
                .andReturn();
        String publicSnapshot = snapshot.getResponse().getContentAsString();
        assertThat(publicSnapshot)
                .doesNotContain(provider.taskId())
                .doesNotContain("provider.invalid")
                .doesNotContain("callback_capability")
                .doesNotContain("raw_error");
    }

    @Test
    void cancellationBeforeAndAfterProviderSubmissionAreIdempotent() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("seedance-cancel");
        projectMapper.insert(project);

        long localJobId = createVideoJob(project.getId(), "seedance-local-cancel");
        cancel(project.getId(), localJobId);
        cancel(project.getId(), localJobId);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, localJobId))
                .isEqualTo("cancelled");
        assertThat(provider.submissionCount()).isZero();

        long providerJobId = createVideoJob(project.getId(), "seedance-provider-cancel");
        assertThat(generationWorker.runOnce("video-worker-cancel-submit")).isTrue();
        cancel(project.getId(), providerJobId);
        assertThat(generationWorker.runOnce("video-worker-cancel-confirm")).isTrue();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, providerJobId))
                .isEqualTo("cancelled");
        assertThat(provider.submissionCount()).isEqualTo(1);
        assertThat(provider.cancellationCount()).isEqualTo(1);
    }

    @Test
    void ambiguousSubmissionIsNeverBlindlyResubmitted() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("seedance-ambiguous");
        projectMapper.insert(project);
        long jobId = createVideoJob(project.getId(), "seedance-ambiguous-key");
        provider.submitAmbiguously();

        assertThat(generationWorker.runOnce("video-worker-ambiguous-submit")).isTrue();
        assertThat(provider.submissionCount()).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT submission_state FROM generation_provider_tasks WHERE generation_job_id = ?",
                String.class, jobId)).isEqualTo("unknown");

        jdbcTemplate.update("UPDATE generation_jobs SET execution_deadline_at = " +
                "DATEADD('SECOND', -1, CURRENT_TIMESTAMP), next_action_at = CURRENT_TIMESTAMP " +
                "WHERE id = ?", jobId);
        assertThat(generationWorker.runOnce("video-worker-ambiguous-deadline")).isTrue();
        assertThat(provider.submissionCount()).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("failed");
        assertThat(generationWorker.runOnce("video-worker-ambiguous-after")).isFalse();
    }

    @Test
    void lateSuccessOnlyUpdatesEvidenceDuringReconciliationWindow() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("seedance-late-success");
        projectMapper.insert(project);
        long jobId = createVideoJob(project.getId(), "seedance-late-success-key");

        assertThat(generationWorker.runOnce("video-worker-late-submit")).isTrue();
        jdbcTemplate.update("UPDATE generation_jobs SET execution_deadline_at = " +
                "DATEADD('SECOND', -1, CURRENT_TIMESTAMP), next_action_at = CURRENT_TIMESTAMP " +
                "WHERE id = ?", jobId);

        assertThat(generationWorker.runOnce("video-worker-deadline")).isTrue();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("failed");
        assertThat(provider.cancellationCount()).isEqualTo(1);

        provider.succeed();
        jdbcTemplate.update("UPDATE generation_jobs SET next_action_at = CURRENT_TIMESTAMP WHERE id = ?", jobId);
        assertThat(generationWorker.runOnce("video-worker-evidence-reconcile")).isTrue();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("failed");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT provider_status FROM generation_provider_tasks WHERE generation_job_id = ?",
                String.class, jobId)).isEqualTo("succeeded");
        assertThat(count("assets", "generation_job_id", jobId)).isZero();

        jdbcTemplate.update("UPDATE generation_jobs SET evidence_reconcile_until = " +
                "DATEADD('SECOND', -1, CURRENT_TIMESTAMP), next_action_at = CURRENT_TIMESTAMP " +
                "WHERE id = ?", jobId);
        assertThat(generationWorker.runOnce("video-worker-after-reconcile-window")).isFalse();
    }

    @Test
    void successObservedWhileConfirmingDeadlineCancellationWinsOverTimeout() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("seedance-deadline-race");
        projectMapper.insert(project);
        long jobId = createVideoJob(project.getId(), "seedance-deadline-race-key");

        assertThat(generationWorker.runOnce("video-worker-race-submit")).isTrue();
        provider.succeedOnCancelConfirmation();
        jdbcTemplate.update("UPDATE generation_jobs SET execution_deadline_at = " +
                "DATEADD('SECOND', -1, CURRENT_TIMESTAMP), next_action_at = CURRENT_TIMESTAMP " +
                "WHERE id = ?", jobId);

        assertThat(generationWorker.runOnce("video-worker-race-confirm")).isTrue();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("succeeded");
        assertThat(count("assets", "generation_job_id", jobId)).isEqualTo(1);
    }

    @Test
    void cancellationDuringSubmissionKeepsKnownProviderTaskForCancellation() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("seedance-submit-cancel-race");
        projectMapper.insert(project);
        long jobId = createVideoJob(project.getId(), "seedance-submit-cancel-race-key");
        provider.blockSubmission();

        CompletableFuture<Boolean> submitted = CompletableFuture.supplyAsync(
                () -> generationWorker.runOnce("video-worker-blocked-submit"));
        assertThat(provider.awaitSubmissionStarted()).isTrue();
        cancel(project.getId(), jobId);
        provider.releaseSubmission();
        assertThat(submitted.get(5, TimeUnit.SECONDS)).isTrue();

        assertThat(jdbcTemplate.queryForObject(
                "SELECT provider_task_id FROM generation_provider_tasks WHERE generation_job_id = ?",
                String.class, jobId)).isEqualTo(provider.taskId());
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("cancel_requested");
        assertThat(generationWorker.runOnce("video-worker-submit-cancel-confirm")).isTrue();
        assertThat(provider.cancellationCount()).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("cancelled");
    }

    @Test
    void cancellationWinsWhenConcurrentSubmissionIsDefinitelyRejected() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("seedance-rejected-submit-cancel");
        projectMapper.insert(project);
        long jobId = createVideoJob(project.getId(), "seedance-rejected-submit-cancel-key");
        provider.blockSubmission();
        provider.rejectSubmission();

        CompletableFuture<Boolean> submitted = CompletableFuture.supplyAsync(
                () -> generationWorker.runOnce("video-worker-rejected-submit"));
        assertThat(provider.awaitSubmissionStarted()).isTrue();
        cancel(project.getId(), jobId);
        provider.releaseSubmission();
        assertThat(submitted.get(5, TimeUnit.SECONDS)).isTrue();

        assertThat(jdbcTemplate.queryForObject(
                "SELECT submission_state FROM generation_provider_tasks WHERE generation_job_id = ?",
                String.class, jobId)).isEqualTo("failed");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT provider_task_id FROM generation_provider_tasks WHERE generation_job_id = ?",
                String.class, jobId)).isNull();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_jobs WHERE id = ?", String.class, jobId))
                .isEqualTo("cancelled");
    }

    @Test
    void expiredWorkerCannotOverwriteNewerProviderObservation() throws Exception {
        Project project = new Project().setOwnerId(10L).setName("seedance-observation-fence");
        projectMapper.insert(project);
        long jobId = createVideoJob(project.getId(), "seedance-observation-fence-key");
        assertThat(generationWorker.runOnce("video-worker-fence-submit")).isTrue();

        jdbcTemplate.update("UPDATE generation_jobs SET next_action_at = CURRENT_TIMESTAMP WHERE id = ?", jobId);
        GenerationJobClaim expiredClaim = claimService.claim("video-worker-expired");
        jdbcTemplate.update("UPDATE generation_jobs SET lease_expires_at = " +
                "DATEADD('SECOND', -1, CURRENT_TIMESTAMP), next_action_at = CURRENT_TIMESTAMP " +
                "WHERE id = ?", jobId);
        GenerationJobClaim currentClaim = claimService.claim("video-worker-current");
        taskService.recordObservation(currentClaim, new ProviderObservation(
                ProviderObservation.Status.SUCCEEDED, "https://provider.invalid/current.mp4", 4,
                null, null, "succeeded", null, null));

        assertThatThrownBy(() -> taskService.recordObservation(expiredClaim, new ProviderObservation(
                ProviderObservation.Status.RUNNING, null, null,
                null, null, "running", null, null)))
                .isInstanceOf(com.blue.whale.global.exception.GlobalException.class);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT provider_status FROM generation_provider_tasks WHERE generation_job_id = ?",
                String.class, jobId)).isEqualTo("succeeded");
    }

    private long createVideoJob(Long projectId, String idempotencyKey) throws Exception {
        MvcResult accepted = mockMvc.perform(post("/api/projects/{id}/generation-jobs", projectId)
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType("application/json")
                        .content("{" +
                                "\"type\":\"video\"," +
                                "\"input_asset_ids\":[]," +
                                "\"parameters\":{" +
                                "\"prompt\":\"蓝鲸跃出海面\"," +
                                "\"aspect_ratio\":\"16:9\"," +
                                "\"resolution\":\"480p\"," +
                                "\"duration\":4}," +
                                "\"expected_output_count\":1}"))
                .andExpect(status().isAccepted())
                .andReturn();
        JsonNode data = objectMapper.readTree(accepted.getResponse().getContentAsString()).path("data");
        return data.path("generation_job_id").asLong();
    }

    private void cancel(Long projectId, Long jobId) throws Exception {
        mockMvc.perform(post("/api/projects/{projectId}/generation-jobs/{jobId}/cancel",
                        projectId, jobId)
                        .header("X-User-Id", "10"))
                .andExpect(status().isAccepted());
    }

    private long count(String table, String column, Long value) {
        Long result = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?", Long.class, value);
        return result == null ? 0 : result;
    }
}
