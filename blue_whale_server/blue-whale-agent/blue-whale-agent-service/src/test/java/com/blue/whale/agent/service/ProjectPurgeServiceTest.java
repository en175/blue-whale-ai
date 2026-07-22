package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
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
import com.blue.whale.agent.mapper.MessageAssetReferenceMapper;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.mapper.RunCommitRecordMapper;
import com.blue.whale.agent.mapper.RuntimeCheckpointMapper;
import com.blue.whale.agent.mapper.UserInputRequestMapper;
import com.blue.whale.agent.model.entity.CostReservation;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.governance.CostReservationService;
import com.blue.whale.agent.service.governance.CostReservationStatus;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link ProjectPurgeService} 编排契约单测（IK25EG）：锁项目行先于成本终结与级联删除、
 * 项目行不存在按资源不存在拒绝、在途任务按锁下状态终结成本预留、孤儿存储对象标记。
 * 全 mock，不连数据库；引擎级锁等待由 H2/MySQL 行锁语义保证（同 CancellationService 模式）。
 */
@ExtendWith(MockitoExtension.class)
class ProjectPurgeServiceTest {

    @Mock
    private ProjectMapper projectMapper;
    @Mock
    private ConversationMapper conversationMapper;
    @Mock
    private ConversationMessageMapper messageMapper;
    @Mock
    private MessageAssetReferenceMapper messageAssetReferenceMapper;
    @Mock
    private AssistantMessageChunkMapper assistantMessageChunkMapper;
    @Mock
    private AssistantMessageStreamMapper assistantMessageStreamMapper;
    @Mock
    private UserInputRequestMapper userInputRequestMapper;
    @Mock
    private RuntimeCheckpointMapper runtimeCheckpointMapper;
    @Mock
    private RunCommitRecordMapper runCommitRecordMapper;
    @Mock
    private AgentRunMapper agentRunMapper;
    @Mock
    private GenerationJobMapper generationJobMapper;
    @Mock
    private GenerationJobOutputMapper generationJobOutputMapper;
    @Mock
    private GenerationProviderTaskMapper generationProviderTaskMapper;
    @Mock
    private GenerationResultConflictMapper generationResultConflictMapper;
    @Mock
    private CanvasMapper canvasMapper;
    @Mock
    private AssetMapper assetMapper;
    @Mock
    private AssetStorageObjectMapper storageObjectMapper;
    @Mock
    private CostReservationMapper costReservationMapper;
    @Mock
    private ProjectEventService projectEventService;
    @Mock
    private CostReservationService costReservationService;

    private ProjectPurgeService purgeService;

    @BeforeAll
    static void initTableInfo() {
        // 纯 mock 单测无 MyBatis 上下文，手动注册 TableInfo 才能解析 lambda 查询列名
        MapperBuilderAssistant assistant = new MapperBuilderAssistant(new MybatisConfiguration(), "");
        TableInfoHelper.initTableInfo(assistant, Project.class);
        TableInfoHelper.initTableInfo(assistant, GenerationJob.class);
    }

    @BeforeEach
    void setUp() {
        purgeService = new ProjectPurgeService(
                projectMapper, conversationMapper, messageMapper, messageAssetReferenceMapper,
                assistantMessageChunkMapper, assistantMessageStreamMapper, userInputRequestMapper,
                runtimeCheckpointMapper, runCommitRecordMapper, agentRunMapper,
                generationJobMapper, generationJobOutputMapper, generationProviderTaskMapper,
                generationResultConflictMapper, canvasMapper, assetMapper, storageObjectMapper,
                costReservationMapper, projectEventService, costReservationService);
    }

    @Test
    void purgeLocksProjectRowBeforeSettleAndCascade() {
        Project locked = new Project().setOwnerId(10L).setName("A")
                .setPurpose(Project.PURPOSE_CANVAS);
        locked.setId(1L);
        locked.setVersion(3);
        when(projectMapper.selectForUpdate(1L)).thenReturn(locked);
        GenerationJob queued = new GenerationJob();
        queued.setId(11L);
        queued.setStatus(GenerationJob.STATUS_QUEUED);
        when(generationJobMapper.selectList(any())).thenReturn(List.of(queued));
        when(generationJobMapper.selectForUpdate(11L)).thenReturn(queued);
        when(costReservationMapper.selectByJobForUpdate(11L))
                .thenReturn(activeReservation(11L));
        when(assetMapper.selectDistinctStorageKeysByProjectId(1L)).thenReturn(List.of());

        purgeService.purge(locked);

        InOrder order = inOrder(projectMapper, costReservationService, generationJobMapper,
                messageMapper, messageAssetReferenceMapper);
        order.verify(projectMapper).selectForUpdate(1L);
        order.verify(costReservationService).release(11L, "CANCELLED_BEFORE_PROVIDER");
        order.verify(messageMapper).hardDeleteByProjectId(1L);
        order.verify(messageAssetReferenceMapper).hardDeleteByProjectId(1L);
        order.verify(generationJobMapper).hardDeleteByProjectId(1L);
        order.verify(projectMapper).hardDeleteById(1L);
        verify(projectEventService).appendEvent(eq(1L), eq("project.deleted"), eq("project"),
                eq("1"), eq(4), eq(java.util.Map.of("project_id", 1L)), eq(null), eq(null));
    }

