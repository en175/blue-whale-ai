package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.GenerationJobLogEntity;
import com.bluewhale.worker.domain.entity.GenerationOutboxEntity;
import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.infrastructure.mq.BillingEventPublisher;
import com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutboxMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.ProjectEventMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.env.MockEnvironment;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class JobFinalizerTerminalTest {

    private final List<GenerationOutboxEntity> outboxRows = new ArrayList<>();

    private final GenerationJobMapper jobMapper = mock(GenerationJobMapper.class);

    private final GenerationOutboxMapper outboxMapper = mock(GenerationOutboxMapper.class);

    private final GenerationJobLogMapper logMapper = mock(GenerationJobLogMapper.class);

    private final GenerationOutputSlotMapper slotMapper = mock(GenerationOutputSlotMapper.class);

    private final JobFinalizer finalizer = new JobFinalizer(
            jobMapper,
            mock(AssetMapper.class),
            logMapper,
            slotMapper,
            mock(GenerationJobExtraMapper.class),
            mock(SceneCardGenerationRecordSync.class),
            mock(StoryboardPreviewSync.class),
            new ProjectEventPublisher(mock(ProjectEventMapper.class)),
            new TerminalEventOutbox(outboxMapper, jobMapper, BillingEventPublisher.noop(),
                    new MockEnvironment()));

    @BeforeEach
    void captureOutboxRows() {
        when(outboxMapper.insert(any(GenerationOutboxEntity.class))).thenAnswer(invocation -> {
            GenerationOutboxEntity row = invocation.getArgument(0);
            outboxRows.add(row);
            return 1;
        });
    }

    private static GenerationJobEntity cancelledJob(long id) {
        GenerationJobEntity job = new GenerationJobEntity();
        job.setId(id);
        job.setUserId(42L);
        job.setProjectId(7L);
        job.setType("video");
        job.setSource("bottom_dock");
        job.setProgress(0);
        job.setStatus("cancelled");
        return job;
    }

    @Test
    @DisplayName("★ 取消后落一条待发终态事件 —— 不落的话那笔退款永远发不出去")
    void 取消落发件箱行() {
        when(jobMapper.selectById(801L)).thenReturn(cancelledJob(801));

        finalizer.cancelJob("801");

        assertThat(outboxRows).hasSize(1);
        GenerationOutboxEntity row = outboxRows.get(0);
        assertThat(row.getJobId()).isEqualTo(801L);
        assertThat(row.getUserId()).isEqualTo(42L);
        assertThat(row.getTerminalStatus()).isEqualTo("cancelled");
        assertThat(row.getReason()).isEqualTo("用户取消");
        assertThat(row.getSendState()).isEqualTo(GenerationOutboxEntity.STATE_PENDING);
    }

    @Test
    @DisplayName("★ 取不到 job 时只告警不抛 —— 取消本身已经成功了，不该因为落事件失败回滚它")
    void 取不到job不炸() {
        when(jobMapper.selectById(802L)).thenReturn(null);

        finalizer.cancelJob("802");

        assertThat(outboxRows).isEmpty();
    }

    @Test
    @DisplayName("成功状态走这条口子也落一行（一个 job 一条）")
    void 成功状态落行() {
        GenerationJobEntity succeeded = cancelledJob(803);
        succeeded.setStatus("succeeded");
        when(jobMapper.selectById(803L)).thenReturn(succeeded);

        finalizer.cancelJob("803");

        assertThat(outboxRows).hasSize(1);
        assertThat(outboxRows.get(0).getTerminalStatus()).isEqualTo("succeeded");
    }

    @Test
    @DisplayName("★ project_id 为空的任务失败也落行 —— 项目事件跳过，账务事件照发")
    void 空项目也落行() {
        GenerationJobEntity job = cancelledJob(804);
        job.setProjectId(null);
        job.setStatus("failed");
        when(jobMapper.failJobGuard(anyLong(), anyString(), anyLong(), anyString())).thenReturn(1);
        when(jobMapper.selectById(804L)).thenReturn(job);

        finalizer.failJob("804", "upstream_error", "上游挂了", null, "w1", 3L);

        assertThat(outboxRows).hasSize(1);
        assertThat(outboxRows.get(0).getTerminalStatus()).isEqualTo("failed");
        assertThat(outboxRows.get(0).getReason()).isEqualTo("上游挂了");
    }

    @Test
    @DisplayName("★ 超期收口与失败同形：终态 failed + 原因「任务执行超时」")
    void 超期落行() {
        when(jobMapper.expireJobGuard(anyLong(), anyString())).thenReturn(1);
        GenerationJobEntity job = cancelledJob(806);
        job.setStatus("failed");
        when(jobMapper.selectById(806L)).thenReturn(job);

        assertThat(finalizer.expireJob("806")).isTrue();

        assertThat(outboxRows).hasSize(1);
        assertThat(outboxRows.get(0).getTerminalStatus()).isEqualTo("failed");
        assertThat(outboxRows.get(0).getReason()).isEqualTo("任务执行超时");
    }

    @Test
    @DisplayName("超期收口守未命中（已被别人收口）→ 不落行")
    void 超期守卫未命中不落行() {
        when(jobMapper.expireJobGuard(anyLong(), anyString())).thenReturn(0);

        assertThat(finalizer.expireJob("807")).isFalse();

        assertThat(outboxRows).isEmpty();
    }

    @Test
    @DisplayName("★ 取消把未决输出槽置 failed、写一条取消日志，并落终态事件")
    void 取消收口槽位与日志() {
        GenerationOutputSlotEntity slot = new GenerationOutputSlotEntity();
        slot.setId(55L);
        slot.setSlotIndex(0);
        when(jobMapper.selectById(805L)).thenReturn(cancelledJob(805));
        when(slotMapper.findPendingByJobId(805L)).thenReturn(List.of(slot));

        finalizer.cancelJob("805");

        verify(slotMapper).updateSlotStatus(55L, "failed");
        ArgumentCaptor<GenerationJobLogEntity> logCaptor =
                ArgumentCaptor.forClass(GenerationJobLogEntity.class);
        verify(logMapper).insert(logCaptor.capture());
        assertThat(logCaptor.getValue().getMessage()).isEqualTo("用户取消");
        assertThat(outboxRows).hasSize(1);
    }
}
