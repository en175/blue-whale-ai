package com.bluewhale.worker.application.service;

import com.bluewhale.worker.application.processor.VideoJobProcessor;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.StoryboardPreviewMapper;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import org.apache.ibatis.annotations.Update;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.lang.reflect.Method;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class VideoWriteFenceGoldenTest {

    @Mock private GenerationJobMapper jobMapper;
    @Mock private com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper assetMapper;
    @Mock private GenerationJobLogMapper jobLogMapper;
    @Mock private com.bluewhale.worker.infrastructure.persistence.mapper.ProjectEventMapper projectEventMapper;
    @Mock private GenerationOutputSlotMapper slotMapper;
    @Mock private SceneCardGenerationRecordMapper sceneCardRecordMapper;
    @Mock private StoryboardPreviewMapper storyboardPreviewMapper;
    @Mock private com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper extraMapper;

    private JobStateMachineService service;
    private JobFinalizer finalizer;

    @BeforeEach
    void setUp() {
        service = new JobStateMachineService(jobMapper, assetMapper, jobLogMapper,
                projectEventMapper, slotMapper, sceneCardRecordMapper, storyboardPreviewMapper,
                extraMapper);
        ProjectEventPublisher events = new ProjectEventPublisher(projectEventMapper);
        finalizer = new JobFinalizer(jobMapper, assetMapper, jobLogMapper, slotMapper, extraMapper,
                new SceneCardGenerationRecordSync(slotMapper, sceneCardRecordMapper, events),
                new StoryboardPreviewSync(slotMapper, storyboardPreviewMapper, events),
                events,
                JobSettlementPublisher.noop());
    }

    private static String updateSqlOf(String methodName) {
        for (Method m : GenerationJobMapper.class.getDeclaredMethods()) {
            if (m.getName().equals(methodName)) {
                Update ann = m.getDeclaredAnnotation(Update.class);
                assertThat(ann).as("方法 %s 应有 @Update", methodName).isNotNull();
                return String.join(" ", ann.value());
            }
        }
        throw new AssertionError("找不到方法 " + methodName);
    }

    @Test
    @DisplayName("G71: markProviderSubmitted SQL 钉桩——含 provider/progress=1/next_action_at，无 fencing_token 递增，无非法 INTERVAL")
    void g71_markProviderSubmittedSqlPinned() {
        String sql = updateSqlOf("markProviderSubmitted");
        assertThat(sql)
                .contains("status = 'processing'")
                .contains("provider = 'new-api'")
                .contains("provider_task_id = #{providerTaskId}")
                .contains("progress = 1")
                .contains("next_action_at = #{nextActionAt}")
                .contains("lease_owner = NULL")
                .contains("lease_expires_at = NULL")
                .contains("version = version + 1")
                .doesNotContain("next_poll_at")
                .doesNotContain("fencing_token = fencing_token + 1")
                .doesNotContain("MILLISECOND");
    }

    @Test
    @DisplayName("G72: rescheduleProviderPoll 钳制在 Java 侧——150→99、-5→0；SQL 含 last_polled_at/next_action_at、无 fence bump")
    void g72_rescheduleClampAndSql() {
        String sql = updateSqlOf("rescheduleProviderPoll");
        assertThat(sql)
                .contains("poll_count = COALESCE(poll_count, 0) + 1")
                .contains("last_polled_at = #{now}")
                .contains("next_action_at = #{nextActionAt}")
                .contains("lease_owner = NULL")
                .contains("lease_expires_at = NULL")
                .contains("version = version + 1")
                .doesNotContain("next_poll_at")
                .doesNotContain("fencing_token = fencing_token + 1")
                .doesNotContain("MILLISECOND");

        when(jobMapper.rescheduleProviderPoll(eq(300L), eq("w1"), eq(5L), anyInt(), any(), any())).thenReturn(1);
        service.rescheduleProviderPoll("300", "w1", 5, 150);
        service.rescheduleProviderPoll("300", "w1", 5, -5);
        ArgumentCaptor<Integer> cap = ArgumentCaptor.forClass(Integer.class);
        verify(jobMapper, times(2)).rescheduleProviderPoll(eq(300L), eq("w1"), eq(5L), cap.capture(), any(), any());
        assertThat(cap.getAllValues()).containsExactly(99, 0);
    }

    @Test
    @DisplayName("G72b: markProviderSubmitted 时刻参数 = now+5s（Java 计算，非 SQL 函数）")
    void g72b_nextPollAtComputedInJava() {
        when(jobMapper.markProviderSubmitted(eq(300L), eq("w1"), eq(5L), eq("task-9"), any())).thenReturn(1);
        LocalDateTime before = LocalDateTime.now();
        service.markProviderSubmitted("300", "w1", 5, "task-9");
        ArgumentCaptor<LocalDateTime> cap = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(jobMapper).markProviderSubmitted(eq(300L), eq("w1"), eq(5L), eq("task-9"), cap.capture());
        assertThat(cap.getValue()).isBetween(before.plusSeconds(4), before.plusSeconds(7));
    }

    @Test
    @DisplayName("G73: cancelVideoBeforeDispatch 成功不写日志行（video-ops.ts:306-343 无 log），SQL 清 next_action_at")
    void g73_cancelNoLogRow() {
        assertThat(updateSqlOf("cancelVideoBeforeDispatch"))
                .contains("next_action_at = NULL")
                .doesNotContain("next_poll_at");
        when(jobMapper.cancelVideoBeforeDispatch(300L, "w1", 5L)).thenReturn(1);
        assertThat(service.cancelVideoBeforeDispatch("300", "w1", 5)).isTrue();
        verifyNoInteractions(jobLogMapper);
    }

    @Test
    @DisplayName("G74: publishVideoResult 单槽语义——slot 无 record FK 零 summary 回写；绝不触碰 StoryboardPreview（评审 I1/I2）")
    void g74_publishSingleSlotConditionalSync() {
        GenerationJobEntity job = new GenerationJobEntity();
        job.setId(300L); job.setProjectId(42L); job.setType("video");
        job.setSource("bottom_dock"); job.setStatus("succeeded"); job.setVersion(7);
        job.setProgress(100);

        GenerationOutputSlotEntity slot = new GenerationOutputSlotEntity();
        slot.setId(88L); slot.setSlotIndex(0);
        slot.setSceneCardGenerationRecordId(null);

        when(jobMapper.publishVideoGuard(300L, "w1", 5L)).thenReturn(1);
        when(slotMapper.findByJobId(300L)).thenReturn(List.of(slot));
        when(jobMapper.selectById(300L)).thenReturn(job);
        doAnswer(inv -> {
            inv.getArgument(0, com.bluewhale.worker.domain.entity.AssetEntity.class).setId(777L);
            return 1;
        }).when(assetMapper).insert(any(com.bluewhale.worker.domain.entity.AssetEntity.class));

        boolean ok = finalizer.publishVideoResult("300", "42", "9", "w1", 5,
                "https://x/v.mp4", "generated/9/video/abc.mp4", "video/mp4", 123L,
                "0123456789abcdef0123456789abcdef", 1080, 1920, 8.5);

        assertThat(ok).isTrue();
        verify(slotMapper).updateSlot(88L, "succeeded", 777L);
        verifyNoInteractions(sceneCardRecordMapper);
        verifyNoInteractions(storyboardPreviewMapper);
    }

    @Test
    @DisplayName("G75: publishVideoGuard 不再写搬走的列；普通（非两阶段）视频零扩展位写入")
    void g75_movedColumnsNotInGuardSql() {
        String sql = updateSqlOf("publishVideoGuard");
        assertThat(sql)
                .doesNotContain("upstream_created_at_ms")
                .doesNotContain("finalize_deadline_ms")
                .doesNotContain("charge_state");

        twoStagePublishFixture();

        boolean ok = finalizer.publishVideoResult("300", "42", "9", "w1", 5,
                "https://x/v.mp4", "generated/9/video/abc.mp4", "video/mp4", 123L,
                "0123456789abcdef0123456789abcdef", 1080, 1920, 8.5, null, null);

        assertThat(ok).isTrue();
        verify(extraMapper, never()).upsert(anyLong(), anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("G76: 两阶段成片 publish——守卫之外只续写 upstream_created_at_ms/finalize_deadline_ms，不再写 charge_state")
    void g76_twoStagePublishWritesStageTimestampsWithoutChargeState() {
        twoStagePublishFixture();

        boolean ok = finalizer.publishVideoResult("300", "42", "9", "w1", 5,
                "https://x/v.mp4", "generated/9/video/abc.mp4", "video/mp4", 123L,
                "0123456789abcdef0123456789abcdef", 1080, 1920, 8.5,
                1790647200000L, 1790647800000L);

        assertThat(ok).isTrue();
        verify(extraMapper).upsert(300L, "upstream_created_at_ms", "number", "1790647200000");
        verify(extraMapper).upsert(300L, "finalize_deadline_ms", "number", "1790647800000");
        verify(extraMapper, never()).upsert(anyLong(), eq("charge_state"), anyString(), anyString());
    }

    @Test
    @DisplayName("G77: 两阶段成片 publish 未带阶段时刻（null）——不覆盖既有时刻，也不写 charge_state")
    void g77_twoStagePublishNullTimestampsWriteNothing() {
        twoStagePublishFixture();

        boolean ok = finalizer.publishVideoResult("300", "42", "9", "w1", 5,
                "https://x/v.mp4", "generated/9/video/abc.mp4", "video/mp4", 123L,
                "0123456789abcdef0123456789abcdef", 1080, 1920, 8.5, null, null);

        assertThat(ok).isTrue();
        verify(extraMapper, never())
                .upsert(eq(300L), eq("upstream_created_at_ms"), anyString(), anyString());
        verify(extraMapper, never())
                .upsert(eq(300L), eq("finalize_deadline_ms"), anyString(), anyString());
        verify(extraMapper, never()).upsert(anyLong(), eq("charge_state"), anyString(), anyString());
    }

    private void twoStagePublishFixture() {
        GenerationJobEntity job = new GenerationJobEntity();
        job.setId(300L); job.setProjectId(42L); job.setType("video");
        job.setSource("bottom_dock"); job.setStatus("succeeded"); job.setVersion(7);
        job.setProgress(100);
        when(jobMapper.publishVideoGuard(300L, "w1", 5L)).thenReturn(1);
        when(jobMapper.selectById(300L)).thenReturn(job);
        when(slotMapper.findByJobId(300L)).thenReturn(List.of());
        doAnswer(inv -> {
            inv.getArgument(0, com.bluewhale.worker.domain.entity.AssetEntity.class).setId(777L);
            return 1;
        }).when(assetMapper).insert(any(com.bluewhale.worker.domain.entity.AssetEntity.class));
    }
}
