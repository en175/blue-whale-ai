package com.bluewhale.worker.application.service;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.domain.contract.AudioTrimContract;
import com.bluewhale.worker.domain.contract.MediaExtractContract;
import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.ProjectEventEntity;
import com.bluewhale.worker.domain.entity.GenerationJobLogEntity;
import com.bluewhale.worker.domain.entity.GenerationOutputSlotEntity;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.dto.UpdateMediaExtractProgressDto;
import com.bluewhale.worker.domain.dto.PublishMediaExtractDto;
import com.bluewhale.worker.domain.dto.PublishVideoSceneSplitDto;
import com.bluewhale.worker.domain.dto.PublishVideoFrameInterpolationDto;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.ProjectEventMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationOutputSlotMapper;

import com.bluewhale.worker.domain.entity.SceneCardGenerationRecordEntity;
import com.bluewhale.worker.domain.entity.StoryboardPreviewEntity;
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
import java.util.List;
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
 * - G08-G11：markProviderSubmitted/rescheduleProviderPoll（video 路径）
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

    @Mock
    private GenerationOutputSlotMapper slotMapper;

    @Mock
    private SceneCardGenerationRecordMapper sceneCardRecordMapper;

    @Mock
    private StoryboardPreviewMapper storyboardPreviewMapper;

    private JobStateMachineService service;

    /** 工具族领取管道（IKIWP8）：与 service 共用同一个被 mock 的 jobMapper。 */
    private JobClaimService claimService;

    @BeforeEach
    void setUp() {
        service = new JobStateMachineService(jobMapper, assetMapper, jobLogMapper,
                projectEventMapper, slotMapper, sceneCardRecordMapper, storyboardPreviewMapper);
        claimService = new JobClaimService(jobMapper);
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

        when(jobMapper.findCandidateByTypeOnly(300L, "media_extract")).thenReturn(candidate);
        when(jobMapper.claimMediaExtractCas(
                eq(300L),
                eq("worker-1"),
                any(LocalDateTime.class),
                eq(4L),
                eq("processing")
        )).thenReturn(1);

        // when
        Optional<ClaimedJob> result = claimService.claim(
                ClaimSpec.typeOnly(MediaExtractContract.TAG, 420, jobMapper,
                        jobMapper::claimMediaExtractCas),
                "300", "worker-1");

        // then
        assertThat(result).isPresent();
        ClaimedJob claimed = result.get();
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
        LocalDateTime before = WorkerClock.now().plusSeconds(119);
        boolean result = service.updateMediaExtractProgress(
                new UpdateMediaExtractProgressDto("300", "worker-1", 5L, 50)
        );
        LocalDateTime after = WorkerClock.now().plusSeconds(121);

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
        when(jobMapper.findCandidateByTypeOnly(300L, "media_extract")).thenReturn(null);

        Optional<ClaimedJob> result = claimService.claim(
                ClaimSpec.typeOnly(MediaExtractContract.TAG, 420, jobMapper,
                        jobMapper::claimMediaExtractCas),
                "300", "worker-1");

        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("claimMediaExtract: CAS rejected → empty")
    void claimMediaExtract_casRejected() {
        GenerationJobEntity candidate = new GenerationJobEntity();
        candidate.setId(300L);
        candidate.setFencingToken(4L);
        candidate.setStatus("queued");

        when(jobMapper.findCandidateByTypeOnly(300L, "media_extract")).thenReturn(candidate);
        when(jobMapper.claimMediaExtractCas(
                eq(300L),
                eq("worker-1"),
                any(LocalDateTime.class),
                eq(4L),
                eq("queued")
        )).thenReturn(0); // CAS rejected

        Optional<ClaimedJob> result = claimService.claim(
                ClaimSpec.typeOnly(MediaExtractContract.TAG, 420, jobMapper,
                        jobMapper::claimMediaExtractCas),
                "300", "worker-1");

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
        when(jobMapper.publishResultGuard(anyLong(), anyString(), anyLong())).thenReturn(1);

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
                "audio/mpeg", 1024L, "0123456789abcdef0123456789abcdef", 12.5
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
        when(jobMapper.publishResultGuard(anyLong(), anyString(), anyLong())).thenReturn(0);

        PublishMediaExtractDto input = new PublishMediaExtractDto(
                "300", "42", "9", "worker-1", 5L,
                "https://example.com/audio.mp3", "media-extract/abc123.mp3",
                "audio/mpeg", 1024L, "0123456789abcdef0123456789abcdef", 12.5
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

    // ========== audio_trim golden mirrors（IKHB6S；media_extract 条目一对一平移） ==========

    @Test
    @DisplayName("claimAudioTrim: no candidate → empty")
    void claimAudioTrim_noCandidate() {
        when(jobMapper.findCandidateByTypeOnly(300L, "audio_trim")).thenReturn(null);

        Optional<ClaimedJob> result = claimService.claim(
                ClaimSpec.typeOnly(AudioTrimContract.TAG, 420, jobMapper),
                "300", "worker-1");

        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("claimAudioTrim: CAS rejected → empty")
    void claimAudioTrim_casRejected() {
        GenerationJobEntity candidate = new GenerationJobEntity();
        candidate.setId(300L);
        candidate.setFencingToken(4L);
        candidate.setStatus("queued");

        when(jobMapper.findCandidateByTypeOnly(300L, "audio_trim")).thenReturn(candidate);
        when(jobMapper.claimImageCas(
                eq(300L),
                eq("worker-1"),
                any(LocalDateTime.class),
                eq(4L),
                eq("queued")
        )).thenReturn(0); // CAS rejected

        Optional<ClaimedJob> result = claimService.claim(
                ClaimSpec.typeOnly(AudioTrimContract.TAG, 420, jobMapper),
                "300", "worker-1");

        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("publishAudioTrimResult: happy path with asset + logs + events（duration 取官方秒换算 ms）")
    void publishAudioTrimResult_happyPath() {
        // given
        when(jobMapper.publishResultGuard(anyLong(), anyString(), anyLong())).thenReturn(1);

        when(assetMapper.insert(any(AssetEntity.class))).thenAnswer(invocation -> {
            AssetEntity asset = (AssetEntity) invocation.getArgument(0);
            asset.setId(999L); // 模拟 DB 自增
            return 1;
        });

        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "audio_trim", "succeeded", 100));
        when(projectEventMapper.nextCursor(42L)).thenReturn(1L);

        com.bluewhale.worker.domain.dto.PublishAudioTrimDto input =
                new com.bluewhale.worker.domain.dto.PublishAudioTrimDto(
                        "300", "42", "9", "worker-1", 5L,
                        "https://example.com/trimmed.mp3", "generated/9/audio/abc123.mp3",
                        "audio/mpeg", 1024L, "0123456789abcdef0123456789abcdef", 120.25
                );

        // when
        boolean result = service.publishAudioTrimResult(input);

        // then
        assertThat(result).isTrue();

        // 断言 asset 插入（type=audio、duration_ms = 官方 120.25 秒换算）
        ArgumentCaptor<AssetEntity> assetCaptor = ArgumentCaptor.forClass(AssetEntity.class);
        verify(assetMapper).insert(assetCaptor.capture());
        AssetEntity capturedAsset = assetCaptor.getValue();
        assertThat(capturedAsset.getType()).isEqualTo("audio");
        assertThat(capturedAsset.getDurationMs()).isEqualTo(120250); // 120.25s * 1000

        // 断言 output_asset_ids 更新
        verify(jobMapper).updateOutputAssetIds(300L, "[999]");

        // 断言 log 插入
        ArgumentCaptor<GenerationJobLogEntity> logCaptor = ArgumentCaptor.forClass(GenerationJobLogEntity.class);
        verify(jobLogMapper).insert(logCaptor.capture());
        GenerationJobLogEntity capturedLog = logCaptor.getValue();
        assertThat(capturedLog.getEvent()).isEqualTo("succeeded");
        assertThat(capturedLog.getMessage()).isEqualTo("音频已截取");

        // 断言 project_events 插入（asset.created + generation_job.status_changed）
        ArgumentCaptor<ProjectEventEntity> eventCaptor = ArgumentCaptor.forClass(ProjectEventEntity.class);
        verify(projectEventMapper, times(2)).insert(eventCaptor.capture());
    }

    @Test
    @DisplayName("publishAudioTrimResult: stale token → false")
    void publishAudioTrimResult_staleToken() {
        when(jobMapper.publishResultGuard(anyLong(), anyString(), anyLong())).thenReturn(0);

        com.bluewhale.worker.domain.dto.PublishAudioTrimDto input =
                new com.bluewhale.worker.domain.dto.PublishAudioTrimDto(
                        "300", "42", "9", "worker-1", 5L,
                        "https://example.com/trimmed.mp3", "generated/9/audio/abc123.mp3",
                        "audio/mpeg", 1024L, null, null
                );

        boolean result = service.publishAudioTrimResult(input);

        assertThat(result).isFalse();
        verify(assetMapper, never()).insert(any(AssetEntity.class));
    }

    @Test
    @DisplayName("failAudioTrimJob: happy path with logs + events")
    void failAudioTrimJob_happyPath() {
        // given
        when(jobMapper.failMediaExtractGuard(anyLong(), anyString(), anyLong(), anyString())).thenReturn(1);
        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "audio_trim", "failed", 0));
        when(projectEventMapper.nextCursor(42L)).thenReturn(1L);

        com.bluewhale.worker.domain.dto.FailAudioTrimDto input =
                new com.bluewhale.worker.domain.dto.FailAudioTrimDto(
                        "300", "worker-1", 5L,
                        "audio_trim_failed", "The parameter `end_time` must be less than audio duration.",
                        Map.of("raw", "The parameter `end_time` must be less than audio duration.")
                );

        // when
        boolean result = service.failAudioTrimJob(input);

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
        assertThat(errorJson).contains("\"code\":\"audio_trim_failed\"");
        assertThat(errorJson).contains("\"details\"");

        // 断言 log 插入
        ArgumentCaptor<GenerationJobLogEntity> logCaptor = ArgumentCaptor.forClass(GenerationJobLogEntity.class);
        verify(jobLogMapper).insert(logCaptor.capture());
        GenerationJobLogEntity capturedLog = logCaptor.getValue();
        assertThat(capturedLog.getEvent()).isEqualTo("failed");
        assertThat(capturedLog.getMessage())
                .isEqualTo("audio_trim_failed: The parameter `end_time` must be less than audio duration.");

        // 断言 project_events 插入（generation_job.status_changed）
        ArgumentCaptor<ProjectEventEntity> eventCaptor = ArgumentCaptor.forClass(ProjectEventEntity.class);
        verify(projectEventMapper, times(1)).insert(eventCaptor.capture());
    }

    @Test
    @DisplayName("failAudioTrimJob: stale token → false")
    void failAudioTrimJob_staleToken() {
        when(jobMapper.failMediaExtractGuard(anyLong(), anyString(), anyLong(), anyString())).thenReturn(0);

        com.bluewhale.worker.domain.dto.FailAudioTrimDto input =
                new com.bluewhale.worker.domain.dto.FailAudioTrimDto(
                        "300", "worker-1", 5L,
                        "audio_trim_failed", "音频转存存储未配置",
                        null
                );

        boolean result = service.failAudioTrimJob(input);

        assertThat(result).isFalse();
        verify(jobLogMapper, never()).insert(any(GenerationJobLogEntity.class));
    }

    // ========== Blade-② audio golden mirrors ==========

    @Test
    @DisplayName("G06-audio: 音频孤儿接管（processing + 过期租约）")
    void g06_audioOrphanTakeover() {
        // given: 候选行 status='processing', lease_expires_at < now, fencing_token=2
        GenerationJobEntity candidate = new GenerationJobEntity();
        candidate.setId(400L);
        candidate.setProjectId(42L);
        candidate.setUserId(9L);
        candidate.setType("audio");
        candidate.setStatus("processing");
        candidate.setFencingToken(2L);
        candidate.setLeaseExpiresAt(WorkerClock.now().minusSeconds(10)); // 过期租约
        candidate.setInput("{\"prompt\":\"hello\",\"model_id\":\"seed-audio-1.0\"}");
        candidate.setExpectedOutputCount(1);
        candidate.setRetryCount(0);

        when(jobMapper.findAudioCandidate(400L)).thenReturn(candidate);
        when(jobMapper.claimAudioCas(
                eq(400L),
                eq("worker-1"),
                any(LocalDateTime.class),
                eq(2L),
                eq("processing")
        )).thenReturn(1);

        // when
        Optional<ClaimedJobDto> result = service.claimAudioJobById("400", "worker-1");

        // then
        assertThat(result).isPresent();
        ClaimedJobDto claimed = result.get();
        assertThat(claimed.fencingToken()).isEqualTo(3L); // 增后 token = 2 + 1
        assertThat(claimed.type()).isEqualTo("audio");
        assertThat(claimed.project_id()).isEqualTo("42");
        assertThat(claimed.user_id()).isEqualTo("9");

        // 断言 CAS where 含 status='processing'（孤儿接管）
        verify(jobMapper).claimAudioCas(
                eq(400L),
                eq("worker-1"),
                any(LocalDateTime.class),
                eq(2L),
                eq("processing")
        );
    }

    @Test
    @DisplayName("claimAudioJobById: no candidate → empty")
    void claimAudio_noCandidate() {
        when(jobMapper.findAudioCandidate(400L)).thenReturn(null);
        Optional<ClaimedJobDto> result = service.claimAudioJobById("400", "worker-1");
        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("claimAudioJobById: CAS rejected → empty")
    void claimAudio_casRejected() {
        GenerationJobEntity candidate = new GenerationJobEntity();
        candidate.setId(400L);
        candidate.setFencingToken(2L);
        candidate.setStatus("queued");
        candidate.setType("audio");

        when(jobMapper.findAudioCandidate(400L)).thenReturn(candidate);
        when(jobMapper.claimAudioCas(eq(400L), eq("worker-1"), any(LocalDateTime.class),
                eq(2L), eq("queued"))).thenReturn(0);

        Optional<ClaimedJobDto> result = service.claimAudioJobById("400", "worker-1");
        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("createAsset: happy path → asset.id returned")
    void createAsset_happy() {
        when(jobMapper.createAssetGuard(300L, "worker-1", 5L)).thenReturn(1);
        when(assetMapper.insert(any(AssetEntity.class))).thenAnswer(inv -> {
            AssetEntity a = (AssetEntity) inv.getArgument(0);
            a.setId(888L);
            return 1;
        });

        String result = service.createAsset(new JobStateMachineService.CreateAssetInput(
                "9", "42", "300", "audio",
                "https://example.com/audio.mp3", "uploads/audio/abc.mp3",
                "audio/mpeg", 1024L, "0123456789abcdef0123456789abcdef", null, null, 12500,
                "worker-1", 5L
        ));

        assertThat(result).isEqualTo("888");

        // 断言 asset 字段
        ArgumentCaptor<AssetEntity> captor = ArgumentCaptor.forClass(AssetEntity.class);
        verify(assetMapper).insert(captor.capture());
        AssetEntity asset = captor.getValue();
        assertThat(asset.getType()).isEqualTo("audio");
        assertThat(asset.getMime()).isEqualTo("audio/mpeg");
        assertThat(asset.getDurationMs()).isEqualTo(12500); // 12.5 * 1000
        assertThat(asset.getSource()).isEqualTo("generated");
        assertThat(asset.getStatus()).isEqualTo("normal");
        // IKGS73：入参的 md5 必须原样落到 assets.md5。这条断言是「生成产物也能被 md5 去重」
        // 这个需求的最小证据——没有它，md5 在某一层被吞掉时全部测试仍然全绿。
        assertThat(asset.getMd5()).isEqualTo("0123456789abcdef0123456789abcdef");
    }

    @Test
    @DisplayName("createAsset: fence guard fail → null")
    void createAsset_fenceFail() {
        when(jobMapper.createAssetGuard(300L, "worker-1", 5L)).thenReturn(0);

        String result = service.createAsset(new JobStateMachineService.CreateAssetInput(
                "9", "42", "300", "audio",
                "https://example.com/audio.mp3", "uploads/audio/abc.mp3",
                "audio/mpeg", 1024L, "0123456789abcdef0123456789abcdef", null, null, null,
                "worker-1", 5L
        ));

        assertThat(result).isNull();
        verify(assetMapper, never()).insert(any(AssetEntity.class));
    }

    @Test
    @DisplayName("G17-audio: completeJob happy path (minus reservations, 修正一)")
    void completeJob_happy() {
        // given
        when(jobMapper.completeJobGuard(eq(300L), eq("worker-1"), eq(5L), anyString())).thenReturn(1);
        when(slotMapper.findByJobId(300L)).thenReturn(List.of()); // 无槽位
        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "audio", "succeeded", 100));
        when(projectEventMapper.nextCursor(42L)).thenReturn(1L);

        // when
        boolean result = service.completeJob("300", List.of("888"), "worker-1", 5L);

        // then
        assertThat(result).isTrue();
        verify(jobMapper).completeJobGuard(eq(300L), eq("worker-1"), eq(5L), anyString());
        // 按修正一省略：无 settleReservation 调用
        // 断言 project_event（generation_job.status_changed）
        verify(projectEventMapper, atLeastOnce()).insert(any(ProjectEventEntity.class));
    }

    @Test
    @DisplayName("completeJob: fence guard fail → false")
    void completeJob_fenceFail() {
        when(jobMapper.completeJobGuard(eq(300L), eq("worker-1"), eq(5L), anyString())).thenReturn(0);

        boolean result = service.completeJob("300", List.of("888"), "worker-1", 5L);

        assertThat(result).isFalse();
        verify(slotMapper, never()).findByJobId(anyLong());
    }

    @Test
    @DisplayName("failJob: happy path with log + events (minus releaseReservation, 修正一)")
    void failJob_happy() {
        // given
        when(jobMapper.failJobGuard(eq(300L), eq("worker-1"), eq(5L), anyString())).thenReturn(1);
        when(slotMapper.findPendingByJobId(300L)).thenReturn(List.of());
        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "audio", "failed", 0));
        when(projectEventMapper.nextCursor(42L)).thenReturn(1L);

        // when
        boolean result = service.failJob("300", "provider_failed", "TTS 调用失败",
                Map.of("raw", "connection refused"), "worker-1", 5L);

        // then
        assertThat(result).isTrue();
        // 断言 log
        ArgumentCaptor<GenerationJobLogEntity> logCaptor = ArgumentCaptor.forClass(GenerationJobLogEntity.class);
        verify(jobLogMapper).insert(logCaptor.capture());
        assertThat(logCaptor.getValue().getMessage()).isEqualTo("provider_failed: TTS 调用失败");
        // 按修正一省略：无 releaseReservationInTx 调用
    }

    @Test
    @DisplayName("failJob: fence guard fail → false")
    void failJob_fenceFail() {
        when(jobMapper.failJobGuard(eq(300L), eq("worker-1"), eq(5L), anyString())).thenReturn(0);

        boolean result = service.failJob("300", "provider_failed", "err",
                null, "worker-1", 5L);

        assertThat(result).isFalse();
        verify(jobLogMapper, never()).insert(any(GenerationJobLogEntity.class));
    }

    // ========== Blade-③ image golden mirrors ==========

    @Test
    @DisplayName("G06-image: 图片孤儿接管（processing + 过期租约）+ source 白名单")
    void g06_imageOrphanTakeover() {
        GenerationJobEntity candidate = new GenerationJobEntity();
        candidate.setId(500L);
        candidate.setProjectId(42L);
        candidate.setUserId(9L);
        candidate.setType("image");
        candidate.setStatus("processing");
        candidate.setFencingToken(2L);
        candidate.setLeaseExpiresAt(WorkerClock.now().minusSeconds(10));
        candidate.setInput("{\"prompt\":\"hello\",\"model_id\":\"gpt-image-1\"}");
        candidate.setExpectedOutputCount(4);
        candidate.setRetryCount(1);
        candidate.setSource("bottom_dock");

        when(jobMapper.findCandidateByTypeAndSources(
                eq(500L), eq("image"),
                eq(List.of("bottom_dock", "plan_apply", "storyboard_preview"))))
                .thenReturn(candidate);
        when(jobMapper.claimImageCas(
                eq(500L), eq("worker-1"), any(LocalDateTime.class),
                eq(2L), eq("processing")
        )).thenReturn(1);

        Optional<ClaimedJobDto> result = service.claimImageJobById("500", "worker-1");

        assertThat(result).isPresent();
        ClaimedJobDto claimed = result.get();
        assertThat(claimed.fencingToken()).isEqualTo(3L);
        assertThat(claimed.type()).isEqualTo("image");
        assertThat(claimed.expected_output_count()).isEqualTo(4);
        assertThat(claimed.retry_count()).isEqualTo(1);
    }

    @Test
    @DisplayName("claimImageJobById: no candidate → empty")
    void claimImage_noCandidate() {
        when(jobMapper.findCandidateByTypeAndSources(
                eq(500L), eq("image"),
                eq(List.of("bottom_dock", "plan_apply", "storyboard_preview"))))
                .thenReturn(null);
        Optional<ClaimedJobDto> result = service.claimImageJobById("500", "worker-1");
        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("claimImageJobById: CAS rejected → empty")
    void claimImage_casRejected() {
        GenerationJobEntity candidate = new GenerationJobEntity();
        candidate.setId(500L);
        candidate.setFencingToken(2L);
        candidate.setStatus("queued");
        candidate.setType("image");

        when(jobMapper.findCandidateByTypeAndSources(
                eq(500L), eq("image"),
                eq(List.of("bottom_dock", "plan_apply", "storyboard_preview"))))
                .thenReturn(candidate);
        when(jobMapper.claimImageCas(eq(500L), eq("worker-1"), any(LocalDateTime.class),
                eq(2L), eq("queued"))).thenReturn(0);

        Optional<ClaimedJobDto> result = service.claimImageJobById("500", "worker-1");
        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("G14-G16: requeueImageJobForRetry happy → true + exact SQL fields")
    void requeueImage_happy() {
        LocalDateTime nextAction = WorkerClock.now().plusSeconds(30);
        when(jobMapper.requeueImageCas(eq(300L), eq(nextAction))).thenReturn(1);

        boolean result = service.requeueImageJobForRetry("300", nextAction);

        assertThat(result).isTrue();
        // G15 exact data: status='queued', lease_owner=null, lease_expires_at=null,
        // next_action_at=入参, retry_count+1, fencing_token+1, version+1
        verify(jobMapper).requeueImageCas(300L, nextAction);
    }

    @Test
    @DisplayName("G14: requeueImageJobForRetry count=0 → false")
    void requeueImage_countZero() {
        when(jobMapper.requeueImageCas(eq(300L), any(LocalDateTime.class))).thenReturn(0);

        boolean result = service.requeueImageJobForRetry("300", WorkerClock.now());

        assertThat(result).isFalse();
    }

    @Test
    @DisplayName("G16: requeueImageJobForRetry DB 异常 → false（不抛）")
    void requeueImage_dbException() {
        when(jobMapper.requeueImageCas(eq(300L), any(LocalDateTime.class)))
                .thenThrow(new RuntimeException("DB error"));

        boolean result = service.requeueImageJobForRetry("300", WorkerClock.now());

        assertThat(result).isFalse();
    }

    @Test
    @DisplayName("G39: completeJob 多图槽位聚合 → partially_succeeded")
    void completeJob_multiSlotPartiallySucceeded() {
        // given: 4 个槽位，只产出 2 个 asset
        when(jobMapper.completeJobGuard(eq(300L), eq("worker-1"), eq(5L), anyString())).thenReturn(1);

        GenerationOutputSlotEntity slot0 = new GenerationOutputSlotEntity();
        slot0.setId(10L); slot0.setSlotIndex(0); slot0.setStatus("pending");
        GenerationOutputSlotEntity slot1 = new GenerationOutputSlotEntity();
        slot1.setId(11L); slot1.setSlotIndex(1); slot1.setStatus("pending");
        GenerationOutputSlotEntity slot2 = new GenerationOutputSlotEntity();
        slot2.setId(12L); slot2.setSlotIndex(2); slot2.setStatus("pending");
        GenerationOutputSlotEntity slot3 = new GenerationOutputSlotEntity();
        slot3.setId(13L); slot3.setSlotIndex(3); slot3.setStatus("pending");
        when(slotMapper.findByJobId(300L)).thenReturn(List.of(slot0, slot1, slot2, slot3));
        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "image", "succeeded", 100));
        when(projectEventMapper.nextCursor(42L)).thenReturn(1L);

        // when: 只产出 2 张图
        boolean result = service.completeJob("300", List.of("100", "101"), "worker-1", 5L);

        // then
        assertThat(result).isTrue();

        // 断言槽位：前 2 个 succeeded + asset_id，后 2 个 failed
        verify(slotMapper).updateSlot(10L, "succeeded", 100L);
        verify(slotMapper).updateSlot(11L, "succeeded", 101L);
        verify(slotMapper).updateSlotStatus(12L, "failed");
        verify(slotMapper).updateSlotStatus(13L, "failed");

        // 断言状态修正为 partially_succeeded
        verify(jobMapper).updateJobStatus(300L, "partially_succeeded");
    }

    @Test
    @DisplayName("G40: completeJob 全槽成功 → succeeded（不修正状态）")
    void completeJob_allSlotsSucceeded() {
        when(jobMapper.completeJobGuard(eq(300L), eq("worker-1"), eq(5L), anyString())).thenReturn(1);

        GenerationOutputSlotEntity slot0 = new GenerationOutputSlotEntity();
        slot0.setId(10L); slot0.setSlotIndex(0);
        GenerationOutputSlotEntity slot1 = new GenerationOutputSlotEntity();
        slot1.setId(11L); slot1.setSlotIndex(1);
        when(slotMapper.findByJobId(300L)).thenReturn(List.of(slot0, slot1));
        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "image", "succeeded", 100));
        when(projectEventMapper.nextCursor(42L)).thenReturn(1L);

        boolean result = service.completeJob("300", List.of("100", "101"), "worker-1", 5L);

        assertThat(result).isTrue();
        verify(slotMapper).updateSlot(10L, "succeeded", 100L);
        verify(slotMapper).updateSlot(11L, "succeeded", 101L);
        // 全成功 → 不调用 updateJobStatus（保持 guard 设置的 succeeded）
        verify(jobMapper, never()).updateJobStatus(anyLong(), anyString());
    }

    @Test
    @DisplayName("G41: completeJob 全槽失败 → failed")
    void completeJob_allSlotsFailed() {
        when(jobMapper.completeJobGuard(eq(300L), eq("worker-1"), eq(5L), anyString())).thenReturn(1);

        GenerationOutputSlotEntity slot0 = new GenerationOutputSlotEntity();
        slot0.setId(10L); slot0.setSlotIndex(0);
        GenerationOutputSlotEntity slot1 = new GenerationOutputSlotEntity();
        slot1.setId(11L); slot1.setSlotIndex(1);
        when(slotMapper.findByJobId(300L)).thenReturn(List.of(slot0, slot1));
        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "image", "succeeded", 100));
        when(projectEventMapper.nextCursor(42L)).thenReturn(1L);

        // 0 个 asset → 全槽失败
        boolean result = service.completeJob("300", List.of(), "worker-1", 5L);

        assertThat(result).isTrue();
        verify(slotMapper).updateSlotStatus(10L, "failed");
        verify(slotMapper).updateSlotStatus(11L, "failed");
        verify(jobMapper).updateJobStatus(300L, "failed");
    }

    // ========== syncRecordSummary / syncStoryboardPreviewSummary golden mirrors ==========

    @Test
    @DisplayName("G42: completeJob 全槽成功 + record 关联 → summary_status='success'")
    void syncRecord_allSucceeded() {
        when(jobMapper.completeJobGuard(eq(300L), eq("worker-1"), eq(5L), anyString())).thenReturn(1);

        GenerationOutputSlotEntity slot0 = makeSlot(10L, 0, "succeeded", 99L);
        GenerationOutputSlotEntity slot1 = makeSlot(11L, 1, "succeeded", 98L);
        // 关联 record
        slot0.setSceneCardGenerationRecordId(500L);
        slot1.setSceneCardGenerationRecordId(500L);
        when(slotMapper.findByJobId(300L)).thenReturn(List.of(slot0, slot1));
        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "image", "succeeded", 100));
        when(projectEventMapper.nextCursor(anyLong())).thenReturn(1L);

        // syncRecordSummary 依赖
        when(slotMapper.findBySceneCardRecordId(500L)).thenReturn(List.of(slot0, slot1));
        when(sceneCardRecordMapper.updateSummaryStatus(500L, "success")).thenReturn(1);
        SceneCardGenerationRecordEntity record = new SceneCardGenerationRecordEntity();
        record.setId(500L); record.setProjectId(42L); record.setVersion(2);
        when(sceneCardRecordMapper.selectById(500L)).thenReturn(record);

        boolean result = service.completeJob("300", List.of("99", "98"), "worker-1", 5L);

        assertThat(result).isTrue();
        verify(sceneCardRecordMapper).updateSummaryStatus(500L, "success");
        // 全成功 → 不调用 updateJobStatus
        verify(jobMapper, never()).updateJobStatus(anyLong(), anyString());
    }

    @Test
    @DisplayName("G43: completeJob 部分成功 + record → summary_status='partial'")
    void syncRecord_partiallySucceeded() {
        when(jobMapper.completeJobGuard(eq(300L), eq("worker-1"), eq(5L), anyString())).thenReturn(1);

        GenerationOutputSlotEntity slot0 = makeSlot(10L, 0, "succeeded", 99L);
        GenerationOutputSlotEntity slot1 = makeSlot(11L, 1, "failed", null);
        slot0.setSceneCardGenerationRecordId(500L);
        slot1.setSceneCardGenerationRecordId(500L);
        when(slotMapper.findByJobId(300L)).thenReturn(List.of(slot0, slot1));
        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "image", "succeeded", 100));
        when(projectEventMapper.nextCursor(anyLong())).thenReturn(1L);

        when(slotMapper.findBySceneCardRecordId(500L)).thenReturn(List.of(slot0, slot1));
        when(sceneCardRecordMapper.updateSummaryStatus(500L, "partial")).thenReturn(1);
        SceneCardGenerationRecordEntity record = new SceneCardGenerationRecordEntity();
        record.setId(500L); record.setProjectId(42L); record.setVersion(2);
        when(sceneCardRecordMapper.selectById(500L)).thenReturn(record);

        service.completeJob("300", List.of("99"), "worker-1", 5L);

        verify(sceneCardRecordMapper).updateSummaryStatus(500L, "partial");
        verify(jobMapper).updateJobStatus(300L, "partially_succeeded");
    }

    @Test
    @DisplayName("G44: completeJob 无 record 关联 → 零副作用")
    void syncRecord_noRecord_noSideEffect() {
        when(jobMapper.completeJobGuard(eq(300L), eq("worker-1"), eq(5L), anyString())).thenReturn(1);

        GenerationOutputSlotEntity slot0 = makeSlot(10L, 0, "succeeded", 99L);
        // scene_card_generation_record_id = null（音频/普通图片场景）
        when(slotMapper.findByJobId(300L)).thenReturn(List.of(slot0));
        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "audio", "succeeded", 100));
        when(projectEventMapper.nextCursor(anyLong())).thenReturn(1L);

        service.completeJob("300", List.of("99"), "worker-1", 5L);

        // record mapper 不应被调用
        verify(sceneCardRecordMapper, never()).updateSummaryStatus(anyLong(), anyString());
        verify(slotMapper, never()).findBySceneCardRecordId(anyLong());
    }

    @Test
    @DisplayName("G45: completeJob + storyboard_preview 关联 → summary_status 同步")
    void syncStoryboard_happy() {
        when(jobMapper.completeJobGuard(eq(300L), eq("worker-1"), eq(5L), anyString())).thenReturn(1);

        GenerationOutputSlotEntity slot0 = makeSlot(10L, 0, "succeeded", 99L);
        when(slotMapper.findByJobId(300L)).thenReturn(List.of(slot0));
        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "image", "succeeded", 100));
        when(projectEventMapper.nextCursor(anyLong())).thenReturn(1L);

        // storyboard_preview 反查命中
        StoryboardPreviewEntity preview = new StoryboardPreviewEntity();
        preview.setId(700L); preview.setProjectId(42L); preview.setVersion(1);
        when(storyboardPreviewMapper.findByFirstGenerationJobId(300L)).thenReturn(preview);
        when(storyboardPreviewMapper.updateSummaryStatus(700L, "success")).thenReturn(1);
        StoryboardPreviewEntity updated = new StoryboardPreviewEntity();
        updated.setId(700L); updated.setVersion(2);
        when(storyboardPreviewMapper.selectById(700L)).thenReturn(updated);

        service.completeJob("300", List.of("99"), "worker-1", 5L);

        verify(storyboardPreviewMapper).findByFirstGenerationJobId(300L);
        verify(storyboardPreviewMapper).updateSummaryStatus(700L, "success");
    }

    @Test
    @DisplayName("G46: completeJob 无 storyboard_preview 关联 → 零副作用")
    void syncStoryboard_noPreview_noSideEffect() {
        when(jobMapper.completeJobGuard(eq(300L), eq("worker-1"), eq(5L), anyString())).thenReturn(1);

        GenerationOutputSlotEntity slot0 = makeSlot(10L, 0, "succeeded", 99L);
        when(slotMapper.findByJobId(300L)).thenReturn(List.of(slot0));
        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "image", "succeeded", 100));
        when(projectEventMapper.nextCursor(anyLong())).thenReturn(1L);

        // storyboard_preview 反查无命中
        when(storyboardPreviewMapper.findByFirstGenerationJobId(300L)).thenReturn(null);

        service.completeJob("300", List.of("99"), "worker-1", 5L);

        verify(storyboardPreviewMapper).findByFirstGenerationJobId(300L);
        verify(storyboardPreviewMapper, never()).updateSummaryStatus(anyLong(), anyString());
    }

    // ========== aggregateSlotStatus / resolveLogicalSlots 纯函数测试 ==========

    @Test
    @DisplayName("aggregateSlotStatus: 全 succeeded → 'success'")
    void aggregate_allSucceeded() {
        var slots = List.of(makeSlot(1L, 0, "succeeded", null), makeSlot(2L, 1, "succeeded", null));
        assertThat(JobStateMachineService.aggregateSlotStatus(
                JobStateMachineService.resolveLogicalSlots(slots))).isEqualTo("success");
    }

    @Test
    @DisplayName("aggregateSlotStatus: 全 failed → 'failed'")
    void aggregate_allFailed() {
        var slots = List.of(makeSlot(1L, 0, "failed", null), makeSlot(2L, 1, "failed", null));
        assertThat(JobStateMachineService.aggregateSlotStatus(
                JobStateMachineService.resolveLogicalSlots(slots))).isEqualTo("failed");
    }

    @Test
    @DisplayName("aggregateSlotStatus: 混合 → 'partial'")
    void aggregate_partial() {
        var slots = List.of(makeSlot(1L, 0, "succeeded", null), makeSlot(2L, 1, "failed", null));
        assertThat(JobStateMachineService.aggregateSlotStatus(
                JobStateMachineService.resolveLogicalSlots(slots))).isEqualTo("partial");
    }

    @Test
    @DisplayName("aggregateSlotStatus: 含 pending → 'generating'")
    void aggregate_hasPending() {
        var slots = List.of(makeSlot(1L, 0, "succeeded", null), makeSlot(2L, 1, "pending", null));
        assertThat(JobStateMachineService.aggregateSlotStatus(
                JobStateMachineService.resolveLogicalSlots(slots))).isEqualTo("generating");
    }

    @Test
    @DisplayName("aggregateSlotStatus: 空列表 → 'failed'")
    void aggregate_empty() {
        assertThat(JobStateMachineService.aggregateSlotStatus(List.of())).isEqualTo("failed");
    }

    @Test
    @DisplayName("resolveLogicalSlots: 同 slot_index 重试 → succeeded 优先")
    void resolveSlots_succeededWins() {
        // slot_index=0 有两次尝试：先 failed(id=1)，后 succeeded(id=2)
        var s1 = makeSlot(1L, 0, "failed", null);
        var s2 = makeSlot(2L, 0, "succeeded", null);
        var resolved = JobStateMachineService.resolveLogicalSlots(List.of(s1, s2));
        assertThat(resolved).hasSize(1);
        assertThat(resolved.get(0).getStatus()).isEqualTo("succeeded");
    }

    private GenerationOutputSlotEntity makeSlot(Long id, int slotIndex, String status, Long assetId) {
        GenerationOutputSlotEntity slot = new GenerationOutputSlotEntity();
        slot.setId(id);
        slot.setSlotIndex(slotIndex);
        slot.setStatus(status);
        slot.setAssetId(assetId);
        return slot;
    }

    @Test
    @DisplayName("publishVideoSceneSplitResult: 多段资产落库 + 契约 result 跨进程回传（IKH8BP）")
    void publishVideoSceneSplitResult_happyPath() {
        // given
        when(jobMapper.publishResultGuard(anyLong(), anyString(), anyLong())).thenReturn(1);

        final long[] seq = {900L};
        when(assetMapper.insert(any(AssetEntity.class))).thenAnswer(invocation -> {
            AssetEntity asset = (AssetEntity) invocation.getArgument(0);
            asset.setId(seq[0]++); // 模拟 DB 自增：900 / 901
            return 1;
        });

        when(jobMapper.selectById(300L)).thenReturn(createJob(300L, 42L, "video_scene_split", "succeeded", 100));
        when(projectEventMapper.nextCursor(42L)).thenReturn(1L);

        PublishVideoSceneSplitDto input = new PublishVideoSceneSplitDto(
                "300", "42", "9", "worker-1", 5L, 95.5,
                List.of(
                        new PublishVideoSceneSplitDto.Segment(1, 0.0, 31.2,
                                "https://tos/seg1.mp4", "generated/9/video/seg1.mp4",
                                "video/mp4", 1024L, "md5-1", 1920, 1080),
                        new PublishVideoSceneSplitDto.Segment(2, 31.2, 95.5,
                                "https://tos/seg2.mp4", "generated/9/video/seg2.mp4",
                                "video/mp4", 2048L, "md5-2", 1920, 1080)));

        // when
        boolean result = service.publishVideoSceneSplitResult(input);

        // then
        assertThat(result).isTrue();

        // 断言逐段 asset 插入：type=video / duration_ms = 段时长
        ArgumentCaptor<AssetEntity> assetCaptor = ArgumentCaptor.forClass(AssetEntity.class);
        verify(assetMapper, times(2)).insert(assetCaptor.capture());
        AssetEntity first = assetCaptor.getAllValues().get(0);
        assertThat(first.getType()).isEqualTo("video");
        assertThat(first.getSource()).isEqualTo("generated");
        assertThat(first.getDurationMs()).isEqualTo(31200); // (31.2 - 0.0) * 1000
        AssetEntity second = assetCaptor.getAllValues().get(1);
        assertThat(second.getDurationMs()).isEqualTo(64300); // (95.5 - 31.2) * 1000

        // 断言 output_asset_ids 更新（全部段资产 id 数组，1 段与 N 段同构）
        verify(jobMapper).updateOutputAssetIds(300L, "[900,901]");

        // 断言终态日志 payload 带契约 result 形态（段序/起止秒/段资产引用/总时长）
        ArgumentCaptor<GenerationJobLogEntity> logCaptor = ArgumentCaptor.forClass(GenerationJobLogEntity.class);
        verify(jobLogMapper).insert(logCaptor.capture());
        GenerationJobLogEntity capturedLog = logCaptor.getValue();
        assertThat(capturedLog.getEvent()).isEqualTo("succeeded");
        assertThat(capturedLog.getMessage()).isEqualTo("场景切分完成");
        assertThat(capturedLog.getPayload())
                .contains("\"segment_index\":1")
                .contains("\"start_time\":0.0")
                .contains("\"end_time\":31.2")
                .contains("\"segment_asset_id\":\"900\"")
                .contains("\"segment_index\":2")
                .contains("\"segment_asset_id\":\"901\"")
                .contains("\"duration\":95.5");

        // 断言 project_events 插入：每段一条 asset.created + 一条 status_changed（payload 带 result）
        ArgumentCaptor<ProjectEventEntity> eventCaptor = ArgumentCaptor.forClass(ProjectEventEntity.class);
        verify(projectEventMapper, times(3)).insert(eventCaptor.capture());
        ProjectEventEntity statusChanged = eventCaptor.getAllValues().stream()
                .filter(e -> "generation_job.status_changed".equals(e.getEventType()))
                .findFirst().orElseThrow();
        assertThat(statusChanged.getPayload())
                .contains("\"result\":{\"duration\":95.5")
                .contains("\"segments\":[")
                .contains("\"segment_index\":2");
    }

    @Test
    @DisplayName("publishVideoSceneSplitResult: stale token → false（无段资产落库）")
    void publishVideoSceneSplitResult_staleToken() {
        when(jobMapper.publishResultGuard(anyLong(), anyString(), anyLong())).thenReturn(0);

        PublishVideoSceneSplitDto input = new PublishVideoSceneSplitDto(
                "300", "42", "9", "worker-1", 5L, 95.0,
                List.of(new PublishVideoSceneSplitDto.Segment(1, 0.0, 95.0,
                        "https://tos/seg.mp4", "generated/9/video/seg.mp4",
                        "video/mp4", 1024L, "md5", 1920, 1080)));

        boolean result = service.publishVideoSceneSplitResult(input);

        assertThat(result).isFalse();
        verify(assetMapper, never()).insert(any(AssetEntity.class));
    }

    @Test
    @DisplayName("publishVideoFrameInterpolationResult: asset + 终态日志 payload 带官方 result 键（IKHLKJ）")
    void publishVideoFrameInterpolationResult_happyPath() {
        // given
        when(jobMapper.publishResultGuard(anyLong(), anyString(), anyLong())).thenReturn(1);
        when(assetMapper.insert(any(AssetEntity.class))).thenAnswer(invocation -> {
            AssetEntity asset = (AssetEntity) invocation.getArgument(0);
            asset.setId(910L); // 模拟 DB 自增
            return 1;
        });
        when(jobMapper.selectById(300L)).thenReturn(
                createJob(300L, 42L, "video_frame_interpolation", "succeeded", 100));
        when(projectEventMapper.nextCursor(42L)).thenReturn(1L);

        PublishVideoFrameInterpolationDto input = new PublishVideoFrameInterpolationDto(
                "300", "42", "9", "worker-1", 5L,
                "https://tos/out.mp4", "generated/9/video/out.mp4", "video/mp4", 123_456L, "md5-x",
                1920, 1080, 65.5, "1080p", 60.0);

        // when
        boolean result = service.publishVideoFrameInterpolationResult(input);

        // then
        assertThat(result).isTrue();

        // 单槽单 asset：type=video / source=generated / 宽高取源近似 / duration 官方秒换算 ms
        ArgumentCaptor<AssetEntity> assetCaptor = ArgumentCaptor.forClass(AssetEntity.class);
        verify(assetMapper).insert(assetCaptor.capture());
        AssetEntity asset = assetCaptor.getValue();
        assertThat(asset.getType()).isEqualTo("video");
        assertThat(asset.getSource()).isEqualTo("generated");
        assertThat(asset.getWidth()).isEqualTo(1920);
        assertThat(asset.getHeight()).isEqualTo(1080);
        assertThat(asset.getDurationMs()).isEqualTo(65_500);

        verify(jobMapper).updateOutputAssetIds(300L, "[910]");

        // 终态日志 payload 引用契约结果键（duration / resolution / fps——assets 无对应列）
        ArgumentCaptor<GenerationJobLogEntity> logCaptor = ArgumentCaptor.forClass(GenerationJobLogEntity.class);
        verify(jobLogMapper).insert(logCaptor.capture());
        GenerationJobLogEntity capturedLog = logCaptor.getValue();
        assertThat(capturedLog.getEvent()).isEqualTo("succeeded");
        assertThat(capturedLog.getMessage()).isEqualTo("视频插帧完成");
        assertThat(capturedLog.getPayload())
                .contains("\"asset_ids\":[\"910\"]")
                .contains("\"duration\":65.5")
                .contains("\"resolution\":\"1080p\"")
                .contains("\"fps\":60.0");

        // 双事件：asset.created + generation_job.status_changed（前端按 target_node_id 回填结果卡）
        ArgumentCaptor<ProjectEventEntity> eventCaptor = ArgumentCaptor.forClass(ProjectEventEntity.class);
        verify(projectEventMapper, times(2)).insert(eventCaptor.capture());
        assertThat(eventCaptor.getAllValues())
                .extracting(ProjectEventEntity::getEventType)
                .containsExactlyInAnyOrder("asset.created", "generation_job.status_changed");
    }

    @Test
    @DisplayName("publishVideoFrameInterpolationResult: stale token / 已取消 → false（不落资产，迟到结果不复活）")
    void publishVideoFrameInterpolationResult_staleToken() {
        when(jobMapper.publishResultGuard(anyLong(), anyString(), anyLong())).thenReturn(0);

        PublishVideoFrameInterpolationDto input = new PublishVideoFrameInterpolationDto(
                "300", "42", "9", "worker-1", 5L,
                "https://tos/out.mp4", "generated/9/video/out.mp4", "video/mp4", 123_456L, "md5-x",
                1920, 1080, 65.5, "1080p", 60.0);

        boolean result = service.publishVideoFrameInterpolationResult(input);

        assertThat(result).isFalse();
        verify(assetMapper, never()).insert(any(AssetEntity.class));
        verify(jobMapper, never()).updateOutputAssetIds(anyLong(), anyString());
    }

    private GenerationJobEntity createJob(Long id, Long projectId, String type, String status, int progress) {        GenerationJobEntity job = new GenerationJobEntity();
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
