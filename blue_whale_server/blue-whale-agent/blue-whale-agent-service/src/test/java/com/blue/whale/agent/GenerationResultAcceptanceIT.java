package com.blue.whale.agent;

import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationJobOutputMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.dto.GenerationAcceptanceResult;
import com.blue.whale.agent.model.dto.GenerationFailureCommand;
import com.blue.whale.agent.model.dto.GenerationJobClaim;
import com.blue.whale.agent.model.dto.GenerationResultCommand;
import com.blue.whale.agent.model.dto.SnapshotResponse;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationJobOutput;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.model.entity.ProjectEvent;
import com.blue.whale.agent.service.GenerationJobClaimService;
import com.blue.whale.agent.service.ProjectEventService;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
import com.blue.whale.agent.service.SnapshotService;
import com.blue.whale.global.exception.GlobalException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid"
})
@ActiveProfiles("test")
class GenerationResultAcceptanceIT {

    @Autowired
    private ProjectMapper projectMapper;
    @Autowired
    private GenerationJobMapper generationJobMapper;
    @Autowired
    private GenerationJobOutputMapper outputMapper;
    @Autowired
    private GenerationJobClaimService claimService;
    @Autowired
    private GenerationResultAcceptanceService acceptanceService;
    @Autowired
    private SnapshotService snapshotService;
    @Autowired
    private ProjectEventService projectEventService;
    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void cleanGenerationFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM generation_result_conflicts",
                "DELETE FROM generation_job_outputs",
                "DELETE FROM assets",
                "DELETE FROM generation_jobs",
                "DELETE FROM outbox_messages",
                "DELETE FROM project_events",
                "DELETE FROM project_event_stream",
                "DELETE FROM project");
    }

    @Test
    void sameSlotAcceptsOneImmutableAssetAndRejectsDifferentDigest() {
        GenerationJob job = queuedAgentImageJob("蓝鲸海报");
        GenerationJobClaim claim = claimService.claim("worker-1");

        GenerationAcceptanceResult first = acceptanceService.acceptSuccess(
                command(claim, "delivery-1", "a".repeat(64)));
        GenerationAcceptanceResult repeated = acceptanceService.acceptSuccess(
                command(claim, "delivery-2", "a".repeat(64)));
        GenerationAcceptanceResult conflict = acceptanceService.acceptSuccess(
                command(claim, "delivery-3", "b".repeat(64)));

        assertThat(first.status()).isEqualTo(GenerationAcceptanceResult.Status.ACCEPTED);
        assertThat(repeated.status()).isEqualTo(GenerationAcceptanceResult.Status.IDEMPOTENT);
        assertThat(repeated.assetId()).isEqualTo(first.assetId());
        assertThat(conflict.status()).isEqualTo(GenerationAcceptanceResult.Status.CONFLICT);
        assertThat(conflict.assetId()).isEqualTo(first.assetId());
        assertThat(count("assets", "generation_job_id", job.getId())).isEqualTo(1);
        assertThat(count("generation_job_outputs", "generation_job_id", job.getId())).isEqualTo(1);
        assertThat(count("generation_result_conflicts", "generation_job_id", job.getId())).isEqualTo(1);
        assertThat(count("project_events", "project_id", job.getProjectId())).isEqualTo(4);

        GenerationJob accepted = generationJobMapper.selectById(job.getId());
        assertThat(accepted.getStatus()).isEqualTo(GenerationJob.STATUS_SUCCEEDED);
        assertThat(accepted.getOutputAssetIds()).containsExactly(first.assetId());
        assertThat(accepted.getLeaseOwner()).isNull();
        assertThat(accepted.getLeaseExpiresAt()).isNull();
    }

    @Test
    void expiredLeaseCanBeReclaimedAndOldFencingTokenCannotCommit() {
        GenerationJob job = queuedAgentImageJob("租约接管");
        GenerationJobClaim first = claimService.claim("worker-1");
        jdbcTemplate.update("UPDATE generation_jobs SET lease_expires_at = ? WHERE id = ?",
                Timestamp.valueOf(LocalDateTime.now().minusMinutes(1)), job.getId());

        GenerationJobClaim reclaimed = claimService.claim("worker-2");

        assertThat(reclaimed.jobId()).isEqualTo(job.getId());
        assertThat(reclaimed.fencingToken()).isGreaterThan(first.fencingToken());
        assertThatThrownBy(() -> acceptanceService.acceptSuccess(
                command(first, "stale-delivery", "c".repeat(64))))
                .isInstanceOf(GlobalException.class);
        assertThat(count("assets", "generation_job_id", job.getId())).isZero();
        assertThat(count("generation_job_outputs", "generation_job_id", job.getId())).isEqualTo(1);

        GenerationAcceptanceResult accepted = acceptanceService.acceptSuccess(
                command(reclaimed, "fresh-delivery", "c".repeat(64)));
        assertThat(accepted.status()).isEqualTo(GenerationAcceptanceResult.Status.ACCEPTED);
        assertThat(acceptanceService.acceptSuccess(
                command(first, "stale-after-success", "c".repeat(64))).status())
                .isEqualTo(GenerationAcceptanceResult.Status.IDEMPOTENT);
        assertThat(acceptanceService.acceptSuccess(
                command(reclaimed, "fresh-retry", "c".repeat(64))).status())
                .isEqualTo(GenerationAcceptanceResult.Status.IDEMPOTENT);
    }

    @Test
    void mixedSlotOutcomesBecomePartialAndTerminalFactsStayImmutable() {
        GenerationJob job = queuedAgentImageJob("多输出聚合", 4);

        GenerationJobClaim first = claimService.claim("worker-1");
        assertThat(first.targetSlotIndex()).isZero();
        GenerationAcceptanceResult firstSuccess = acceptanceService.acceptSuccess(
                command(first, first.targetSlotIndex(), "delivery-0", "a".repeat(64)));

        GenerationJobClaim second = claimService.claim("worker-2");
        assertThat(second.targetSlotIndex()).isEqualTo(1);
        assertThat(acceptanceService.acceptSuccess(
                command(first, 0, "delivery-0-repeat", "a".repeat(64))).status())
                .isEqualTo(GenerationAcceptanceResult.Status.IDEMPOTENT);
        acceptanceService.acceptFailure(failure(second, "provider_failed", "slot 1 failed"));

        GenerationJobClaim third = claimService.claim("worker-3");
        assertThat(third.targetSlotIndex()).isEqualTo(2);
        GenerationAcceptanceResult thirdSuccess = acceptanceService.acceptSuccess(
                command(third, third.targetSlotIndex(), "delivery-2", "c".repeat(64)));

        GenerationJobClaim fourth = claimService.claim("worker-4");
        assertThat(fourth.targetSlotIndex()).isEqualTo(3);
        acceptanceService.acceptFailure(failure(fourth, "provider_failed", "slot 3 failed"));

        GenerationJob partial = generationJobMapper.selectById(job.getId());
        assertThat(partial.getStatus()).isEqualTo(GenerationJob.STATUS_PARTIALLY_SUCCEEDED);
        assertThat(partial.getProgress()).isEqualTo(100);
        assertThat(partial.getOutputAssetIds())
                .containsExactly(firstSuccess.assetId(), thirdSuccess.assetId());
        assertThat(outputMapper.selectList(null))
                .extracting(GenerationJobOutput::getSlotIndex, GenerationJobOutput::getStatus)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(0, GenerationJobOutput.STATUS_SUCCEEDED),
                        org.assertj.core.groups.Tuple.tuple(1, GenerationJobOutput.STATUS_FAILED),
                        org.assertj.core.groups.Tuple.tuple(2, GenerationJobOutput.STATUS_SUCCEEDED),
                        org.assertj.core.groups.Tuple.tuple(3, GenerationJobOutput.STATUS_FAILED));

        GenerationAcceptanceResult late = acceptanceService.acceptSuccess(
                command(fourth, 1, "late-slot-1", "d".repeat(64)));
        assertThat(late.status()).isEqualTo(GenerationAcceptanceResult.Status.CONFLICT);
        assertThat(count("assets", "generation_job_id", job.getId())).isEqualTo(2);
        GenerationJob unchanged = generationJobMapper.selectById(job.getId());
        assertThat(unchanged.getStatus()).isEqualTo(GenerationJob.STATUS_PARTIALLY_SUCCEEDED);
        assertThat(unchanged.getOutputAssetIds())
                .containsExactly(firstSuccess.assetId(), thirdSuccess.assetId());

        SnapshotResponse snapshot = snapshotService.getSnapshot(
                job.getProjectId(), job.getUserId());
        SnapshotResponse.GenerationJobDto snapshotJob = snapshot.generationJobs().stream()
                .filter(candidate -> candidate.jobId().equals(job.getId()))
                .findFirst()
                .orElseThrow();
        SnapshotResponse.GenerationJobDto singleJob = snapshotService.getGenerationJob(
                job.getProjectId(), job.getId(), job.getUserId());
        assertThat(snapshotJob).isEqualTo(singleJob);
        assertThat(snapshotJob.outputs())
                .extracting(SnapshotResponse.GenerationJobOutputDto::slotIndex,
                        SnapshotResponse.GenerationJobOutputDto::status)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(0, "succeeded"),
                        org.assertj.core.groups.Tuple.tuple(1, "failed"),
                        org.assertj.core.groups.Tuple.tuple(2, "succeeded"),
                        org.assertj.core.groups.Tuple.tuple(3, "failed"));

        List<ProjectEvent> replayedOutputEvents = projectEventService.eventsAfter(
                        job.getProjectId(), 0, 100).stream()
                .filter(event -> event.getEventType().startsWith("generation_job.output_"))
                .toList();
        assertThat(replayedOutputEvents)
                .extracting(event -> event.getPayload().get("slot_index"),
                        event -> event.getPayload().get("status"))
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(0, "succeeded"),
                        org.assertj.core.groups.Tuple.tuple(1, "failed"),
                        org.assertj.core.groups.Tuple.tuple(2, "succeeded"),
                        org.assertj.core.groups.Tuple.tuple(3, "failed"));
        assertThat(snapshot.highWatermarkCursor())
                .isEqualTo(projectEventService.highWatermark(job.getProjectId()));
    }

    @Test
    void noSuccessfulSlotBecomesFailedOnlyAfterEverySlotResolves() {
        GenerationJob job = queuedAgentImageJob("全部失败", 2);

        GenerationJobClaim first = claimService.claim("worker-1");
        GenerationFailureCommand firstFailure = failure(first, "provider_failed", "slot 0 failed");
        acceptanceService.acceptFailure(firstFailure);
        assertThat(acceptanceService.acceptFailure(firstFailure).status())
                .isEqualTo(GenerationAcceptanceResult.Status.IDEMPOTENT);
        assertThat(generationJobMapper.selectById(job.getId()).getStatus())
                .isEqualTo(GenerationJob.STATUS_PROCESSING);

        GenerationJobClaim second = claimService.claim("worker-2");
        acceptanceService.acceptFailure(failure(second, "provider_failed", "slot 1 failed"));

        GenerationJob failed = generationJobMapper.selectById(job.getId());
        assertThat(failed.getStatus()).isEqualTo(GenerationJob.STATUS_FAILED);
        assertThat(failed.getOutputAssetIds()).isEmpty();
        assertThat(failed.getProgress()).isEqualTo(100);
    }

    @Test
    void failureOutputEventUsesTheSamePublicErrorAsSnapshot() {
        GenerationJob job = queuedAgentImageJob("公开错误一致性");
        GenerationJobClaim claim = claimService.claim("worker-public-error");

        acceptanceService.acceptFailure(failure(
                claim, "provider_rate_limited", "provider secret detail"));

        SnapshotResponse.GenerationJobDto snapshot = snapshotService.getGenerationJob(
                job.getProjectId(), job.getId(), job.getUserId());
        Map<String, Object> snapshotError = snapshot.outputs().get(0).error();
        String eventPayload = jdbcTemplate.queryForObject(
                "SELECT payload FROM project_events "
                        + "WHERE aggregate_id = ? AND event_type = 'generation_job.output_updated'",
                String.class, job.getId() + ":0");
        assertThat(snapshotError)
                .containsEntry("code", "image_generation_failed")
                .containsEntry("message", "图像生成失败");
        assertThat(eventPayload)
                .contains("\"code\":\"image_generation_failed\"")
                .contains("\"message\":\"图像生成失败\"")
                .doesNotContain("provider_rate_limited")
                .doesNotContain("provider secret detail");
    }

    private GenerationJob queuedAgentImageJob(String prompt) {
        return queuedAgentImageJob(prompt, 1);
    }

    private GenerationJob queuedAgentImageJob(String prompt, int expectedOutputCount) {
        Project project = new Project().setOwnerId(10L).setName("generation-acceptance");
        projectMapper.insert(project);
        LinkedHashMap<String, Object> input = new LinkedHashMap<>();
        input.put("prompt", prompt);
        input.put("aspect_ratio", "1:1");
        GenerationJob job = new GenerationJob()
                .setProjectId(project.getId())
                .setUserId(10L)
                .setAgentRunId(20L)
                .setActionIdentity("action-" + project.getId())
                .setExpectedOutputCount(expectedOutputCount)
                .setType(GenerationJob.TYPE_IMAGE)
                .setSource(GenerationJob.SOURCE_AGENT_RUN)
                .setInput(input)
                .setStatus(GenerationJob.STATUS_QUEUED)
                .setProgress(0);
        generationJobMapper.insert(job);
        for (int slotIndex = 0; slotIndex < expectedOutputCount; slotIndex++) {
            outputMapper.insert(new GenerationJobOutput()
                    .setGenerationJobId(job.getId())
                    .setSlotIndex(slotIndex)
                    .setStatus(GenerationJobOutput.STATUS_PENDING));
        }
        return job;
    }

    private GenerationResultCommand command(
            GenerationJobClaim claim,
            String deliveryId,
            String digest) {
        return new GenerationResultCommand(
                claim.jobId(), claim.targetSlotIndex(), claim.jobVersion(), claim.fencingToken(), claim.leaseOwner(),
                deliveryId, "fake/sha256/" + digest, digest, "image/png", 128L);
    }

    private GenerationResultCommand command(
            GenerationJobClaim claim,
            int slotIndex,
            String deliveryId,
            String digest) {
        return new GenerationResultCommand(
                claim.jobId(), slotIndex, claim.jobVersion(), claim.fencingToken(), claim.leaseOwner(),
                deliveryId, "fake/sha256/" + digest, digest, "image/png", 128L);
    }

    private GenerationFailureCommand failure(
            GenerationJobClaim claim,
            String errorCode,
            String errorMessage) {
        return new GenerationFailureCommand(
                claim.jobId(), claim.targetSlotIndex(), claim.jobVersion(), claim.fencingToken(),
                claim.leaseOwner(), errorCode, errorMessage);
    }

    private long count(String table, String column, Long value) {
        Long count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?", Long.class, value);
        return count == null ? 0 : count;
    }
}
