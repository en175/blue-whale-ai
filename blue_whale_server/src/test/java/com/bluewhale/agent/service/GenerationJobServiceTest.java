package com.bluewhale.agent.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.bluewhale.agent.common.exception.GlobalException;
import com.bluewhale.agent.mapper.AssetMapper;
import com.bluewhale.agent.mapper.GenerationJobMapper;
import com.bluewhale.agent.mapper.GenerationModelCapabilityMapper;
import com.bluewhale.agent.model.dto.CreateJobResponse;
import com.bluewhale.agent.model.dto.ImageGenerateRequest;
import com.bluewhale.agent.model.dto.ImageGenerationResult;
import com.bluewhale.agent.model.dto.ImageGenerateResponse;
import com.bluewhale.agent.model.dto.JobListItemResponse;
import com.bluewhale.agent.model.dto.JobStatusResponse;
import com.bluewhale.agent.model.dto.ProviderImageGenerationRequest;
import com.bluewhale.agent.model.dto.VideoGenerateRequest;
import com.bluewhale.agent.model.dto.VideoTaskResult;
import com.bluewhale.agent.model.entity.Asset;
import com.bluewhale.agent.model.entity.GenerationJob;
import com.bluewhale.agent.model.entity.GenerationModelCapability;
import com.bluewhale.agent.service.provider.ImageGenerationProviderRegistry;
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
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link GenerationJobService} 测试：mock mapper + Provider registry + AssetStorageService，
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
    @Mock
    private GenerationModelCapabilityMapper capabilityMapper;
    @Mock
    private ImageGenerationProviderRegistry providerRegistry;
    @Mock
    private GenerationStreamService generationStreamService;

    @InjectMocks
    private GenerationJobService service;

    private static final String MODEL_ID = "doubao-seedream-5-0-lite-250723";

    @BeforeEach
    void setUp() {
        when(jobMapper.insert(any(GenerationJob.class))).thenAnswer(inv -> {
            ((GenerationJob) inv.getArgument(0)).setId(1L);
            return 1;
        });
        GenerationModelCapability cap = imageCapability();
        when(capabilityMapper.selectEnabledByModelId(MODEL_ID)).thenReturn(Optional.of(cap));
        when(providerRegistry.getProvider("volcengine")).thenReturn(volcEngineService);
    }

    private GenerationModelCapability imageCapability() {
        GenerationModelCapability.SizeOption size = new GenerationModelCapability.SizeOption();
        size.setId("2k");
        size.setLabel("2K");
        size.setApiValue("2K");

        GenerationModelCapability.Features features = new GenerationModelCapability.Features();
        features.setReferenceImage(true);
        features.setWatermark(true);
        features.setQuantityMax(15);
        features.setSequentialImageGeneration(false);
        features.setStream(false);
        features.setTools(false);

        return new GenerationModelCapability()
                .setProviderId("volcengine")
                .setModelId(MODEL_ID)
                .setCapabilityType(GenerationModelCapability.CAPABILITY_IMAGE)
                .setModelLabel("Seedream 5.0 Lite")
                .setSupportedSizes(List.of(size))
                .setSupportedAspectRatios(List.of("1:1", "16:9"))
                .setSupportedFormats(List.of("png", "jpeg"))
                .setDefaultSize("2k")
                .setDefaultFormat("jpeg")
                .setDefaultAspectRatio("1:1")
                .setFeatures(features)
                .setEnabled(true);
    }

    private Asset imageAsset(long id, String url) {
        Asset a = new Asset().setUrl(url).setType(Asset.TYPE_IMAGE);
        a.setId(id);
        return a;
    }

    private ImageGenerateRequest imageReq(String prompt) {
        return new ImageGenerateRequest(prompt, MODEL_ID, "2k", "1:1", null, 1, null, null);
    }

    @Test
    void createImageJobSuccessReturnsAsset() {
        ImageGenerateRequest req = imageReq("cat");
        when(volcEngineService.generate(any(ProviderImageGenerationRequest.class)))
                .thenReturn(new ImageGenerationResult("https://ark/img.png"));
        when(assetStorageService.downloadAndStore("https://ark/img.png", 7L, Asset.TYPE_IMAGE, null))
                .thenReturn(imageAsset(9L, "/assets/x.png"));

        ImageGenerateResponse r = service.createImageJob(req, 7L);

        assertThat(r.assetId()).isEqualTo(9L);
        assertThat(r.url()).isEqualTo("/assets/x.png");
        assertThat(r.stream()).isFalse();
        GenerationJob updated = captureUpdate();
        assertThat(updated.getStatus()).isEqualTo(GenerationJob.STATUS_SUCCEEDED);
        assertThat(updated.getOutputAssetIds()).containsExactly(9L);
    }

    @Test
    void createImageJobStreamingReturnsJobId() {
        GenerationModelCapability cap = imageCapability();
        cap.getFeatures().setStream(true);
        when(capabilityMapper.selectEnabledByModelId(MODEL_ID)).thenReturn(Optional.of(cap));

        ImageGenerateResponse r = service.createImageJob(imageReq("cat"), 7L);

        assertThat(r.stream()).isTrue();
        assertThat(r.jobId()).isEqualTo(1L);
        assertThat(r.status()).isEqualTo(GenerationJob.STATUS_PROCESSING);
        verify(volcEngineService, never()).generate(any());
        verify(generationStreamService).runImageStream(eq(1L), any(GenerationModelCapability.class), any());
    }

    @Test
    void createImageJobFailureMarksFailedAndThrows() {
        ImageGenerateRequest req = imageReq("cat");
        when(volcEngineService.generate(any()))
                .thenThrow(new GlobalException(400, "上游生成失败: boom"));

        assertThatThrownBy(() -> service.createImageJob(req, 7L)).isInstanceOf(GlobalException.class);
        assertThat(captureUpdate().getStatus()).isEqualTo(GenerationJob.STATUS_FAILED);
    }

    @Test
    void createImageJobUnsupportedModel() {
        ImageGenerateRequest req = new ImageGenerateRequest("cat", "unknown", "2k", "1:1", null, 1, null, null);
        when(capabilityMapper.selectEnabledByModelId("unknown")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.createImageJob(req, 7L))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("不支持的模型");
    }

    @Test
    void createImageJobUnsupportedSize() {
        ImageGenerateRequest req = new ImageGenerateRequest("cat", MODEL_ID, "8k", "1:1", null, 1, null, null);

        assertThatThrownBy(() -> service.createImageJob(req, 7L))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("模型不支持该尺寸");
    }

    @Test
    void createVideoJobSuccessReturnsQueued() {
        VideoGenerateRequest req = new VideoGenerateRequest("cat video", "vid-model", "720p", "16:9", 5L, null);
        when(volcEngineService.createVideoTask("vid-model", "cat video", null, "16:9", "720p", 5L)).thenReturn("task-1");

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
        VideoGenerateRequest req = new VideoGenerateRequest("p", "vid-model", null, null, null, null);
        when(volcEngineService.createVideoTask(any(), any(), any(), any(), any(), any()))
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
    void listJobsResolvesOutputAssetsWithoutNPlus1() {
        GenerationJob ok = new GenerationJob()
                .setUserId(7L).setType(GenerationJob.TYPE_IMAGE).setStatus(GenerationJob.STATUS_SUCCEEDED)
                .setProgress(100).setOutputAssetIds(List.of(9L, 11L));
        ok.setId(1L);
        GenerationJob processing = new GenerationJob()
                .setUserId(7L).setType(GenerationJob.TYPE_VIDEO).setStatus(GenerationJob.STATUS_PROCESSING)
                .setProgress(30);
        processing.setId(2L);

        Page<GenerationJob> page = new Page<>(1, 20, 2);
        page.setRecords(List.of(ok, processing));
        when(jobMapper.selectPage(any(Page.class), any())).thenReturn(page);

        Asset a9 = new Asset().setUrl("/assets/9.png").setType(Asset.TYPE_IMAGE).setWidth(512).setHeight(512);
        a9.setId(9L);
        Asset a11 = new Asset().setUrl("/assets/11.png").setType(Asset.TYPE_IMAGE).setWidth(1024).setHeight(1024);
        a11.setId(11L);
        when(assetMapper.selectBatchIds(any())).thenReturn(List.of(a9, a11));

        Page<JobListItemResponse> result = service.listJobs(7L, null, null, null, 1, 20);

        assertThat(result.getRecords()).hasSize(2);
        JobListItemResponse okItem = result.getRecords().get(0);
        assertThat(okItem.jobId()).isEqualTo(1L);
        assertThat(okItem.status()).isEqualTo(GenerationJob.STATUS_SUCCEEDED);
        assertThat(okItem.outputAssets()).hasSize(2);
        assertThat(okItem.outputAssets().get(0).url()).isEqualTo("/assets/9.png");
        assertThat(result.getRecords().get(1).outputAssets()).isEmpty();
        verify(assetMapper, times(1)).selectBatchIds(any());
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
        ImageGenerateRequest req = imageReq("cat");
        when(volcEngineService.generate(any())).thenReturn(new ImageGenerationResult("https://ark/img.png"));
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
        VideoGenerateRequest req = new VideoGenerateRequest("p", "vid-model", null, null, null, null);
        when(volcEngineService.createVideoTask(any(), any(), any(), any(), any(), any())).thenReturn("t1");
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
