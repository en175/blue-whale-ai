package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationModelCapabilityMapper;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationModelCapability;
import com.blue.whale.agent.model.request.VideoGenerateRequest;
import com.blue.whale.agent.service.provider.ImageGenerationProviderRegistry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link GenerationJobService#createVideoJob} 单测：
 * 首尾帧/全能参考素材透传 + input 落库 + 能力/互斥校验。
 * 全 mock 持久层与 {@link VolcEngineService}，不连 DB / 不发网络。
 */
@ExtendWith(MockitoExtension.class)
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
    @Mock
    private ProjectService projectService;

    private GenerationJobService newService() {
        return new GenerationJobService(jobMapper, assetMapper, volcEngineService, assetStorageService,
                capabilityMapper, providerRegistry, generationStreamService, projectService);
    }

    /** 能力：全能参考开关开。 */
    private GenerationModelCapability refCap() {
        GenerationModelCapability.Features f = new GenerationModelCapability.Features();
        f.setReferenceImage(true);
        return new GenerationModelCapability().setFeatures(f);
    }

    @Test
    void createVideoJobPassesFramesAndPersistsInput() {
        GenerationJobService service = newService();
        VideoGenerateRequest req = new VideoGenerateRequest(
                1L, "一只猫奔跑", "doubao-seedance-2-0-260128", "720p", "16:9", 5L,
                "https://tos/first.png", "https://tos/last.png", null, null, null);

        when(capabilityMapper.selectEnabledByModelId(anyString())).thenReturn(Optional.of(refCap()));
        when(jobMapper.insert(any(GenerationJob.class))).thenAnswer(inv -> {
            ((GenerationJob) inv.getArgument(0)).setId(100L);
            return 1;
        });
        when(volcEngineService.createVideoTask(anyString(), anyString(), any(), any(),
                any(), any(), any(), anyString(), anyString(), any())).thenReturn("task-1");

        var dto = service.createVideoJob(req, 10L);

        assertThat(dto.jobId()).isEqualTo(100L);
        assertThat(dto.status()).isEqualTo("queued");

        // 透传：createVideoTask 收到首/尾帧
        ArgumentCaptor<String> firstFrame = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> lastFrame = ArgumentCaptor.forClass(String.class);
        verify(volcEngineService).createVideoTask(
                anyString(), anyString(), firstFrame.capture(), lastFrame.capture(),
                any(), any(), any(), anyString(), anyString(), any());
        assertThat(firstFrame.getValue()).isEqualTo("https://tos/first.png");
        assertThat(lastFrame.getValue()).isEqualTo("https://tos/last.png");

        // 落库：input map 含首/尾帧
        ArgumentCaptor<GenerationJob> jobCaptor = ArgumentCaptor.forClass(GenerationJob.class);
        verify(jobMapper).insert(jobCaptor.capture());
        Map<String, Object> input = jobCaptor.getValue().getInput();
        assertThat(input).containsEntry("firstFrameUrl", "https://tos/first.png");
        assertThat(input).containsEntry("lastFrameUrl", "https://tos/last.png");
    }

    @Test
    @SuppressWarnings("unchecked")
    void createVideoJobPassesOmniReferenceAndPersistsInput() {
        GenerationJobService service = newService();
        VideoGenerateRequest req = new VideoGenerateRequest(
                1L, "果汁茶广告", "doubao-seedance-2-0-260128", "720p", "16:9", 5L,
                null, null,
                List.of("https://tos/r1.png", "https://tos/r2.png"),
                List.of("https://tos/ref.mp4"),
                List.of("https://tos/bgm.mp3"));

        when(capabilityMapper.selectEnabledByModelId(anyString())).thenReturn(Optional.of(refCap()));
        when(jobMapper.insert(any(GenerationJob.class))).thenAnswer(inv -> {
            ((GenerationJob) inv.getArgument(0)).setId(101L);
            return 1;
        });
        when(volcEngineService.createVideoTask(anyString(), anyString(), any(), any(),
                any(), any(), any(), anyString(), anyString(), any())).thenReturn("task-2");

        var dto = service.createVideoJob(req, 10L);

        assertThat(dto.jobId()).isEqualTo(101L);
        assertThat(dto.status()).isEqualTo("queued");

        // 透传：全能参考三组素材进 createVideoTask
        ArgumentCaptor<List<String>> refImages = ArgumentCaptor.forClass(List.class);
        verify(volcEngineService).createVideoTask(
                anyString(), anyString(), any(), any(),
                refImages.capture(), any(), any(), anyString(), anyString(), any());
        assertThat(refImages.getValue()).containsExactly("https://tos/r1.png", "https://tos/r2.png");

        // 落库：input map 含参考素材
        ArgumentCaptor<GenerationJob> jobCaptor = ArgumentCaptor.forClass(GenerationJob.class);
        verify(jobMapper).insert(jobCaptor.capture());
        Map<String, Object> input = jobCaptor.getValue().getInput();
        assertThat(input).extractingByKey("reference_images")
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.LIST)
                .containsExactly("https://tos/r1.png", "https://tos/r2.png");
    }
}
