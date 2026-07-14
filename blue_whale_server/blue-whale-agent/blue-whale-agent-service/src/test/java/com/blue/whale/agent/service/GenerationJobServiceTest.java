package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationModelCapabilityMapper;
import com.blue.whale.agent.model.dto.ImageGenerateRequest;
import com.blue.whale.agent.model.entity.GenerationJob;
import com.blue.whale.agent.model.entity.GenerationModelCapability;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.service.provider.ImageGenerationProviderRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class GenerationJobServiceTest {

    @Mock private GenerationJobMapper jobMapper;
    @Mock private AssetMapper assetMapper;
    @Mock private VolcEngineService volcEngineService;
    @Mock private AssetStorageService assetStorageService;
    @Mock private GenerationModelCapabilityMapper capabilityMapper;
    @Mock private ImageGenerationProviderRegistry providerRegistry;
    @Mock private GenerationStreamService generationStreamService;
    @Mock private ProjectEventService projectEventService;
    @Mock private ProjectService projectService;

    private GenerationJobService service;

    @BeforeEach
    void setUp() {
        service = new GenerationJobService(jobMapper, assetMapper, volcEngineService,
                assetStorageService, capabilityMapper, providerRegistry, generationStreamService,
                projectEventService, projectService);
    }

    @Test
    void projectGenerationValidatesOwnershipAndPersistsProjectOnJob() {
        GenerationModelCapability.SizeOption size = new GenerationModelCapability.SizeOption();
        size.setId("2k");
        size.setApiValue("2048x2048");
        GenerationModelCapability.Features features = new GenerationModelCapability.Features();
        features.setStream(true);
        features.setQuantityMax(1);
        GenerationModelCapability capability = new GenerationModelCapability()
                .setModelId("model")
                .setProviderId("provider")
                .setSupportedSizes(List.of(size))
                .setSupportedFormats(List.of())
                .setDefaultSize("2k")
                .setFeatures(features);
        when(capabilityMapper.selectEnabledByModelId("model")).thenReturn(Optional.of(capability));
        when(projectService.requireOwned(3L, 10L)).thenReturn(new Project().setOwnerId(10L));
        when(jobMapper.insert(any(GenerationJob.class))).thenAnswer(invocation -> {
            GenerationJob job = invocation.getArgument(0);
            job.setId(7L);
            job.setVersion(0);
            return 1;
        });
        ImageGenerateRequest request = new ImageGenerateRequest(
                "prompt", "model", "2k", "1:1", null, 1, false, List.<String>of(), 3L);

        service.createImageJob(request, 10L);

        ArgumentCaptor<GenerationJob> inserted = ArgumentCaptor.forClass(GenerationJob.class);
        verify(jobMapper).insert(inserted.capture());
        assertThat(inserted.getValue().getProjectId()).isEqualTo(3L);
        verify(projectService).requireOwned(3L, 10L);
        verify(projectEventService, times(2)).appendEvent(
                org.mockito.ArgumentMatchers.eq(3L), any(), any(), any(), any(), any(), any(), any());
    }
}
