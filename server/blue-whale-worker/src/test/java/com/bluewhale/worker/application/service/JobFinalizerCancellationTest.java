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
        job.setStatus("cancelled");
        return job;
    }

    @Test
    @DisplayName("★ 取消后发返还事件 —— 不发的话那笔预扣永远冻着")
    void 取消发返还事件() {
        when(jobMapper.selectById(801L)).thenReturn(cancelledJob(801));

        finalizer.releaseHoldForCancelled("801");

        assertThat(sent).hasSize(1);
        assertThat(sent.get(0)[0]).isEqualTo("generation-job-failed");
        assertThat(sent.get(0)[1]).contains("\"jobId\":801").contains("\"userId\":42");
    }

    @Test
    @DisplayName("★ 取不到 job 时只告警不抛 —— 取消本身已经成功了，不该因为发事件失败回滚它")
    void 取不到job不炸() {
        when(jobMapper.selectById(802L)).thenReturn(null);

        finalizer.releaseHoldForCancelled("802");

        assertThat(sent).isEmpty();
    }

    @Test
    @DisplayName("成功状态走这条口子也不发事件（扣款在提交时已完成，成功无账务动作）")
    void 成功状态不发事件() {
        GenerationJobEntity succeeded = cancelledJob(803);
        succeeded.setStatus("succeeded");
        when(jobMapper.selectById(803L)).thenReturn(succeeded);

        finalizer.releaseHoldForCancelled("803");

        assertThat(sent).isEmpty();
    }
}
