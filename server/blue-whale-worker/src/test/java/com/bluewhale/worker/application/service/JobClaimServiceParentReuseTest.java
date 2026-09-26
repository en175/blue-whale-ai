package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.ClaimedVideoMattingJobDto;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * claim 侧父任务投影直测（IKI8GN 收敛票补测；规格处理器级接缝之外的空白，见 IKI89I
 * 8 票综合审查跨票共性第 2 条留痕）。
 * <p>
 * 覆盖：retry job（retry_of_job_id 非空）claim 时经共享私有方法
 * {@code projectParentProviderTaskId} 二次查询父任务 provider_task_id 并投影进 DTO；
 * 非重试 job 不触发父任务查询（DTO 投影恒 null）。路径交叉验证：media_extract
 * （claimPollingAudioJob 共享生命周期）与 video_matting（独立 claim 方法）两条不同
 * claim 路径都经过同一收敛实现。
 */
@ExtendWith(MockitoExtension.class)
class JobClaimServiceParentReuseTest {

    @Mock
    private GenerationJobMapper jobMapper;

    private JobClaimService service;

    private GenerationJobEntity candidate(Long retryOfJobId) {
        GenerationJobEntity entity = new GenerationJobEntity();
        entity.setId(100L);
        entity.setProjectId(42L);
        entity.setUserId(9L);
        entity.setStatus("processing");
        entity.setFencingToken(5L);
        entity.setRetryOfJobId(retryOfJobId);
        return entity;
    }

    @Test
    @DisplayName("media_extract：retry job claim 二次查父任务并投影 provider_task_id")
    void mediaExtractRetryJobProjectsParentProviderTaskId() {
        service = new JobClaimService(jobMapper);
        when(jobMapper.findMediaExtractCandidate(100L)).thenReturn(candidate(999L));
        when(jobMapper.claimMediaExtractCas(eq(100L), anyString(), any(), anyLong(), anyString()))
                .thenReturn(1);
        when(jobMapper.findProviderTaskId(999L)).thenReturn("parent-task-1");

        Optional<ClaimedMediaExtractJobDto> claimed =
                service.claimMediaExtract("100", "worker-1");

        assertThat(claimed).isPresent();
        assertThat(claimed.get().parentProviderTaskId()).isEqualTo("parent-task-1");
        verify(jobMapper).findProviderTaskId(999L);
    }

    @Test
    @DisplayName("media_extract：非重试 job 不查父任务，投影恒 null")
    void mediaExtractNonRetryJobSkipsParentLookup() {
        service = new JobClaimService(jobMapper);
        when(jobMapper.findMediaExtractCandidate(100L)).thenReturn(candidate(null));
        when(jobMapper.claimMediaExtractCas(eq(100L), anyString(), any(), anyLong(), anyString()))
                .thenReturn(1);

        Optional<ClaimedMediaExtractJobDto> claimed =
                service.claimMediaExtract("100", "worker-1");

        assertThat(claimed).isPresent();
        assertThat(claimed.get().parentProviderTaskId()).isNull();
        verify(jobMapper, never()).findProviderTaskId(anyLong());
    }

    @Test
    @DisplayName("video_matting：独立 claim 路径同样经过共享投影实现")
    void videoMattingRetryJobProjectsParentProviderTaskId() {
        service = new JobClaimService(jobMapper);
        when(jobMapper.findCandidateByTypeAndSources(
                eq(100L), eq("video_matting"), any())).thenReturn(candidate(777L));
        when(jobMapper.claimImageCas(eq(100L), anyString(), any(), anyLong(), anyString()))
                .thenReturn(1);
        when(jobMapper.findProviderTaskId(777L)).thenReturn("parent-task-2");

        Optional<ClaimedVideoMattingJobDto> claimed =
                service.claimVideoMatting("100", "worker-1");

        assertThat(claimed).isPresent();
        assertThat(claimed.get().parentProviderTaskId()).isEqualTo("parent-task-2");
        verify(jobMapper).findProviderTaskId(777L);
    }
}
