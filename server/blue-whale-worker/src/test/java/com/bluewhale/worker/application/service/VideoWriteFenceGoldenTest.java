package com.bluewhale.worker.application.service;

import com.bluewhale.worker.application.processor.VideoJobProcessor;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.mapper.StoryboardPreviewMapper;
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

    private JobStateMachineService service;

    @BeforeEach
    void setUp() {
        service = new JobStateMachineService(jobMapper, assetMapper, jobLogMapper,
                projectEventMapper, slotMapper, sceneCardRecordMapper, storyboardPreviewMapper);
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
    @DisplayName("G71: markProviderSubmitted SQL 钉桩——含 provider/progress=1/next_poll_at，无 fencing_token 递增，无非法 INTERVAL")
    void g71_markProviderSubmittedSqlPinned() {
        String sql = updateSqlOf("markProviderSubmitted");
        assertThat(sql)
                .contains("provider = 'new-api'")
                .contains("progress = 1")
                .contains("next_poll_at = #{nextPollAt}")
                .contains("next_action_at = #{nextPollAt}")
                .contains("lease_owner = NULL")
                .contains("version = version + 1")
                .doesNotContain("fencing_token = fencing_token + 1")
                .doesNotContain("MILLISECOND");
    }

    @Test
    @DisplayName("G72: rescheduleProviderPoll 钳制在 Java 侧——150→99、-5→0；SQL 含 last_polled_at/next_poll_at、无 fence bump")
    void g72_rescheduleClampAndSql() {
        String sql = updateSqlOf("rescheduleProviderPoll");
        assertThat(sql)
                .contains("poll_count = COALESCE(poll_count, 0) + 1")
                .contains("last_polled_at = #{now}")
                .contains("next_poll_at = #{nextPollAt}")
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
    @DisplayName("G73: cancelVideoBeforeDispatch 成功不写日志行（video-ops.ts:306-343 无 log），SQL 清 next_poll_at")
    void g73_cancelNoLogRow() {
        assertThat(updateSqlOf("cancelVideoBeforeDispatch")).contains("next_poll_at = NULL");
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

        boolean ok = service.publishVideoResult("300", "42", "9", "w1", 5,
                "https://x/v.mp4", "generated/9/video/abc.mp4", "video/mp4", 123L,
                "0123456789abcdef0123456789abcdef", 1080, 1920, 8.5, null);

        assertThat(ok).isTrue();
        // 单槽 88L 恰好一次，asset 绑定回填 id
        verify(slotMapper).updateSlot(88L, "succeeded", 777L);
        verifyNoInteractions(sceneCardRecordMapper);
        verifyNoInteractions(storyboardPreviewMapper);
    }
}
