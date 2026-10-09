package com.bluewhale.worker.application.service;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.domain.contract.MediaExtractContract;
import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class JobClaimServiceParentReuseTest {

    private static final int LEASE_SECONDS = 420;

    @Mock
    private GenerationJobMapper jobMapper;

    @Mock
    private GenerationJobExtraMapper extraMapper;

    private JobClaimService service;

    private GenerationJobEntity candidate(String type, Long retryOfJobId) {
        GenerationJobEntity entity = new GenerationJobEntity();
        entity.setId(100L);
        entity.setProjectId(42L);
        entity.setUserId(9L);
        entity.setType(type);
        entity.setStatus("processing");
        entity.setFencingToken(5L);
        entity.setRetryOfJobId(retryOfJobId);
        return entity;
    }

    private ClaimSpec mediaExtractSpec() {
        return ClaimSpec.typeOnly(MediaExtractContract.TAG, LEASE_SECONDS, jobMapper,
                jobMapper::claimMediaExtractCas);
    }

    private ClaimSpec videoMattingSpec() {
        return ClaimSpec.bySources(VideoMattingContract.TAG, LEASE_SECONDS,
                List.of(VideoMattingContract.SOURCE), jobMapper);
    }

    @Test
    @DisplayName("media_extract：retry job claim 二次查父任务并投影 provider_task_id")
    void mediaExtractRetryJobProjectsParentProviderTaskId() {
        service = new JobClaimService(jobMapper, extraMapper);
        when(jobMapper.findCandidateByTypeOnly(100L, MediaExtractContract.TAG))
                .thenReturn(candidate(MediaExtractContract.TAG, 999L));
        when(jobMapper.claimMediaExtractCas(eq(100L), anyString(), any(), anyLong(), anyString()))
                .thenReturn(1);
        when(jobMapper.findProviderTaskId(999L)).thenReturn("parent-task-1");

        Optional<ClaimedJob> claimed =
                service.claim(mediaExtractSpec(), "100", "worker-1");

        assertThat(claimed).isPresent();
        assertThat(claimed.get().parentProviderTaskId()).isEqualTo("parent-task-1");
        verify(jobMapper).findProviderTaskId(999L);
    }

    @Test
    @DisplayName("media_extract：非重试 job 不查父任务，投影恒 null")
    void mediaExtractNonRetryJobSkipsParentLookup() {
        service = new JobClaimService(jobMapper, extraMapper);
        when(jobMapper.findCandidateByTypeOnly(100L, MediaExtractContract.TAG))
                .thenReturn(candidate(MediaExtractContract.TAG, null));
        when(jobMapper.claimMediaExtractCas(eq(100L), anyString(), any(), anyLong(), anyString()))
                .thenReturn(1);

        Optional<ClaimedJob> claimed =
                service.claim(mediaExtractSpec(), "100", "worker-1");

        assertThat(claimed).isPresent();
        assertThat(claimed.get().parentProviderTaskId()).isNull();
        verify(jobMapper, never()).findProviderTaskId(anyLong());
    }

    @Test
    @DisplayName("video_matting：套白名单路径同样经过共享投影实现")
    void videoMattingRetryJobProjectsParentProviderTaskId() {
        service = new JobClaimService(jobMapper, extraMapper);
        when(jobMapper.findCandidateByTypeAndSources(
                eq(100L), eq(VideoMattingContract.TAG), any()))
                .thenReturn(candidate(VideoMattingContract.TAG, 777L));
        when(jobMapper.claimImageCas(eq(100L), anyString(), any(), anyLong(), anyString()))
                .thenReturn(1);
        when(jobMapper.findProviderTaskId(777L)).thenReturn("parent-task-2");

        Optional<ClaimedJob> claimed =
                service.claim(videoMattingSpec(), "100", "worker-1");

        assertThat(claimed).isPresent();
        assertThat(claimed.get().parentProviderTaskId()).isEqualTo("parent-task-2");
        assertThat(claimed.get().type()).isEqualTo(VideoMattingContract.TAG);
        verify(jobMapper).findProviderTaskId(777L);
    }
}
