package com.blue.whale.agent;

import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.dto.GenerationAcceptanceResult;
import com.blue.whale.agent.model.dto.GenerationJobClaim;
import com.blue.whale.agent.model.dto.GenerationResultCommand;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.GenerationJobClaimService;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
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
    private GenerationJobClaimService claimService;
    @Autowired
    private GenerationResultAcceptanceService acceptanceService;
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
        assertThat(count("generation_job_outputs", "generation_job_id", job.getId())).isZero();

        GenerationAcceptanceResult accepted = acceptanceService.acceptSuccess(
                command(reclaimed, "fresh-delivery", "c".repeat(64)));
        assertThat(accepted.status()).isEqualTo(GenerationAcceptanceResult.Status.ACCEPTED);
        assertThatThrownBy(() -> acceptanceService.acceptSuccess(
                command(first, "stale-after-success", "c".repeat(64))))
                .isInstanceOf(GlobalException.class);
        assertThat(acceptanceService.acceptSuccess(
                command(reclaimed, "fresh-retry", "c".repeat(64))).status())
                .isEqualTo(GenerationAcceptanceResult.Status.IDEMPOTENT);
    }

    private GenerationJob queuedAgentImageJob(String prompt) {
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
                .setType(GenerationJob.TYPE_IMAGE)
                .setSource(GenerationJob.SOURCE_AGENT_RUN)
                .setInput(input)
                .setStatus(GenerationJob.STATUS_QUEUED)
                .setProgress(0);
        generationJobMapper.insert(job);
        return job;
    }

    private GenerationResultCommand command(
            GenerationJobClaim claim,
            String deliveryId,
            String digest) {
        return new GenerationResultCommand(
                claim.jobId(), 0, claim.jobVersion(), claim.fencingToken(), claim.leaseOwner(),
                deliveryId, "fake/sha256/" + digest, digest, "image/png", 128L);
    }

    private long count(String table, String column, Long value) {
        Long count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?", Long.class, value);
        return count == null ? 0 : count;
    }
}
