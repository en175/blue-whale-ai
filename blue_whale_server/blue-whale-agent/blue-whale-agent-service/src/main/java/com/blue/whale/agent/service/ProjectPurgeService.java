package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.AgentRunMapper;
import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.AssetStorageObjectMapper;
import com.blue.whale.agent.mapper.AssistantMessageChunkMapper;
import com.blue.whale.agent.mapper.AssistantMessageStreamMapper;
import com.blue.whale.agent.mapper.CanvasMapper;
import com.blue.whale.agent.mapper.ConversationMapper;
import com.blue.whale.agent.mapper.ConversationMessageMapper;
import com.blue.whale.agent.mapper.CostReservationMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationJobOutputMapper;
import com.blue.whale.agent.mapper.GenerationProviderTaskMapper;
import com.blue.whale.agent.mapper.GenerationResultConflictMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.mapper.RunCommitRecordMapper;
import com.blue.whale.agent.mapper.RuntimeCheckpointMapper;
import com.blue.whale.agent.mapper.UserInputRequestMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.entity.CostReservation;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.governance.CostReservationService;
import com.blue.whale.agent.service.governance.CostReservationStatus;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 项目永久删除服务（IK25EG）：普通 Canvas Project 与生成收件箱共用的物理级联删除。
 *
 * <p>删除顺序与并发防护：
 * <ol>
 * <li>{@code SELECT ... FOR UPDATE} 锁定项目行——所有经 {@code requireOwnedForUpdate} 的写入方
 * （消息接纳、任务命令、画布保存、AgentRun 推进）随之序列化，防止状态写入越过并发删除；
 * <li>同事务先写 PROJECT_DELETED 审计事件，再尽力终结在途生成任务的成本面
 * （queued 释放预留、processing/cancel_requested 转对账），随后按先子后父物理删除用户可见内容；
 * <li>生成结果接纳只锁 job 行：迟到结果在 purge 提交后查不到 job 而按资源不存在拒绝，
 * 不会重新创建已删除 Project、Asset 或其他用户可见内容；
 * <li>共享存储对象仅在全表无其他引用时标记 first_unreferenced_at（GC 保留期后物理回收），
 * 其他 Project 的独立作品副本不受影响。
 * </ol>
 *
 * <p>project_events / outbox_messages / project_event_stream / command_idempotency /
 * content_reviews / cost 治理表保留作最小审计，不含可恢复作品内容。
 */
@Service
@RequiredArgsConstructor
public class ProjectPurgeService {

    /** 排队任务未触达供应商即随项目删除，成本预留释放（与产品取消同一 reason code）。 */
    private static final String REASON_CANCELLED_BEFORE_PROVIDER = "CANCELLED_BEFORE_PROVIDER";
    /** 在途任务随项目删除，供应商结果未知，预留转对账。 */
    private static final String REASON_PROJECT_PURGED = "PROJECT_PURGED";

    private final ProjectMapper projectMapper;
    private final ConversationMapper conversationMapper;
    private final ConversationMessageMapper messageMapper;
    private final AssistantMessageChunkMapper assistantMessageChunkMapper;
    private final AssistantMessageStreamMapper assistantMessageStreamMapper;
    private final UserInputRequestMapper userInputRequestMapper;
    private final RuntimeCheckpointMapper runtimeCheckpointMapper;
    private final RunCommitRecordMapper runCommitRecordMapper;
    private final AgentRunMapper agentRunMapper;
    private final GenerationJobMapper generationJobMapper;
    private final GenerationJobOutputMapper generationJobOutputMapper;
    private final GenerationProviderTaskMapper generationProviderTaskMapper;
    private final GenerationResultConflictMapper generationResultConflictMapper;
    private final CanvasMapper canvasMapper;
    private final AssetMapper assetMapper;
    private final AssetStorageObjectMapper storageObjectMapper;
    private final CostReservationMapper costReservationMapper;
    private final ProjectEventService projectEventService;
    private final CostReservationService costReservationService;

