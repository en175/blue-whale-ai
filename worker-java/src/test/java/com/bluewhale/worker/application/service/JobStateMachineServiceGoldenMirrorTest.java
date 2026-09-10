package com.bluewhale.worker.application.service;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.ProjectEventEntity;
import com.bluewhale.worker.domain.entity.GenerationJobLogEntity;
import com.bluewhale.worker.domain.dto.ClaimedMediaExtractJobDto;
import com.bluewhale.worker.domain.dto.UpdateMediaExtractProgressDto;
import com.bluewhale.worker.domain.dto.PublishMediaExtractDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.ProjectEventMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobLogMapper;

import com.bluewhale.worker.infrastructure.mapper.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 金标用例镜像测试（docs/specs/2026-09-10-ikensz-golden-cases.json）。
 * <p>
 * 用 mocked Mappers 驱动服务，断言生成的 SQL 参数（where 字段、SET 字段、钳制、token 投影等）。
 * <p>
 * 覆盖用例：
 * - G05：孤儿接管（processing + lease_expires_at=null）
 * - G18：进度钳制 150→99 与 -5→0
 * - G19：进度续租 lease_expires_at≈now+120s
 * <p>
 * 延迟用例（刀① 覆盖）：
 * - G01-G04：claimNextJob/claimJobById 通用模式（video/image 路径）
 * - G07：claimNextJob catch-swallow（TS-only，by-id 变体无 catch 按契约 §3.1 不对称）
 * - G08-G11：markVideoSubmitted/rescheduleVideoPoll（video 路径）
 * - G12-G13：cancelVideoBeforeDispatch（video 路径）
 * - G14-G16：requeueImageJobForRetry（image 路径）
 * - G17：completeJob（通用模式，publishMediaExtractResult 已覆盖事务模式）
 */
@ExtendWith(MockitoExtension.class)
class JobStateMachineServiceGoldenMirrorTest {

    private static final ObjectMapper JSON_MAPPER = new ObjectMapper();

    @Mock
    private GenerationJobMapper jobMapper;

    @Mock
    private AssetMapper assetMapper;

    @Mock
    private GenerationJobLogMapper jobLogMapper;

    @Mock
    private ProjectEventMapper projectEventMapper;

    private JobStateMachineService service;

    @BeforeEach
    void setUp() {
        service = new JobStateMachineService(jobMapper, assetMapper, jobLogMapper, projectEventMapper);
    }

    @Test
    @DisplayName("G05: 孤儿接管（processing + lease_expires_at=null）")
    void g05_orphanTakeover() {
        // given: 候选行 status='processing', lease_expires_at=null, fencing_token=4
        GenerationJobEntity candidate = new GenerationJobEntity();
        candidate.setId(300L);
        candidate.setProjectId(42L);
        candidate.setUserId(9L);
        candidate.setType("media_extract");
        candidate.setStatus("processing");
        candidate.setFencingToken(4L);
        candidate.setLeaseExpiresAt(null); // 孤儿
        candidate.setInput("{\"videoUrl\":\"https://example.com/video.mp4\"}");

        when(jobMapper.findMediaExtractCandidate(300L)).thenReturn(candidate);
        when(jobMapper.claimMediaExtractCas(
                eq(300L),
                eq("worker-1"),
                any(LocalDateTime.class),
                eq(4L),
                eq("processing")
        )).thenReturn(1);

        // when
        Optional<ClaimedMediaExtractJobDto> result = service.claimMediaExtract("300", "worker-1");

        // then
        assertThat(result).isPresent();
        ClaimedMediaExtractJobDto claimed = result.get();
        assertThat(claimed.fencingToken()).isEqualTo(5L); // 增后 token = 4 + 1

        // 断言 CAS where 含 status='processing'（不强制 queued）
        verify(jobMapper).claimMediaExtractCas(
                eq(300L),
                eq("worker-1"),
                any(LocalDateTime.class),
                eq(4L),
                eq("processing") // G05 关键断言：孤儿接管用 processing 而非 queued
        );
    }

    @Test
    @DisplayName("G18: 进度钳制 150→99 与 -5→0")
    void g18_progressClamping() {
        // given: input progress=150 和 progress=-5 各一次; updateMany 返回 count=1
        when(jobMapper.updateMediaExtractProgress(
                eq(300L),
                eq("worker-1"),
                eq(5L),
                eq(99), // 钳制后
                any(LocalDateTime.class)
        )).thenReturn(1);

        when(jobMapper.updateMediaExtractProgress(
                eq(300L),
                eq("worker-1"),
                eq(5L),
                eq(0), // 钳制后
                any(LocalDateTime.class)
        )).thenReturn(1);

        // when: progress=150
        boolean result1 = service.updateMediaExtractProgress(
                new UpdateMediaExtractProgressDto("300", "worker-1", 5L, 150)
        );

        // when: progress=-5
        boolean result2 = service.updateMediaExtractProgress(
                new UpdateMediaExtractProgressDto("300", "worker-1", 5L, -5)
        );

        // then
        assertThat(result1).isTrue();
        assertThat(result2).isTrue();

        // 断言 data.progress 分别被钳制为 99 和 0
        ArgumentCaptor<Integer> progressCaptor = ArgumentCaptor.forClass(Integer.class);
        verify(jobMapper, times(2)).updateMediaExtractProgress(
                anyLong(),
                anyString(),
                anyLong(),
                progressCaptor.capture(),
                any(LocalDateTime.class)
        );

        assertThat(progressCaptor.getAllValues()).containsExactly(99, 0);
    }

