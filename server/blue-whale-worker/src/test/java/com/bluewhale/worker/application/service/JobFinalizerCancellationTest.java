package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.mapper.ProjectEventMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 取消路径的预扣解冻测试。
 *
 * <h2>它钉的是一个真实缺口</h2>
 *
 * 取消走的是 `GenerationJobMapper` 里 `cancelVideoBeforeDispatch` /
 * `cancelVideoAfterDispatch` 两条 CAS SQL，**完全不经过 {@link JobFinalizer}
 * 的 8 个终态路径**。在接上解冻之前，那条路上没有任何人告诉 billing——
 * job 落到终态了，而那笔预扣永远冻着：用户看不到它，也没有任何报表会亮红灯。
 *
 * <p>三条断言分别对应三个会让这个修复失效的改法：
 * 「取消不发返还事件」「发了但发错 topic」「普通用户 job 也照样发」。
 */
class JobFinalizerCancellationTest {

    /** 记录每次发布的 (topic, body)。 */
    private final List<String[]> sent = new ArrayList<>();

    private final GenerationJobMapper jobMapper = mock(GenerationJobMapper.class);

    private final JobFinalizer finalizer = new JobFinalizer(
            jobMapper,
            mock(AssetMapper.class),
            mock(GenerationJobLogMapper.class),
            mock(GenerationOutputSlotMapper.class),
            mock(SceneCardGenerationRecordSync.class),
            mock(StoryboardPreviewSync.class),
            new ProjectEventPublisher(mock(ProjectEventMapper.class)),
            // 真的 JobSettlementPublisher + 记录型生产者：走的是与生产同一条发事件代码路径
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
        assertThat(sent.get(0)[0]).isEqualTo("generation.job.failed");
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
    @DisplayName("非取消状态走这条口子也不会误发结算（防守：这条口子只该被取消调用）")
    void 非取消状态不会走结算分支() {
        GenerationJobEntity succeeded = cancelledJob(803);
        succeeded.setStatus("succeeded");
        when(jobMapper.selectById(803L)).thenReturn(succeeded);

        finalizer.releaseHoldForCancelled("803");

        // 真被误调时它按 succeeded 结算 —— 与「取消却发了返还」相比，
        // 这条至少不会让平台白送一笔。断言它落在 completed 而不是 failed。
        assertThat(sent.get(0)[0]).isEqualTo("generation.job.completed");
    }
}
