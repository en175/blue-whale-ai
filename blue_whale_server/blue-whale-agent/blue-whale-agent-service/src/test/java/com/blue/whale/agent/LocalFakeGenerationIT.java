package com.blue.whale.agent;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.dto.GenerationResultCommand;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
import com.blue.whale.agent.service.generation.GenerationObjectReader;
import com.blue.whale.agent.service.generation.GenerationWorker;
import com.blue.whale.agent.service.generation.LocalFakeGenerationStorage;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * IK1NRZ 本地 Fake 生成纵向闭环：agent_run 图片 Job 经生产装配的 Fake Provider、
 * 成本预留准入、审计、规范化 ContentReview 与单 Asset 接纳推进到 succeeded；
 * 审核拒绝 / 无效证据 / 审核不可用一律 fail closed（不创建 Asset / Card / NodeItem）。
 *
 * <p>与 {@code GenerationWorkerIT} 的区别：不导入测试支持代码，全部走
 * {@code blue-whale.generation.mode=fake} 的生产 bean 装配。
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
        "blue-whale.generation.mode=fake",
        "blue-whale.generation.fake-allowed=true"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class LocalFakeGenerationIT {

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
    private GenerationObjectReader objectReader;
    @Autowired
    private LocalFakeGenerationStorage fakeStorage;
    @Autowired
    private GenerationResultAcceptanceService acceptanceService;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void cleanFacts() {
        fakeStorage.clear();
        jdbcTemplate.batchUpdate(
                "DELETE FROM content_reviews",
                "DELETE FROM audit_records",
                "DELETE FROM cost_reservations",
                "DELETE FROM asset_object_transfers",
                "DELETE FROM asset_storage_objects",
                "DELETE FROM generation_provider_tasks",
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
    void agentRunImageJobCompletesThroughReviewedFakeProvider() throws Exception {
        Long jobId = createJobThroughAgentRun("蓝鲸海报");

        assertThat(generationWorker.runOnce("generation-worker-1")).isTrue();
        assertThat(generationWorker.runOnce("generation-worker-1")).isFalse();

        // Job 终态：queued → processing → succeeded，单槽位单 Asset
        GenerationJob job = generationJobMapper.selectById(jobId);
        assertThat(job.getStatus()).isEqualTo(GenerationJob.STATUS_SUCCEEDED);
        assertThat(job.getOutputAssetIds()).hasSize(1);
        Long assetId = job.getOutputAssetIds().get(0);
        assertThat(count("generation_job_outputs", "generation_job_id", jobId)).isEqualTo(1);
        assertThat(count("assets", "generation_job_id", jobId)).isEqualTo(1);
        String contentSha = jdbcTemplate.queryForObject(
                "SELECT content_sha256 FROM assets WHERE id = ?", String.class, assetId);
        assertThat(contentSha).matches("[0-9a-f]{64}");
        String storageKey = jdbcTemplate.queryForObject(
                "SELECT storage_key FROM assets WHERE id = ?", String.class, assetId);
        assertThat(objectReader.read(storageKey))
                .startsWith((byte) 0x89, (byte) 0x50, (byte) 0x4e, (byte) 0x47);

        // 规范化 ContentReview：decided + pass，身份与策略版本完整
        Map<String, Object> review = jdbcTemplate.queryForMap(
                "SELECT * FROM content_reviews WHERE subject_id = ?",
                "generation-job:" + jobId + ":slot:0");
        assertThat(review.get("review_state")).isEqualTo("decided");
        assertThat(review.get("decision")).isEqualTo("pass");
        assertThat(review.get("failure_code")).isNull();
        assertThat(review.get("policy_version")).isEqualTo("local-fake-v1");
        assertThat(review.get("content_digest")).isEqualTo(contentSha);
        assertThat(review.get("modality")).isEqualTo("image");
        assertThat(review.get("direction")).isEqualTo("output");
        assertThat(count("content_reviews", "subject_id", "generation-job:" + jobId + ":slot:0"))
                .isEqualTo(1);

        // 控制面审计：预留创建、供应商准入、调用结果、审核决定、成本结算
        List<Map<String, Object>> audits = jdbcTemplate.queryForList(
                "SELECT action, decision, reason_code FROM audit_records WHERE correlation_id = ?",
                "generation-job:" + jobId);
        assertThat(audits).anyMatch(row -> row.get("action").equals("cost_reservation.create")
                && row.get("decision").equals("allowed"));
        assertThat(audits).anyMatch(row -> row.get("action").equals("cost_reservation.provider_admission")
                && row.get("decision").equals("allowed")
                && row.get("reason_code").equals("RESERVATION_ACTIVE"));
        assertThat(audits).anyMatch(row -> row.get("action").equals("generation_provider.call_outcome")
                && row.get("decision").equals("allowed")
                && row.get("reason_code").equals("SUCCESS"));
        assertThat(audits).anyMatch(row -> row.get("action").equals("content_review.decision")
                && row.get("decision").equals("allowed")
                && row.get("reason_code").equals("CONTENT_REVIEW_PASS"));
        assertThat(audits).anyMatch(row -> row.get("action").equals("cost_reservation.settle")
                && row.get("decision").equals("allowed")
                && row.get("reason_code").equals("PROVIDER_COST_PROVEN"));
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM cost_reservations WHERE generation_job_id = ?",
                String.class, jobId)).isEqualTo("SETTLED");

        // 事件与快照携带同一个 asset_id
        assertThat(jdbcTemplate.queryForList(
                "SELECT event_type FROM project_events WHERE project_id = ? ORDER BY event_cursor",
                String.class, job.getProjectId()))
                .contains("asset.created", "generation_job.output_attached");
        MvcResult snapshot = mockMvc.perform(get("/api/projects/{id}/snapshot", job.getProjectId())
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode snapshotData = objectMapper.readTree(snapshot.getResponse().getContentAsString()).path("data");
        JsonNode output = snapshotData.path("generation_jobs").get(0).path("outputs").get(0);
        assertThat(output.path("asset_id").asLong()).isEqualTo(assetId);
        String accessUrl = snapshotData.path("assets").path(String.valueOf(assetId))
                .path("access_url").asText();
        assertThat(accessUrl).isEqualTo(
                "/api/projects/" + job.getProjectId() + "/assets/" + assetId + "/content");

        // 私有访问边界：owner 200，跨 User 404，未认证 4xx
        mockMvc.perform(get(accessUrl).header("X-User-Id", "10"))
                .andExpect(status().isOk());
        mockMvc.perform(get(accessUrl).header("X-User-Id", "11"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get(accessUrl))
                .andExpect(status().is4xxClientError());

        // 重复交付同一结果：幂等，不产生第二个 Asset / 输出绑定
        // （终态 Job 的 leaseOwner 已清空；幂等判定先于执行权校验，传任意非空身份即可）
        GenerationResultCommand replay = new GenerationResultCommand(
                jobId, 0, job.getVersion(), job.getFencingToken(), "generation-worker-1",
                "job-" + jobId + "-slot-0-fence-" + job.getFencingToken(),
                storageKey, contentSha, "image/png", 68L, 1, 1);
        assertThat(acceptanceService.acceptSuccess(replay).status())
                .isEqualTo(com.blue.whale.agent.model.dto.GenerationAcceptanceResult.Status.IDEMPOTENT);
        assertThat(count("assets", "generation_job_id", jobId)).isEqualTo(1);
        assertThat(count("generation_job_outputs", "generation_job_id", jobId)).isEqualTo(1);
        assertThat(count("content_reviews", "subject_id", "generation-job:" + jobId + ":slot:0"))
                .isEqualTo(1);
    }

    @Test
    void agentRunFailureCardRetryCreatesLinkedSucceedingJob() throws Exception {
        Long originalJobId = createJobThroughAgentRun("fake:failure");

        // 原始 Job 确定性失败：failed、无 Asset、公开规范化错误（不泄漏内部信息）
        assertThat(generationWorker.runOnce("generation-worker-retry-origin")).isTrue();
        GenerationJob original = generationJobMapper.selectById(originalJobId);
        Long projectId = original.getProjectId();
        assertThat(original.getStatus()).isEqualTo(GenerationJob.STATUS_FAILED);
        assertThat(original.getError()).containsEntry("code", "provider_failed");
        assertThat(count("assets", "generation_job_id", originalJobId)).isZero();

        // Snapshot 暴露产品规范化错误文案，不泄漏 "Fake Provider 显式失败"
        Map<String, Object> failedJobDto = readGenerationJobFromSnapshot(projectId, originalJobId);
        assertThat(errorMessageOf(failedJobDto)).isEqualTo("图像生成失败");
        assertThat(objectMapper.writeValueAsString(failedJobDto)).doesNotContain("Fake Provider");

        // Card 重试：创建关联原 Job 的新 GenerationJob（retry_of_job_id 指向原 Job）
        String retryKey = "retry-" + originalJobId + "-1";
        Long retryJobId = retryMissingOutputs(projectId, originalJobId, retryKey);
        assertThat(retryJobId).isNotEqualTo(originalJobId);
        GenerationJob retry = generationJobMapper.selectById(retryJobId);
        assertThat(retry.getRetryOfJobId()).isEqualTo(originalJobId);
        // 事件契约（IK1NS2）：重试的 generation_job.created 事件必须携带 agent_run_id，
        // 否则前端恢复投影无法把新 Job 关联到 AgentRun，成功 Card 在实时路径永不出现
        String retryCreatedPayload = jdbcTemplate.queryForObject(
                "SELECT payload FROM project_events WHERE event_type = 'generation_job.created' AND aggregate_id = ?",
                String.class, String.valueOf(retryJobId));
        assertThat(objectMapper.readTree(retryCreatedPayload).path("agent_run_id").asLong())
                .isEqualTo(original.getAgentRunId());
        // 原 Job 终态不被改写
        assertThat(generationJobMapper.selectById(originalJobId).getStatus())
                .isEqualTo(GenerationJob.STATUS_FAILED);

        // 新 Job 独立执行 → 成功，经 ContentReview，创建一个私有 Asset，独立 CostReservation
        assertThat(generationWorker.runOnce("generation-worker-retry-success")).isTrue();
        GenerationJob succeededRetry = generationJobMapper.selectById(retryJobId);
        assertThat(succeededRetry.getStatus()).isEqualTo(GenerationJob.STATUS_SUCCEEDED);
        assertThat(succeededRetry.getOutputAssetIds()).hasSize(1);
        Long retryAssetId = succeededRetry.getOutputAssetIds().get(0);
        assertThat(count("assets", "generation_job_id", retryJobId)).isEqualTo(1);
        assertThat(count("assets", "generation_job_id", originalJobId)).isZero();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM cost_reservations WHERE generation_job_id = ?",
                String.class, retryJobId)).isEqualTo("SETTLED");
        // 新 Job 经 ContentReview 决定通过才创建 Asset（ADR-0022 / ADR-0029 闸门）
        Map<String, Object> retryReview = jdbcTemplate.queryForMap(
                "SELECT * FROM content_reviews WHERE subject_id = ?",
                "generation-job:" + retryJobId + ":slot:0");
        assertThat(retryReview.get("review_state")).isEqualTo("decided");
        assertThat(retryReview.get("decision")).isEqualTo("pass");
        assertThat(retryReview.get("policy_version")).isEqualTo("local-fake-v1");
        assertThat(count("content_reviews", "subject_id", "generation-job:" + retryJobId + ":slot:0"))
                .isEqualTo(1);
        // 新 Asset 私有访问边界：owner 200，跨 User 404
        String retryAccessUrl = "/api/projects/" + projectId + "/assets/" + retryAssetId + "/content";
        mockMvc.perform(get(retryAccessUrl).header("X-User-Id", "10"))
                .andExpect(status().isOk());
        mockMvc.perform(get(retryAccessUrl).header("X-User-Id", "11"))
                .andExpect(status().isNotFound());

        // 新 Asset 同时被成功 Card 与 Canvas NodeItem 引用；原失败事实仍可从 Snapshot 恢复
        Map<String, Object> retryJobDto = readGenerationJobFromSnapshot(projectId, retryJobId);
        assertThat(retryJobDto.get("status")).isEqualTo("succeeded");
        assertThat(firstOutputAssetId(retryJobDto)).isEqualTo(retryAssetId);
        Map<String, Object> originalStillFailed = readGenerationJobFromSnapshot(projectId, originalJobId);
        assertThat(originalStillFailed.get("status")).isEqualTo("failed");
        assertThat(errorMessageOf(originalStillFailed)).isEqualTo("图像生成失败");

        // 幂等：同 Idempotency-Key 重放返回同一 retry Job，不增加 Job/CostReservation/Asset/Provider 调用
        long jobsBefore = countAll("generation_jobs");
        long reservationsBefore = countAll("cost_reservations");
        long assetsBefore = countAll("assets");
        long providerTasksBefore = countAll("generation_provider_tasks");
        Long replayedJobId = retryMissingOutputs(projectId, originalJobId, retryKey);
        assertThat(replayedJobId).isEqualTo(retryJobId);
        assertThat(countAll("generation_jobs")).isEqualTo(jobsBefore);
        assertThat(countAll("cost_reservations")).isEqualTo(reservationsBefore);
        assertThat(countAll("assets")).isEqualTo(assetsBefore);
        assertThat(countAll("generation_provider_tasks")).isEqualTo(providerTasksBefore);
    }

    @Test
    void reviewRejectFailsClosedWithoutAsset() throws Exception {
        Long jobId = createJobThroughAgentRun("fake:review-reject");

        assertThat(generationWorker.runOnce("generation-worker-reject")).isTrue();

        assertFailedWithoutAsset(jobId, "content_rejected");
        Map<String, Object> review = jdbcTemplate.queryForMap(
                "SELECT * FROM content_reviews WHERE subject_id = ?",
                "generation-job:" + jobId + ":slot:0");
        assertThat(review.get("review_state")).isEqualTo("decided");
        assertThat(review.get("decision")).isEqualTo("reject");
        assertThat(String.valueOf(review.get("reason_codes"))).contains("custom_policy");
        assertThat(jdbcTemplate.queryForList(
                "SELECT action, decision, reason_code FROM audit_records WHERE correlation_id = ?",
                "generation-job:" + jobId))
                .anyMatch(row -> row.get("action").equals("content_review.decision")
                        && row.get("decision").equals("denied")
                        && row.get("reason_code").equals("custom_policy"));
        // 供应商调用已发生，成本按事实结算；隔离对象字节已删除
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM cost_reservations WHERE generation_job_id = ?",
                String.class, jobId)).isEqualTo("SETTLED");
        assertThat(objectReader.read(expectedOnePixelKey())).isNull();
    }

    @Test
    void invalidEvidenceFailsClosedWithoutAsset() throws Exception {
        Long jobId = createJobThroughAgentRun("fake:review-invalid");

        assertThat(generationWorker.runOnce("generation-worker-invalid")).isTrue();

        assertFailedWithoutAsset(jobId, "content_review_unavailable");
        Map<String, Object> review = jdbcTemplate.queryForMap(
                "SELECT * FROM content_reviews WHERE subject_id = ?",
                "generation-job:" + jobId + ":slot:0");
        assertThat(review.get("review_state")).isEqualTo("failed");
        assertThat(review.get("decision")).isNull();
        assertThat(review.get("failure_code")).isEqualTo("invalid_evidence");
        assertThat(jdbcTemplate.queryForList(
                "SELECT action, decision FROM audit_records WHERE correlation_id = ?",
                "generation-job:" + jobId))
                .anyMatch(row -> row.get("action").equals("content_review.decision")
                        && row.get("decision").equals("denied"));
        assertThat(objectReader.read(expectedOnePixelKey())).isNull();
    }

    @Test
    void unavailableReviewFailsClosedWithoutAsset() throws Exception {
        Long jobId = createJobThroughAgentRun("fake:review-unavailable");

        assertThat(generationWorker.runOnce("generation-worker-unavailable")).isTrue();

        assertFailedWithoutAsset(jobId, "content_review_unavailable");
        Map<String, Object> review = jdbcTemplate.queryForMap(
                "SELECT * FROM content_reviews WHERE subject_id = ?",
                "generation-job:" + jobId + ":slot:0");
        assertThat(review.get("review_state")).isEqualTo("failed");
        assertThat(review.get("failure_code")).isEqualTo("unavailable");
        assertThat(count("assets", "generation_job_id", jobId)).isZero();
    }

    @Test
    void missingActiveReservationFailsClosedAndProviderIsNotCalled() throws Exception {
        Long jobId = createJobThroughAgentRun("蓝鲸海报");
        // 预留被终结（非 ACTIVE）后，准入闸必须 fail closed，Provider 不得被调用
        jdbcTemplate.update(
                "UPDATE cost_reservations SET status = 'RELEASED' WHERE generation_job_id = ?", jobId);

        assertThatThrownBy(() -> generationWorker.runOnce("generation-worker-no-reservation"))
                .isInstanceOf(com.blue.whale.agent.service.governance.GovernanceException.class);

        // 无供应商调用证据、无 Asset、无审核事实；准入拒绝已写审计
        assertThat(count("generation_provider_tasks", "generation_job_id", jobId)).isZero();
        assertThat(count("assets", "generation_job_id", jobId)).isZero();
        assertThat(count("content_reviews", "subject_id", "generation-job:" + jobId + ":slot:0"))
                .isZero();
        assertThat(jdbcTemplate.queryForList(
                "SELECT action, decision, reason_code FROM audit_records WHERE correlation_id = ?",
                "generation-job:" + jobId))
                .anyMatch(row -> row.get("action").equals("cost_reservation.provider_admission")
                        && row.get("decision").equals("denied")
                        && row.get("reason_code").equals("ACTIVE_RESERVATION_REQUIRED"));
    }

    private void assertFailedWithoutAsset(Long jobId, String errorCode) {
        GenerationJob job = generationJobMapper.selectById(jobId);
        assertThat(job.getStatus()).isEqualTo(GenerationJob.STATUS_FAILED);
        assertThat(job.getError()).containsEntry("code", errorCode);
        assertThat(count("assets", "generation_job_id", jobId)).isZero();
        assertThat(count("generation_job_outputs", "generation_job_id", jobId)).isOne();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT status FROM generation_job_outputs WHERE generation_job_id = ?",
                String.class, jobId)).isEqualTo("failed");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT asset_id FROM generation_job_outputs WHERE generation_job_id = ?",
                Long.class, jobId)).isNull();
        // 失败事实经快照可见：无 asset 身份泄露
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM assets WHERE id IN (SELECT asset_id FROM generation_job_outputs "
                        + "WHERE generation_job_id = ?)", Long.class, jobId)).isZero();
    }

    private String expectedOnePixelKey() throws Exception {
        byte[] onePixelPng = Base64.getDecoder().decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        return "fake/sha256/" + HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(onePixelPng));
    }

    private Long createJobThroughAgentRun(String prompt) throws Exception {
        Project project = new Project().setOwnerId(10L).setName("local-fake-generation");
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

    private long count(String table, String column, Object value) {
        Long result = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?", Long.class, value);
        return result == null ? 0 : result;
    }

    private long countAll(String table) {
        Long result = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table, Long.class);
        return result == null ? 0 : result;
    }

    /** 从 Project Snapshot 的 generation_jobs 中按 job_id 取单条 Job DTO（snake_case）。 */
    @SuppressWarnings("unchecked")
    private Map<String, Object> readGenerationJobFromSnapshot(Long projectId, Long jobId) throws Exception {
        MvcResult snapshot = mockMvc.perform(get("/api/projects/{id}/snapshot", projectId)
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode jobs = objectMapper.readTree(
                        snapshot.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8))
                .path("data").path("generation_jobs");
        for (JsonNode job : jobs) {
            if (job.path("job_id").asLong() == jobId) {
                return objectMapper.treeToValue(job, Map.class);
            }
        }
        throw new AssertionError("Snapshot 未找到 generation_job: " + jobId);
    }

    /** 调 Card 重试端点，返回新创建的 retry GenerationJob id。 */
    private Long retryMissingOutputs(Long projectId, Long originalJobId, String idempotencyKey) throws Exception {
        MvcResult result = mockMvc.perform(
                        post("/api/projects/{id}/generation-jobs/{jobId}/retry", projectId, originalJobId)
                                .header("X-User-Id", "10")
                                .header("Idempotency-Key", idempotencyKey))
                .andExpect(status().isAccepted())
                .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString())
                .path("data").path("generation_job_id").asLong();
    }

    /** 从 Snapshot Job DTO（snake_case）取规范化公开错误 message。 */
    private String errorMessageOf(Map<String, Object> jobDto) {
        Object error = jobDto.get("error");
        if (!(error instanceof Map<?, ?> errorMap)) {
            return null;
        }
        Object message = errorMap.get("message");
        return message == null ? null : String.valueOf(message);
    }

    /** 从 Snapshot Job DTO 的首个 output 取 asset_id。 */
    private Long firstOutputAssetId(Map<String, Object> jobDto) {
        Object outputs = jobDto.get("outputs");
        if (!(outputs instanceof List<?> outputList) || outputList.isEmpty()) {
            return null;
        }
        Object first = outputList.get(0);
        if (!(first instanceof Map<?, ?> outputMap)) {
            return null;
        }
        Object assetId = outputMap.get("asset_id");
        return assetId == null ? null : ((Number) assetId).longValue();
    }
}