    @Test
    @DisplayName("G19: 进度续租 lease_expires_at≈now+120s")
    void g19_progressLeaseRenewal() {
        // given: input progress=50; IMAGE_JOB_LEASE_SECONDS=120
        when(jobMapper.updateMediaExtractProgress(
                eq(300L),
                eq("worker-1"),
                eq(5L),
                eq(50),
                any(LocalDateTime.class)
        )).thenReturn(1);

        // when
        LocalDateTime before = LocalDateTime.now().plusSeconds(119);
        boolean result = service.updateMediaExtractProgress(
                new UpdateMediaExtractProgressDto("300", "worker-1", 5L, 50)
        );
        LocalDateTime after = LocalDateTime.now().plusSeconds(121);

        // then
        assertThat(result).isTrue();

        // 断言 data.lease_expires_at≈now+120s（窗口断言）
        ArgumentCaptor<LocalDateTime> leaseCaptor = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(jobMapper).updateMediaExtractProgress(
                anyLong(),
                anyString(),
                anyLong(),
                anyInt(),
                leaseCaptor.capture()
        );

        LocalDateTime capturedLease = leaseCaptor.getValue();
        assertThat(capturedLease).isAfter(before);
        assertThat(capturedLease).isBefore(after);
    }

    @Test
    @DisplayName("claimMediaExtract: no candidate → empty")
    void claimMediaExtract_noCandidate() {
        when(jobMapper.findMediaExtractCandidate(300L)).thenReturn(null);

        Optional<ClaimedMediaExtractJobDto> result = service.claimMediaExtract("300", "worker-1");

        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("claimMediaExtract: CAS rejected → empty")
    void claimMediaExtract_casRejected() {
        GenerationJobEntity candidate = new GenerationJobEntity();
        candidate.setId(300L);
        candidate.setFencingToken(4L);
        candidate.setStatus("queued");

        when(jobMapper.findMediaExtractCandidate(300L)).thenReturn(candidate);
        when(jobMapper.claimMediaExtractCas(
                eq(300L),
                eq("worker-1"),
                any(LocalDateTime.class),
                eq(4L),
                eq("queued")
        )).thenReturn(0); // CAS rejected

        Optional<ClaimedMediaExtractJobDto> result = service.claimMediaExtract("300", "worker-1");

        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("updateMediaExtractProgress: stale token → false")
    void updateMediaExtractProgress_staleToken() {
        when(jobMapper.updateMediaExtractProgress(
                anyLong(),
                anyString(),
                anyLong(),
                anyInt(),
                any(LocalDateTime.class)
        )).thenReturn(0); // guard fail

        boolean result = service.updateMediaExtractProgress(
                new UpdateMediaExtractProgressDto("300", "worker-1", 5L, 50)
        );

        assertThat(result).isFalse();
    }

    @Test
    @DisplayName("publishMediaExtractResult: happy path with asset + logs + events")
    void publishMediaExtractResult_happyPath() {
        // given
        when(jobMapper.publishMediaExtractGuard(anyLong(), anyString(), anyLong())).thenReturn(1);

        when(assetMapper.insert(any(AssetEntity.class))).thenAnswer(invocation -> {
            AssetEntity asset = (AssetEntity) invocation.getArgument(0);
            asset.setId(999L); // 模拟 DB 自增
            return 1;
        });

        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "media_extract", "succeeded", 100));
        when(projectEventMapper.nextCursor(42L)).thenReturn(1L);

        PublishMediaExtractDto input = new PublishMediaExtractDto(
                "300", "42", "9", "worker-1", 5L,
                "https://example.com/audio.mp3", "media-extract/abc123.mp3",
                "audio/mpeg", 1024L, 12.5
        );

        // when
        boolean result = service.publishMediaExtractResult(input);

        // then
        assertThat(result).isTrue();

        // 断言 asset 插入
        ArgumentCaptor<AssetEntity> assetCaptor = ArgumentCaptor.forClass(AssetEntity.class);
        verify(assetMapper).insert(assetCaptor.capture());
        AssetEntity capturedAsset = assetCaptor.getValue();
        assertThat(capturedAsset.getType()).isEqualTo("audio");
        assertThat(capturedAsset.getDurationMs()).isEqualTo(12500); // 12.5s * 1000

        // 断言 output_asset_ids 更新
        verify(jobMapper).updateOutputAssetIds(300L, "[999]");

        // 断言 log 插入
        ArgumentCaptor<GenerationJobLogEntity> logCaptor = ArgumentCaptor.forClass(GenerationJobLogEntity.class);
        verify(jobLogMapper).insert(logCaptor.capture());
        GenerationJobLogEntity capturedLog = logCaptor.getValue();
        assertThat(capturedLog.getEvent()).isEqualTo("succeeded");
        assertThat(capturedLog.getMessage()).isEqualTo("音频已提取");

        // 断言 project_events 插入（asset.created + generation_job.status_changed）
        ArgumentCaptor<ProjectEventEntity> eventCaptor = ArgumentCaptor.forClass(ProjectEventEntity.class);
        verify(projectEventMapper, times(2)).insert(eventCaptor.capture());
    }

