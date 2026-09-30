package com.bluewhale.worker.application.service;

import com.bluewhale.worker.application.processor.VideoJobProcessor;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.mapper.StoryboardPreviewMapper;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.GenerationJobExtraEntity;
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

/**
 * 评审修复回归金标（G71-G74，对应 golden-cases.json）：
 * 视频最热写路径的 SQL 全文钉桩 + 参数钳制 + 取消无日志 + publish 单槽条件同步。
 * 背景：C1/C2 漂移之所以存活，因旧镜像测试只写了注释声称覆盖 G09-G11 而零断言——
 * 本文件用 @Update 注解字符串反射钉死 SET 列，SQL 列名任何回退即红。
 */
@ExtendWith(MockitoExtension.class)
class VideoWriteFenceGoldenTest {

    @Mock private GenerationJobMapper jobMapper;
    @Mock private com.bluewhale.worker.infrastructure.mapper.AssetMapper assetMapper;
    @Mock private GenerationJobLogMapper jobLogMapper;
    @Mock private com.bluewhale.worker.infrastructure.mapper.ProjectEventMapper projectEventMapper;
    @Mock private GenerationOutputSlotMapper slotMapper;
    @Mock private SceneCardGenerationRecordMapper sceneCardRecordMapper;
    @Mock private StoryboardPreviewMapper storyboardPreviewMapper;
    /** IKJCOE：任务特有列搬进键值扩展表——终态写路径经此 mapper 续写 charge_state 等。 */
    @Mock private com.bluewhale.worker.infrastructure.mapper.GenerationJobExtraMapper extraMapper;

    private JobStateMachineService service;
    private JobFinalizer finalizer;

    @BeforeEach
    void setUp() {
        service = new JobStateMachineService(jobMapper, assetMapper, jobLogMapper,
                projectEventMapper, slotMapper, sceneCardRecordMapper, storyboardPreviewMapper,
                extraMapper);
        // 终态收口（刀④）：publish 族已从 JobStateMachineService 拆到 JobFinalizer，共享同一组 mapper mock。
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
                // IKJCOE：next_poll_at 列已删，轮询到期时刻只剩 next_action_at 一个落点。
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
        LocalDateTime before = WorkerClock.now();
        service.markProviderSubmitted("300", "w1", 5, "task-9");
        ArgumentCaptor<LocalDateTime> cap = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(jobMapper).markProviderSubmitted(eq(300L), eq("w1"), eq(5L), eq("task-9"), cap.capture());
        assertThat(cap.getValue()).isBetween(before.plusSeconds(4), before.plusSeconds(7));
    }

    @Test
    @DisplayName("G73: cancelVideoBeforeDispatch 成功不写日志行（video-ops.ts:306-343 无 log），SQL 清 next_action_at")
    void g73_cancelNoLogRow() {
        // IKJCOE：原先同时清 next_poll_at + next_action_at；next_poll_at 列已删，
        // 「取消即清轮询到期」现在只剩 next_action_at 一个落点（回退写 next_poll_at 即红）。
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
        job.setProgress(100); // Map.of 不容 null：事件 payload 需要 progress

        GenerationOutputSlotEntity slot = new GenerationOutputSlotEntity();
        slot.setId(88L); slot.setSlotIndex(0);
        slot.setSceneCardGenerationRecordId(null); // 无 FK

        when(jobMapper.publishVideoGuard(300L, "w1", 5L)).thenReturn(1);
        when(slotMapper.findByJobId(300L)).thenReturn(List.of(slot));
        when(jobMapper.selectById(300L)).thenReturn(job);
        // 模拟 MyBatis 自增回填（生产行为）：insert 时写回 asset.id
        doAnswer(inv -> {
            inv.getArgument(0, com.bluewhale.worker.domain.entity.AssetEntity.class).setId(777L);
            return 1;
        }).when(assetMapper).insert(any(com.bluewhale.worker.domain.entity.AssetEntity.class));

        boolean ok = finalizer.publishVideoResult("300", "42", "9", "w1", 5,
                "https://x/v.mp4", "generated/9/video/abc.mp4", "video/mp4", 123L,
                "0123456789abcdef0123456789abcdef", 1080, 1920, 8.5, null);

        assertThat(ok).isTrue();
        // 单槽 88L 恰好一次，asset 绑定回填 id
        verify(slotMapper).updateSlot(88L, "succeeded", 777L);
        verifyNoInteractions(sceneCardRecordMapper);
        verifyNoInteractions(storyboardPreviewMapper);
    }