    /**
     * 永久删除项目及其全部内容。调用方须已完成归属与用途校验；
     * 项目行在本方法内锁定，并发写入方与并发删除按锁序串行。
     */
    @Transactional
    public void purge(Project project) {
        Long projectId = project.getId();
        Project locked = projectMapper.selectForUpdate(projectId);
        if (locked == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        int deletedVersion = locked.getVersion() == null ? 1 : locked.getVersion() + 1;
        projectEventService.appendEvent(projectId, EventType.PROJECT_DELETED,
                AggregateType.PROJECT, String.valueOf(projectId), deletedVersion,
                Map.of("project_id", projectId), null, null);
        settleActiveJobReservations(projectId);
        assistantMessageChunkMapper.hardDeleteByProjectId(projectId);
        assistantMessageStreamMapper.hardDeleteByProjectId(projectId);
        messageMapper.hardDeleteByProjectId(projectId);
        userInputRequestMapper.hardDeleteByProjectId(projectId);
        runtimeCheckpointMapper.hardDeleteByAgentRunProjectId(projectId);
        runCommitRecordMapper.hardDeleteByAgentRunProjectId(projectId);
        agentRunMapper.hardDeleteByProjectId(projectId);
        generationJobOutputMapper.hardDeleteByGenerationJobProjectId(projectId);
        generationProviderTaskMapper.hardDeleteByGenerationJobProjectId(projectId);
        generationResultConflictMapper.hardDeleteByGenerationJobProjectId(projectId);
        generationJobMapper.hardDeleteByProjectId(projectId);
        conversationMapper.hardDeleteByProjectId(projectId);
        canvasMapper.hardDeleteByProjectId(projectId);
        List<String> storageKeys = assetMapper.selectDistinctStorageKeysByProjectId(projectId);
        assetMapper.hardDeleteByProjectId(projectId);
        markUnreferencedIfOrphaned(storageKeys);
        projectMapper.hardDeleteById(projectId);
    }

    /**
     * 尽力取消在途生成任务：逐个锁定 job 后按锁下最新状态处理成本预留——
     * queued 释放预算（供应商未被调用），processing/cancel_requested 转对账（供应商结果未知）。
     * job 行随后随 purge 物理删除，迟到结果按资源不存在拒绝，无需再改 job 状态。
     * 无预留或预留已终结（SETTLED/RELEASED/PENDING_RECONCILIATION）的 job 跳过。
     */
    private void settleActiveJobReservations(Long projectId) {
        List<GenerationJob> activeJobs = generationJobMapper.selectList(
                Wrappers.<GenerationJob>lambdaQuery()
                        .eq(GenerationJob::getProjectId, projectId)
                        .in(GenerationJob::getStatus, GenerationJob.STATUS_QUEUED,
                                GenerationJob.STATUS_PROCESSING, GenerationJob.STATUS_CANCEL_REQUESTED));
        for (GenerationJob candidate : activeJobs) {
            GenerationJob job = generationJobMapper.selectForUpdate(candidate.getId());
            if (job == null) {
                continue;
            }
            if (GenerationJob.STATUS_QUEUED.equals(job.getStatus())) {
                releaseReservationIfActive(job.getId());
            } else if (GenerationJob.STATUS_PROCESSING.equals(job.getStatus())
                    || GenerationJob.STATUS_CANCEL_REQUESTED.equals(job.getStatus())) {
                markReservationPendingReconciliationIfActive(job.getId());
            }
        }
    }

    private void releaseReservationIfActive(Long jobId) {
        CostReservation reservation = costReservationMapper.selectByJobForUpdate(jobId);
        if (reservation != null
                && CostReservationStatus.ACTIVE.name().equals(reservation.getStatus())) {
            costReservationService.release(jobId, REASON_CANCELLED_BEFORE_PROVIDER);
        }
    }

    private void markReservationPendingReconciliationIfActive(Long jobId) {
        CostReservation reservation = costReservationMapper.selectByJobForUpdate(jobId);
        if (reservation != null
                && CostReservationStatus.ACTIVE.name().equals(reservation.getStatus())) {
            costReservationService.markPendingReconciliation(jobId, REASON_PROJECT_PURGED);
        }
    }

    /** 与 GC 同一判据：全表（含逻辑删除行）无引用才进入待回收计时；其他项目副本仍在引用则不动。 */
    private void markUnreferencedIfOrphaned(List<String> storageKeys) {
        if (storageKeys.isEmpty()) {
            return;
        }
        LocalDateTime now = generationJobMapper.selectCurrentTime();
        for (String storageKey : storageKeys) {
            if (assetMapper.countAllByStorageKey(storageKey) == 0) {
                storageObjectMapper.markFirstUnreferenced(storageKey, now);
            }
        }
    }
}