    @Test
    @DisplayName("publishMediaExtractResult: stale token → false")
    void publishMediaExtractResult_staleToken() {
        when(jobMapper.publishMediaExtractGuard(anyLong(), anyString(), anyLong())).thenReturn(0);

        PublishMediaExtractDto input = new PublishMediaExtractDto(
                "300", "42", "9", "worker-1", 5L,
                "https://example.com/audio.mp3", "media-extract/abc123.mp3",
                "audio/mpeg", 1024L, 12.5
        );

        boolean result = service.publishMediaExtractResult(input);

        assertThat(result).isFalse();
        verify(assetMapper, never()).insert(any(AssetEntity.class));
    }

    @Test
    @DisplayName("failMediaExtractJob: happy path with logs + events")
    void failMediaExtractJob_happyPath() {
        // given
        when(jobMapper.failMediaExtractGuard(anyLong(), anyString(), anyLong(), anyString())).thenReturn(1);
        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "media_extract", "failed", 0));
        when(projectEventMapper.nextCursor(42L)).thenReturn(1L);

        FailMediaExtractDto input = new FailMediaExtractDto(
                "300", "worker-1", 5L,
                "media_extract_failed", "FFmpeg 退出码 1",
                Map.of("stderr", "some error")
        );

        // when
        boolean result = service.failMediaExtractJob(input);

        // then
        assertThat(result).isTrue();

        // 断言 error JSON 含 details
        ArgumentCaptor<String> errorJsonCaptor = ArgumentCaptor.forClass(String.class);
        verify(jobMapper).failMediaExtractGuard(
                anyLong(),
                anyString(),
                anyLong(),
                errorJsonCaptor.capture()
        );
        String errorJson = errorJsonCaptor.getValue();
        assertThat(errorJson).contains("\"code\":\"media_extract_failed\"");
        assertThat(errorJson).contains("\"message\":\"FFmpeg 退出码 1\"");
        assertThat(errorJson).contains("\"details\"");

        // 断言 log 插入
        ArgumentCaptor<GenerationJobLogEntity> logCaptor = ArgumentCaptor.forClass(GenerationJobLogEntity.class);
        verify(jobLogMapper).insert(logCaptor.capture());
        GenerationJobLogEntity capturedLog = logCaptor.getValue();
        assertThat(capturedLog.getEvent()).isEqualTo("failed");
        assertThat(capturedLog.getMessage()).isEqualTo("media_extract_failed: FFmpeg 退出码 1");

        // 断言 project_events 插入（generation_job.status_changed）
        ArgumentCaptor<ProjectEventEntity> eventCaptor = ArgumentCaptor.forClass(ProjectEventEntity.class);
        verify(projectEventMapper, times(1)).insert(eventCaptor.capture());
    }

    @Test
    @DisplayName("failMediaExtractJob: stale token → false")
    void failMediaExtractJob_staleToken() {
        when(jobMapper.failMediaExtractGuard(anyLong(), anyString(), anyLong(), anyString())).thenReturn(0);

        FailMediaExtractDto input = new FailMediaExtractDto(
                "300", "worker-1", 5L,
                "media_extract_failed", "FFmpeg 退出码 1",
                null
        );

        boolean result = service.failMediaExtractJob(input);

        assertThat(result).isFalse();
        verify(jobLogMapper, never()).insert(any(GenerationJobLogEntity.class));
    }

    private GenerationJobEntity createJob(Long id, Long projectId, String type, String status, int progress) {
        GenerationJobEntity job = new GenerationJobEntity();
        job.setId(id);
        job.setProjectId(projectId);
        job.setType(type);
        job.setStatus(status);
        job.setProgress(progress);
        job.setSource("dock");
        job.setVersion(1);
        return job;
    }
}
