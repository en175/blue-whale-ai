package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.ProjectEventMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class JobFinalizerCancellationTest {

    private final List<String[]> sent = new ArrayList<>();

    private final GenerationJobMapper jobMapper = mock(GenerationJobMapper.class);

    private final JobFinalizer finalizer = new JobFinalizer(
            jobMapper,
            mock(AssetMapper.class),
            mock(GenerationJobLogMapper.class),
            mock(GenerationOutputSlotMapper.class),
            mock(GenerationJobExtraMapper.class),
            mock(SceneCardGenerationRecordSync.class),
            mock(StoryboardPreviewSync.class),
            new ProjectEventPublisher(mock(ProjectEventMapper.class)),
            new JobSettlementPublisher(
                    (topic, body) -> sent.add(new String[]{topic, body}),
                    new MockEnvironment()));

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
    @DisplayName("★ 取消后发终态事件 —— 不发的话那笔退款永远发不出去")
    void 取消发终态事件() {
        when(jobMapper.selectById(801L)).thenReturn(cancelledJob(801));

        finalizer.releaseHoldForCancelled("801");

        assertThat(sent).hasSize(1);
        assertThat(sent.get(0)[0]).isEqualTo("generation-job-terminal");
        assertThat(sent.get(0)[1]).contains("\"jobId\":801").contains("\"userId\":42")
                .contains("\"status\":\"cancelled\"");
    }

    @Test
    @DisplayName("★ 取不到 job 时只告警不抛 —— 取消本身已经成功了，不该因为发事件失败回滚它")
    void 取不到job不炸() {
        when(jobMapper.selectById(802L)).thenReturn(null);

        finalizer.releaseHoldForCancelled("802");

        assertThat(sent).isEmpty();
    }

    @Test
    @DisplayName("成功状态走这条口子也发一条终态事件（一个 job 一条）")
    void 成功状态发事件() {
        GenerationJobEntity succeeded = cancelledJob(803);
        succeeded.setStatus("succeeded");
        when(jobMapper.selectById(803L)).thenReturn(succeeded);

        finalizer.releaseHoldForCancelled("803");

        assertThat(sent).hasSize(1);
        assertThat(sent.get(0)[0]).isEqualTo("generation-job-terminal");
        assertThat(sent.get(0)[1]).contains("\"status\":\"succeeded\"");
    }

    @Test
    @DisplayName("★ project_id 为空的任务失败也发终态事件 —— 项目事件跳过，账务事件照发")
    void 空项目也发终态事件() {
        GenerationJobEntity job = cancelledJob(804);
        job.setProjectId(null);
        job.setStatus("failed");
        when(jobMapper.failJobGuard(anyLong(), anyString(), anyLong(), anyString())).thenReturn(1);
        when(jobMapper.selectById(804L)).thenReturn(job);

        finalizer.failJob("804", "upstream_error", "上游挂了", null, "w1", 3L);

        assertThat(sent).hasSize(1);
        assertThat(sent.get(0)[0]).isEqualTo("generation-job-terminal");
        assertThat(sent.get(0)[1]).contains("\"status\":\"failed\"").contains("\"refund\":true");
    }
}
