package com.bluewhale.agent.service;

import com.bluewhale.agent.common.exception.GlobalException;
import com.bluewhale.agent.mapper.AssetMapper;
import com.bluewhale.agent.mapper.GenerationJobMapper;
import com.bluewhale.agent.model.dto.CreateJobResponse;
import com.bluewhale.agent.model.dto.ImageGenerateRequest;
import com.bluewhale.agent.model.dto.ImageResult;
import com.bluewhale.agent.model.dto.JobStatusResponse;
import com.bluewhale.agent.model.dto.VideoGenerateRequest;
import com.bluewhale.agent.model.dto.VideoTaskResult;
import com.bluewhale.agent.model.entity.Asset;
import com.bluewhale.agent.model.entity.GenerationJob;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link GenerationJobService} 测试：mock mapper + VolcEngineService + AssetStorageService，
 * 覆盖文生图同步、视频异步提交、状态查询、poller 状态机推进（succeeded/failed/timeout/running）。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class GenerationJobServiceTest {

    @Mock
    private GenerationJobMapper jobMapper;
    @Mock
    private AssetMapper assetMapper;
    @Mock
    private VolcEngineService volcEngineService;
    @Mock
    private AssetStorageService assetStorageService;

    @InjectMocks
    private GenerationJobService service;

    @BeforeEach
    void setUp() {
        when(jobMapper.insert(any(GenerationJob.class))).thenAnswer(inv -> {
            ((GenerationJob) inv.getArgument(0)).setId(1L);
            return 1;
        });
    }

    private Asset imageAsset(long id, String url) {
        Asset a = new Asset().setUrl(url).setType(Asset.TYPE_IMAGE);
        a.setId(id);
        return a;
    }

    @Test
    void createImageJobSuccessReturnsAsset() {
        ImageGenerateRequest req = new ImageGenerateRequest("cat", "1024x1024", "1:1", 1, null);
        when(volcEngineService.generateImage("cat", "1024x1024", false)).thenReturn("https://ark/img.png");
        when(assetStorageService.downloadAndStore("https://ark/img.png", 7L, Asset.TYPE_IMAGE, "image/png"))
                .thenReturn(imageAsset(9L, "/assets/x.png"));

        ImageResult r = service.createImageJob(req, 7L);

        assertThat(r.assetId()).isEqualTo(9L);
        assertThat(r.url()).isEqualTo("/assets/x.png");
        GenerationJob updated = captureUpdate();
        assertThat(updated.getStatus()).isEqualTo(GenerationJob.STATUS_SUCCEEDED);
        assertThat(updated.getOutputAssetIds()).containsExactly(9L);
    }

    @Test
    void createImageJobFailureMarksFailedAndThrows() {
        ImageGenerateRequest req = new ImageGenerateRequest("cat", "1024x1024", null, 1, null);
        when(volcEngineService.generateImage(any(), any(), any()))
                .thenThrow(new GlobalException(400, "上游生成失败: boom"));

        assertThatThrownBy(() -> service.createImageJob(req, 7L)).isInstanceOf(GlobalException.class);
        assertThat(captureUpdate().getStatus()).isEqualTo(GenerationJob.STATUS_FAILED);
    }

    @Test
    void createVideoJobSuccessReturnsQueued() {
        VideoGenerateRequest req = new VideoGenerateRequest("cat video", "720p", "16:9", 5L, null, null);
        when(volcEngineService.createVideoTask("cat video", null, "16:9", "720p", 5L)).thenReturn("task-1");

        CreateJobResponse resp = service.createVideoJob(req, 7L);

        assertThat(resp.jobId()).isEqualTo(1L);
        assertThat(resp.status()).isEqualTo(GenerationJob.STATUS_QUEUED);
        GenerationJob updated = captureUpdate();
        assertThat(updated.getStatus()).isEqualTo(GenerationJob.STATUS_PROCESSING);
        assertThat(updated.getProviderTaskId()).isEqualTo("task-1");
        assertThat(updated.getNextPollAt()).isNotNull();
    }

    @Test
    void createVideoJobFailureMarksFailed() {
        VideoGenerateRequest req = new VideoGenerateRequest("p", null, null, null, null, null);
        when(volcEngineService.createVideoTask(any(), any(), any(), any(), any()))
                .thenThrow(new GlobalException(400, "上游创建任务失败: x"));

        assertThatThrownBy(() -> service.createVideoJob(req, 7L)).isInstanceOf(GlobalException.class);
        assertThat(captureUpdate().getStatus()).isEqualTo(GenerationJob.STATUS_FAILED);
    }

    @Test
    void getJobStatusNotFound() {
        when(jobMapper.selectById(99L)).thenReturn(null);
        assertThatThrownBy(() -> service.getJobStatus(99L))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("job not found");
    }

    @Test
    void getJobStatusSucceededWithAsset() {
        GenerationJob job = new GenerationJob().setStatus(GenerationJob.STATUS_SUCCEEDED)
                .setProgress(100).setOutputAssetIds(List.of(9L));
        job.setId(1L);
        when(jobMapper.selectById(1L)).thenReturn(job);
        Asset asset = new Asset().setUrl("/assets/v.mp4").setType(Asset.TYPE_VIDEO);
        asset.setId(9L);
        when(assetMapper.selectById(9L)).thenReturn(asset);

        JobStatusResponse r = service.getJobStatus(1L);
        assertThat(r.status()).isEqualTo(GenerationJob.STATUS_SUCCEEDED);
        assertThat(r.asset().id()).isEqualTo(9L);
        assertThat(r.asset().url()).isEqualTo("/assets/v.mp4");
    }

    @Test
    void getJobStatusProcessingNoAsset() {
        GenerationJob job = new GenerationJob().setStatus(GenerationJob.STATUS_PROCESSING)
                .setProgress(30).setOutputAssetIds(null);
        job.setId(1L);
        when(jobMapper.selectById(1L)).thenReturn(job);

        JobStatusResponse r = service.getJobStatus(1L);
        assertThat(r.status()).isEqualTo(GenerationJob.STATUS_PROCESSING);
        assertThat(r.asset()).isNull();
    }

    @Test
    void pollJobSucceededDownloadsAndStores() {
        GenerationJob job = newGenerationJob(GenerationJob.STATUS_PROCESSING, "t1", 0);
        when(volcEngineService.getVideoTask("t1"))
                .thenReturn(new VideoTaskResult("succeeded", "https://ark/v.mp4", null, null));
        Asset asset = new Asset().setUrl("/assets/v.mp4").setType(Asset.TYPE_VIDEO);
        asset.setId(5L);
        when(assetStorageService.downloadAndStore("https://ark/v.mp4", 7L, Asset.TYPE_VIDEO, "video/mp4")).thenReturn(asset);

        service.pollJob(job);

        GenerationJob updated = captureUpdate();
        assertThat(updated.getStatus()).isEqualTo(GenerationJob.STATUS_SUCCEEDED);
        assertThat(updated.getOutputAssetIds()).containsExactly(5L);
        assertThat(updated.getPollCount()).isEqualTo(1);
    }

    @Test
    void pollJobFailedMarksFailed() {
        GenerationJob job = newGenerationJob(GenerationJob.STATUS_PROCESSING, "t1", 1);
        when(volcEngineService.getVideoTask("t1"))
                .thenReturn(new VideoTaskResult("failed", null, "balance", "余额不足"));

        service.pollJob(job);
        assertThat(captureUpdate().getStatus()).isEqualTo(GenerationJob.STATUS_FAILED);
    }

    @Test
    void pollJobPollCountExceedsMarksTimeout() {
        GenerationJob job = newGenerationJob(GenerationJob.STATUS_PROCESSING, "t1", GenerationJobService.MAX_POLL_COUNT);

        service.pollJob(job);

        verifyNoInteractions(volcEngineService);
        assertThat(captureUpdate().getStatus()).isEqualTo(GenerationJob.STATUS_FAILED);
    }

    @Test
    void pollJobRunningUpdatesProgressNoDownload() {
        GenerationJob job = newGenerationJob(GenerationJob.STATUS_PROCESSING, "t1", 0);
        when(volcEngineService.getVideoTask("t1"))
                .thenReturn(new VideoTaskResult("running", null, null, null));

        service.pollJob(job);

        GenerationJob updated = captureUpdate();
        assertThat(updated.getStatus()).isEqualTo(GenerationJob.STATUS_PROCESSING);
        assertThat(updated.getPollCount()).isEqualTo(1);
        verify(assetStorageService, never()).downloadAndStore(any(), any(), any(), any());
    }

    @Test
    void pollJobNotProcessingSkips() {
        GenerationJob job = newGenerationJob(GenerationJob.STATUS_QUEUED, null, 0);
        service.pollJob(job);
        verifyNoInteractions(volcEngineService);
        verify(jobMapper, never()).updateById(any(GenerationJob.class));
    }

    @Test
    void createImageJobInsertsQueuedBeforeGeneration() {
        ImageGenerateRequest req = new ImageGenerateRequest("cat", null, null, null, null);
        when(volcEngineService.generateImage(any(), any(), any())).thenReturn("https://ark/img.png");
        when(assetStorageService.downloadAndStore(any(), any(), any(), any())).thenReturn(imageAsset(1L, "/assets/a.png"));

        // insert 与 updateById 共用同一 job 引用，事后捕获会被 setStatus(succeeded) 覆盖；
        // 用 Answer 在 insert 时刻快照 status + type。
        AtomicReference<String> insertedStatus = new AtomicReference<>();
        AtomicReference<String> insertedType = new AtomicReference<>();
        when(jobMapper.insert(any(GenerationJob.class))).thenAnswer(inv -> {
            GenerationJob j = inv.getArgument(0);
            insertedStatus.set(j.getStatus());
            insertedType.set(j.getType());
            j.setId(1L);
            return 1;
        });

        service.createImageJob(req, 7L);

        assertThat(insertedStatus.get()).isEqualTo(GenerationJob.STATUS_QUEUED);
        assertThat(insertedType.get()).isEqualTo(GenerationJob.TYPE_IMAGE);
        verify(jobMapper).updateById(any(GenerationJob.class));
    }

    @Test
    void createVideoJobSingleUpdate() {
        VideoGenerateRequest req = new VideoGenerateRequest("p", null, null, null, null, null);
        when(volcEngineService.createVideoTask(any(), any(), any(), any(), any())).thenReturn("t1");
        service.createVideoJob(req, 7L);
        verify(jobMapper, times(1)).updateById(any(GenerationJob.class));
    }

    private GenerationJob newGenerationJob(String status, String providerTaskId, int pollCount) {
        GenerationJob job = new GenerationJob()
                .setUserId(7L)
                .setStatus(status)
                .setProviderTaskId(providerTaskId)
                .setPollCount(pollCount);
        job.setId(1L);
        return job;
    }

    /** 捕获最后一次 updateById 的 job。 */
    private GenerationJob captureUpdate() {
        ArgumentCaptor<GenerationJob> c = ArgumentCaptor.forClass(GenerationJob.class);
        verify(jobMapper).updateById(c.capture());
        return c.getValue();
    }
}