    @Test
    void purgeThrowsNotFoundWhenProjectRowAlreadyGone() {
        Project input = new Project();
        input.setId(99L);
        when(projectMapper.selectForUpdate(99L)).thenReturn(null);

        assertThatThrownBy(() -> purgeService.purge(input))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.RESOURCE_NOT_FOUND_CODE);
        verifyNoInteractions(costReservationService);
        verify(generationJobMapper, never()).hardDeleteByProjectId(anyLong());
        verify(projectMapper, never()).hardDeleteById(anyLong());
    }

    @Test
    void settleMarksProcessingReservationPendingReconciliation() {
        Project locked = new Project().setOwnerId(10L).setName("A");
        locked.setId(1L);
        when(projectMapper.selectForUpdate(1L)).thenReturn(locked);
        GenerationJob processing = new GenerationJob();
        processing.setId(12L);
        processing.setStatus(GenerationJob.STATUS_PROCESSING);
        when(generationJobMapper.selectList(any())).thenReturn(List.of(processing));
        when(generationJobMapper.selectForUpdate(12L)).thenReturn(processing);
        when(costReservationMapper.selectByJobForUpdate(12L))
                .thenReturn(activeReservation(12L));
        when(assetMapper.selectDistinctStorageKeysByProjectId(1L)).thenReturn(List.of());

        purgeService.purge(locked);

        verify(costReservationService).markPendingReconciliation(12L, "PROJECT_PURGED");
        verify(costReservationService, never()).release(anyLong(), anyString());
    }

    @Test
    void settleSkipsJobsWithoutActiveReservation() {
        Project locked = new Project().setOwnerId(10L).setName("A");
        locked.setId(1L);
        when(projectMapper.selectForUpdate(1L)).thenReturn(locked);
        GenerationJob noReservation = new GenerationJob();
        noReservation.setId(13L);
        noReservation.setStatus(GenerationJob.STATUS_QUEUED);
        GenerationJob released = new GenerationJob();
        released.setId(14L);
        released.setStatus(GenerationJob.STATUS_PROCESSING);
        when(generationJobMapper.selectList(any()))
                .thenReturn(List.of(noReservation, released));
        when(generationJobMapper.selectForUpdate(13L)).thenReturn(noReservation);
        when(generationJobMapper.selectForUpdate(14L)).thenReturn(released);
        when(costReservationMapper.selectByJobForUpdate(13L)).thenReturn(null);
        CostReservation releasedReservation = activeReservation(14L);
        releasedReservation.setStatus(CostReservationStatus.RELEASED.name());
        when(costReservationMapper.selectByJobForUpdate(14L)).thenReturn(releasedReservation);
        when(assetMapper.selectDistinctStorageKeysByProjectId(1L)).thenReturn(List.of());

        purgeService.purge(locked);

        verifyNoInteractions(costReservationService);
        verify(projectMapper).hardDeleteById(1L);
    }

    @Test
    void purgeMarksOnlyOrphanedStorageObjectsUnreferenced() {
        Project locked = new Project().setOwnerId(10L).setName("A");
        locked.setId(1L);
        when(projectMapper.selectForUpdate(1L)).thenReturn(locked);
        when(generationJobMapper.selectList(any())).thenReturn(List.of());
        when(assetMapper.selectDistinctStorageKeysByProjectId(1L))
                .thenReturn(List.of("orphan.png", "shared.png"));
        when(assetMapper.countAllByStorageKey("orphan.png")).thenReturn(0L);
        when(assetMapper.countAllByStorageKey("shared.png")).thenReturn(1L);

        purgeService.purge(locked);

        verify(storageObjectMapper).markFirstUnreferenced(eq("orphan.png"), any());
        verify(storageObjectMapper, never()).markFirstUnreferenced(eq("shared.png"), any());
    }

    private CostReservation activeReservation(Long jobId) {
        CostReservation reservation = new CostReservation()
                .setGenerationJobId(jobId)
                .setStatus(CostReservationStatus.ACTIVE.name());
        reservation.setId(jobId);
        return reservation;
    }
}
