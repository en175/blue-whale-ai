package com.bluewhale.agent.service;

import com.bluewhale.agent.mapper.GenerationJobMapper;
import com.bluewhale.agent.model.dto.ProviderImageGenerationRequest;
import com.bluewhale.agent.model.entity.Asset;
import com.bluewhale.agent.model.entity.GenerationJob;
import com.bluewhale.agent.model.entity.GenerationModelCapability;
import com.bluewhale.agent.service.provider.ImageGenerationProviderRegistry;
import com.volcengine.ark.runtime.model.images.generation.ImageGenStreamEvent;
import io.reactivex.Flowable;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link GenerationStreamService} 测试：mock Provider 流式事件 + assetStorage + bus，
 * 覆盖逐张成功落库、单张失败继续、InternalServiceError 终止。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class GenerationStreamServiceTest {

    private static final String MODEL_ID = "doubao-seedream-5-0-lite-250723";

    @Mock
    private GenerationJobMapper jobMapper;
    @Mock
    private AssetStorageService assetStorageService;
    @Mock
    private ImageGenerationProviderRegistry providerRegistry;
    @Mock
    private JobStreamBus bus;
    @Mock
    private VolcEngineService volcEngineService;

    @InjectMocks
    private GenerationStreamService service;

    @Test
    void runImageStreamAppendsAssetsAndEmitsDone() {
        GenerationJob job = new GenerationJob().setUserId(7L).setStatus(GenerationJob.STATUS_PROCESSING);
        job.setId(1L);
        when(jobMapper.selectById(1L)).thenReturn(job);
        when(providerRegistry.getProvider("volcengine")).thenReturn(volcEngineService);
        when(volcEngineService.streamGenerateImages(any())).thenReturn(Flowable.just(
                event("image_generation.partial_succeeded", "https://ark/1.png", 0, null),
                event("image_generation.partial_succeeded", "https://ark/2.png", 1, null)));
        when(assetStorageService.downloadAndStore(eq("https://ark/1.png"), eq(7L), eq(Asset.TYPE_IMAGE), any()))
                .thenReturn(asset(10L, "/a/1.png"));
        when(assetStorageService.downloadAndStore(eq("https://ark/2.png"), eq(7L), eq(Asset.TYPE_IMAGE), any()))
                .thenReturn(asset(11L, "/a/2.png"));

        service.runImageStream(1L, capability(), req());

        ArgumentCaptor<GenerationJob> cap = ArgumentCaptor.forClass(GenerationJob.class);
        verify(jobMapper, atLeast(2)).updateById(cap.capture());
        GenerationJob last = cap.getAllValues().get(cap.getAllValues().size() - 1);
        assertThat(last.getStatus()).isEqualTo(GenerationJob.STATUS_SUCCEEDED);
        assertThat(last.getProgress()).isEqualTo(100);
        assertThat(last.getOutputAssetIds()).containsExactly(10L, 11L);
        verify(bus, times(2)).emit(eq(1L), argThat(p -> "image".equals(p.type())));
        verify(bus).emit(eq(1L), argThat(p -> "done".equals(p.type())));
        verify(bus).complete(1L);
    }

    @Test
    void partialFailedNonInternalContinues() {
        GenerationJob job = new GenerationJob().setUserId(7L).setStatus(GenerationJob.STATUS_PROCESSING);
        job.setId(1L);
        when(jobMapper.selectById(1L)).thenReturn(job);
        when(providerRegistry.getProvider("volcengine")).thenReturn(volcEngineService);
        when(volcEngineService.streamGenerateImages(any())).thenReturn(Flowable.just(
                failedEvent(0, "moderation_blocked", "违规"),
                event("image_generation.partial_succeeded", "https://ark/ok.png", 1, null)));
        when(assetStorageService.downloadAndStore(eq("https://ark/ok.png"), eq(7L), eq(Asset.TYPE_IMAGE), any()))
                .thenReturn(asset(20L, "/a/ok.png"));

        service.runImageStream(1L, capability(), req());

        ArgumentCaptor<GenerationJob> cap = ArgumentCaptor.forClass(GenerationJob.class);
        verify(jobMapper, atLeast(1)).updateById(cap.capture());
        GenerationJob last = cap.getAllValues().get(cap.getAllValues().size() - 1);
        assertThat(last.getStatus()).isEqualTo(GenerationJob.STATUS_SUCCEEDED);
        assertThat(last.getOutputAssetIds()).containsExactly(20L);
        verify(bus).emit(eq(1L), argThat(p -> "image_failed".equals(p.type())));
    }

    @Test
    void internalServiceErrorTerminatesAsFailed() {
        GenerationJob job = new GenerationJob().setUserId(7L).setStatus(GenerationJob.STATUS_PROCESSING);
        job.setId(1L);
        when(jobMapper.selectById(1L)).thenReturn(job);
        when(providerRegistry.getProvider("volcengine")).thenReturn(volcEngineService);
        when(volcEngineService.streamGenerateImages(any())).thenReturn(Flowable.just(
                failedEvent(0, "InternalServiceError", "内部错误")));

        service.runImageStream(1L, capability(), req());

        ArgumentCaptor<GenerationJob> cap = ArgumentCaptor.forClass(GenerationJob.class);
        verify(jobMapper).updateById(cap.capture());
        assertThat(cap.getValue().getStatus()).isEqualTo(GenerationJob.STATUS_FAILED);
        verify(bus).emit(eq(1L), argThat(p -> "error".equals(p.type())));
        verify(bus).complete(1L);
    }

    private ImageGenStreamEvent event(String type, String url, int index, ImageGenStreamEvent.Error error) {
        ImageGenStreamEvent e = new ImageGenStreamEvent();
        e.setType(type);
        e.setUrl(url);
        e.setImageIndex(index);
        if (error != null) {
            e.setError(error);
        }
        return e;
    }

    private ImageGenStreamEvent failedEvent(int index, String code, String msg) {
        ImageGenStreamEvent.Error err = new ImageGenStreamEvent.Error();
        err.setCode(code);
        err.setMessage(msg);
        return event("image_generation.partial_failed", null, index, err);
    }

    private Asset asset(long id, String url) {
        Asset a = new Asset().setUrl(url).setType(Asset.TYPE_IMAGE);
        a.setId(id);
        return a;
    }

    private GenerationModelCapability capability() {
        return new GenerationModelCapability().setProviderId("volcengine").setModelId(MODEL_ID);
    }

    private ProviderImageGenerationRequest req() {
        return ProviderImageGenerationRequest.builder().modelId(MODEL_ID).prompt("cat").size("2K").build();
    }
}