    @Test
    @DisplayName("G75: publishVideoGuard 不再写搬走的列；普通（非两阶段）视频零扩展位写入")
    void g75_movedColumnsNotInGuardSql() {
        // IKJCOE：upstream_created_at_ms / finalize_deadline_ms / charge_state 搬进
        // generation_job_extras 后，守卫 SQL 必须彻底不碰它们（回退即红）。
        String sql = updateSqlOf("publishVideoGuard");
        assertThat(sql)
                .doesNotContain("upstream_created_at_ms")
                .doesNotContain("finalize_deadline_ms")
                .doesNotContain("charge_state");

        // 非两阶段视频（扩展位无 video_stage）：两列同为 null → 不得写任何扩展位。
        twoStagePublishFixture();
        when(extraMapper.findByJobId(300L)).thenReturn(List.of());

        boolean ok = finalizer.publishVideoResult("300", "42", "9", "w1", 5,
                "https://x/v.mp4", "generated/9/video/abc.mp4", "video/mp4", 123L,
                "0123456789abcdef0123456789abcdef", 1080, 1920, 8.5, null, null, null);

        assertThat(ok).isTrue();
        verify(extraMapper, never()).upsert(anyLong(), anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("G76: 两阶段成片 publish——守卫之外续写 upstream_created_at_ms/finalize_deadline_ms/charge_state=settled")
    void g76_twoStagePublishWritesExtras() {
        twoStagePublishFixture();
        // 两阶段判据 = 扩展位里有 video_stage（IKJCOE：原守卫 SQL 的 IF(video_stage IS NOT NULL)）。
        GenerationJobExtraEntity stage = new GenerationJobExtraEntity();
        stage.setExtraKey("video_stage");
        stage.setValueText("final");
        when(extraMapper.findByJobId(300L)).thenReturn(List.of(stage));

        boolean ok = finalizer.publishVideoResult("300", "42", "9", "w1", 5,
                "https://x/v.mp4", "generated/9/video/abc.mp4", "video/mp4", 123L,
                "0123456789abcdef0123456789abcdef", 1080, 1920, 8.5, null,
                1790647200000L, 1790647800000L);

        assertThat(ok).isTrue();
        verify(extraMapper).upsert(300L, "upstream_created_at_ms", "number", "1790647200000");
        verify(extraMapper).upsert(300L, "finalize_deadline_ms", "number", "1790647800000");
        verify(extraMapper).upsert(300L, "charge_state", "string", "settled");
    }

    @Test
    @DisplayName("G77: 两阶段成片 publish 未带阶段时刻（null）——只落 charge_state，不覆盖既有时刻")
    void g77_twoStagePublishNullTimestampsKeepExisting() {
        twoStagePublishFixture();
        GenerationJobExtraEntity stage = new GenerationJobExtraEntity();
        stage.setExtraKey("video_stage");
        stage.setValueText("final");
        when(extraMapper.findByJobId(300L)).thenReturn(List.of(stage));

        boolean ok = finalizer.publishVideoResult("300", "42", "9", "w1", 5,
                "https://x/v.mp4", "generated/9/video/abc.mp4", "video/mp4", 123L,
                "0123456789abcdef0123456789abcdef", 1080, 1920, 8.5, null, null, null);

        // 原守卫 SQL 的 COALESCE(#{x}, col) 语义：null 不覆盖既有值 → 不写这两个键。
        assertThat(ok).isTrue();
        verify(extraMapper, never())
                .upsert(eq(300L), eq("upstream_created_at_ms"), anyString(), anyString());
        verify(extraMapper, never())
                .upsert(eq(300L), eq("finalize_deadline_ms"), anyString(), anyString());
        verify(extraMapper).upsert(300L, "charge_state", "string", "settled");
    }

    /** G75-G77 共用：可发布视频行的 mapper 打桩（asset 自增 id 回填同 G74）。 */
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
