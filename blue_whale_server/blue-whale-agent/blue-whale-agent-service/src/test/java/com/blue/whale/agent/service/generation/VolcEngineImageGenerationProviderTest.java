package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.mapper.GenerationModelCapabilityMapper;
import com.blue.whale.agent.model.dto.AssetContent;
import com.blue.whale.agent.model.entity.GenerationModelCapability;
import com.blue.whale.agent.service.ProjectAssetContentService;
import com.volcengine.ark.runtime.model.images.generation.GenerateImagesRequest;
import com.volcengine.ark.runtime.model.images.generation.ImagesResponse;
import com.volcengine.ark.runtime.model.images.generation.ResponseFormat;
import com.volcengine.ark.runtime.service.ArkService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;

import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class VolcEngineImageGenerationProviderTest {

    private static final byte[] ONE_PIXEL_PNG = Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
    private static final String ONE_PIXEL_PNG_B64 = Base64.getEncoder().encodeToString(ONE_PIXEL_PNG);

    @Test
    void agentPathDefaultsToEnabledModelAndDefaultSizeWithoutTools() {
        GenerationModelCapabilityMapper mapper = mock(GenerationModelCapabilityMapper.class);
        when(mapper.selectEnabledByCapabilityType("image")).thenReturn(List.of(seedream()));
        ArkService arkService = mock(ArkService.class);
        when(arkService.generateImages(any())).thenReturn(pngResponse(ONE_PIXEL_PNG_B64));
        VolcEngineImageGenerationProvider provider = newProvider(arkService, mapper);

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                7L, 11L, Map.of("prompt", "a blue whale")));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.SUCCESS);
        assertThat(result.content()).isEqualTo(ONE_PIXEL_PNG);
        GenerateImagesRequest req = captureRequest(arkService);
        assertThat(req.getModel()).isEqualTo("doubao-seedream-5.0-lite");
        assertThat(req.getSize()).isEqualTo("2K");
        assertThat(req.getResponseFormat()).isEqualTo(ResponseFormat.Base64);
        assertThat(req.getOutputFormat()).isEqualTo("png");
        assertThat(req.getTools()).isNull();
        assertThat(req.getImage()).isNull();
    }

    @Test
    void explicitModelAndSizeAreUsedFromInput() {
        GenerationModelCapabilityMapper mapper = mock(GenerationModelCapabilityMapper.class);
        when(mapper.selectEnabledByModelId("doubao-seedream-5.0-lite")).thenReturn(Optional.of(seedream()));
        ArkService arkService = mock(ArkService.class);
        when(arkService.generateImages(any())).thenReturn(pngResponse(ONE_PIXEL_PNG_B64));
        VolcEngineImageGenerationProvider provider = newProvider(arkService, mapper);

        provider.generate(new GenerationProviderRequest(7L, 11L, Map.of(
                "prompt", "whale", "model_id", "doubao-seedream-5.0-lite", "size", "4k")));

        GenerateImagesRequest req = captureRequest(arkService);
        assertThat(req.getModel()).isEqualTo("doubao-seedream-5.0-lite");
        assertThat(req.getSize()).isEqualTo("4K");
    }

    @Test
    void webSearchTrueAttachesWebSearchTool() {
        ArkService arkService = mock(ArkService.class);
        when(arkService.generateImages(any())).thenReturn(pngResponse(ONE_PIXEL_PNG_B64));
        VolcEngineImageGenerationProvider provider = newProvider(arkService, defaultMapper());

        provider.generate(new GenerationProviderRequest(7L, 11L, Map.of(
                "prompt", "whale", "web_search", true)));

        GenerateImagesRequest req = captureRequest(arkService);
        assertThat(req.getTools()).hasSize(1);
        assertThat(req.getTools().get(0).getType()).isEqualTo("web_search");
    }

    @Test
    void webSearchMissingOrFalseDoesNotAttachTools() {
        ArkService arkService = mock(ArkService.class);
        when(arkService.generateImages(any())).thenReturn(pngResponse(ONE_PIXEL_PNG_B64));
        VolcEngineImageGenerationProvider provider = newProvider(arkService, defaultMapper());

        provider.generate(new GenerationProviderRequest(7L, 11L, Map.of(
                "prompt", "whale", "web_search", false)));

        GenerateImagesRequest req = captureRequest(arkService);
        assertThat(req.getTools()).isNull();
    }

    @Test
    void referenceAssetIdsAreReadAndAttachedAsDataUrls() {
        GenerationModelCapabilityMapper mapper = defaultMapper();
        ProjectAssetContentService assetContentService = mock(ProjectAssetContentService.class);
        when(assetContentService.read(7L, 91L, 11L)).thenReturn(
                new AssetContent(ONE_PIXEL_PNG, "image/png"));
        ArkService arkService = mock(ArkService.class);
        when(arkService.generateImages(any())).thenReturn(pngResponse(ONE_PIXEL_PNG_B64));
        VolcEngineImageGenerationProvider provider = new VolcEngineImageGenerationProvider(
                objectProvider(arkService), assetContentService, mapper);

        provider.generate(new GenerationProviderRequest(7L, 11L, Map.of(
                "prompt", "edit", "reference_asset_ids", List.of(91L))));

        GenerateImagesRequest req = captureRequest(arkService);
        assertThat(req.getImage()).hasSize(1);
        assertThat(req.getImage().get(0)).startsWith("data:image/png;base64,");
        verify(assetContentService).read(7L, 91L, 11L);
    }

    @Test
    void referenceImagesExceedingModelLimitRejectedWithExplicitError() {
        GenerationModelCapability capability = seedream();
        capability.getFeatures().setMaxReferenceImages(2);
        GenerationModelCapabilityMapper mapper = mock(GenerationModelCapabilityMapper.class);
        when(mapper.selectEnabledByModelId("doubao-seedream-5.0-lite"))
                .thenReturn(Optional.of(capability));
        ArkService arkService = mock(ArkService.class);
        VolcEngineImageGenerationProvider provider = newProvider(arkService, mapper);

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(7L, 11L, Map.of(
                "prompt", "edit", "model_id", "doubao-seedream-5.0-lite",
                "reference_asset_ids", List.of(1L, 2L, 3L))));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.FAILURE);
        assertThat(result.errorCode()).isEqualTo("reference_images_exceed_limit");
        verify(arkService, never()).generateImages(any());
    }

    @Test
    void referenceImagesWithinModelLimitAreAccepted() {
        GenerationModelCapability capability = seedream();
        capability.getFeatures().setMaxReferenceImages(10);
        GenerationModelCapabilityMapper mapper = mock(GenerationModelCapabilityMapper.class);
        when(mapper.selectEnabledByModelId("doubao-seedream-5.0-lite"))
                .thenReturn(Optional.of(capability));
        ProjectAssetContentService assetContentService = mock(ProjectAssetContentService.class);
        when(assetContentService.read(7L, 1L, 11L)).thenReturn(
                new AssetContent(ONE_PIXEL_PNG, "image/png"));
        when(assetContentService.read(7L, 2L, 11L)).thenReturn(
                new AssetContent(ONE_PIXEL_PNG, "image/png"));
        ArkService arkService = mock(ArkService.class);
        when(arkService.generateImages(any())).thenReturn(pngResponse(ONE_PIXEL_PNG_B64));
        VolcEngineImageGenerationProvider provider = new VolcEngineImageGenerationProvider(
                objectProvider(arkService), assetContentService, mapper);

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(7L, 11L, Map.of(
                "prompt", "edit", "model_id", "doubao-seedream-5.0-lite",
                "reference_asset_ids", List.of(1L, 2L))));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.SUCCESS);
        GenerateImagesRequest req = captureRequest(arkService);
        assertThat(req.getImage()).hasSize(2);
    }

    @Test
    void unavailableModelIsRejectedBeforePaidCall() {
        GenerationModelCapabilityMapper mapper = mock(GenerationModelCapabilityMapper.class);
        when(mapper.selectEnabledByModelId("unknown-model")).thenReturn(Optional.empty());
        ArkService arkService = mock(ArkService.class);
        VolcEngineImageGenerationProvider provider = newProvider(arkService, mapper);

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                7L, 11L, Map.of("prompt", "whale", "model_id", "unknown-model")));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.FAILURE);
        assertThat(result.errorCode()).isEqualTo("model_unavailable");
        verify(arkService, never()).generateImages(any());
    }

    @Test
    void invalidSizeIsRejectedBeforePaidCall() {
        ArkService arkService = mock(ArkService.class);
        VolcEngineImageGenerationProvider provider = newProvider(arkService, defaultMapper());

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                7L, 11L, Map.of("prompt", "whale", "model_id", "doubao-seedream-5.0-lite",
                        "size", "8k")));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.FAILURE);
        assertThat(result.errorCode()).isEqualTo("invalid_size");
        verify(arkService, never()).generateImages(any());
    }

    @Test
    void arkServiceAbsentReturnsNotConfiguredFailure() {
        VolcEngineImageGenerationProvider provider = new VolcEngineImageGenerationProvider(
                objectProvider(null), mock(ProjectAssetContentService.class), defaultMapper());

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                7L, 11L, Map.of("prompt", "whale")));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.FAILURE);
        assertThat(result.errorCode()).isEqualTo("provider_not_configured");
    }

    @Test
    void arkRuntimeExceptionMapsToUnavailable() {
        ArkService arkService = mock(ArkService.class);
        when(arkService.generateImages(any())).thenThrow(new RuntimeException("upstream down"));
        VolcEngineImageGenerationProvider provider = newProvider(arkService, defaultMapper());

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                7L, 11L, Map.of("prompt", "whale")));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.FAILURE);
        assertThat(result.errorCode()).isEqualTo("provider_unavailable");
    }

    @Test
    void emptyDataReturnsNoResult() {
        ArkService arkService = mock(ArkService.class);
        ImagesResponse empty = new ImagesResponse();
        empty.setData(List.of());
        when(arkService.generateImages(any())).thenReturn(empty);
        VolcEngineImageGenerationProvider provider = newProvider(arkService, defaultMapper());

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                7L, 11L, Map.of("prompt", "whale")));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.NO_RESULT);
    }

    @Test
    void sequentialFlagProducesMultipleImagesWithAutoAndMaxImages() {
        GenerationModelCapabilityMapper mapper = defaultMapper();
        ArkService arkService = mock(ArkService.class);
        when(arkService.generateImages(any())).thenReturn(pngResponse(List.of(
                ONE_PIXEL_PNG_B64, ONE_PIXEL_PNG_B64, ONE_PIXEL_PNG_B64)));
        VolcEngineImageGenerationProvider provider = newProvider(arkService, mapper);

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(7L, 11L, Map.of(
                "prompt", "三联组图", "model_id", "doubao-seedream-5.0-lite",
                "sequential_image_generation", true, "max_images", 3)));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.SUCCESS);
        assertThat(result.images()).hasSize(3);
        assertThat(result.content()).isEqualTo(ONE_PIXEL_PNG);
        GenerateImagesRequest req = captureRequest(arkService);
        assertThat(req.getSequentialImageGeneration()).isEqualTo("auto");
        assertThat(req.getSequentialImageGenerationOptions()).isNotNull();
        assertThat(req.getSequentialImageGenerationOptions().getMaxImages()).isEqualTo(3);
    }

    @Test
    void sequentialFlagRejectedWhenCapabilityNotDeclared() {
        GenerationModelCapability capability = new GenerationModelCapability();
        capability.setModelId("doubao-seedream-5.0-lite");
        capability.setCapabilityType("image");
        capability.setSupportedSizes(List.of(sizeOption("2k", "2K")));
        capability.setDefaultSize("2K");
        GenerationModelCapability.Features features = new GenerationModelCapability.Features();
        features.setQuantityMax(4);
        capability.setFeatures(features);
        GenerationModelCapabilityMapper mapper = mock(GenerationModelCapabilityMapper.class);
        when(mapper.selectEnabledByModelId("doubao-seedream-5.0-lite"))
                .thenReturn(Optional.of(capability));
        ArkService arkService = mock(ArkService.class);
        VolcEngineImageGenerationProvider provider = newProvider(arkService, mapper);

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(7L, 11L, Map.of(
                "prompt", "组图", "model_id", "doubao-seedream-5.0-lite",
                "sequential_image_generation", true, "max_images", 3)));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.FAILURE);
        assertThat(result.errorCode()).isEqualTo("sequential_unsupported");
        verify(arkService, never()).generateImages(any());
    }

    @Test
    void missingPromptRejectedBeforePaidCall() {
        ArkService arkService = mock(ArkService.class);
        VolcEngineImageGenerationProvider provider = newProvider(arkService, defaultMapper());

        GenerationProviderResult result = provider.generate(new GenerationProviderRequest(
                7L, 11L, Map.of("model_id", "doubao-seedream-5.0-lite")));

        assertThat(result.status()).isEqualTo(GenerationProviderResult.Status.FAILURE);
        assertThat(result.errorCode()).isEqualTo("invalid_request");
        verifyNoInteractions(arkService);
    }

    private VolcEngineImageGenerationProvider newProvider(
            ArkService arkService, GenerationModelCapabilityMapper mapper) {
        return new VolcEngineImageGenerationProvider(
                objectProvider(arkService), mock(ProjectAssetContentService.class), mapper);
    }

    @SuppressWarnings("unchecked")
    private ObjectProvider<ArkService> objectProvider(ArkService arkService) {
        ObjectProvider<ArkService> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(arkService);
        return provider;
    }

    private GenerationModelCapabilityMapper defaultMapper() {
        GenerationModelCapabilityMapper mapper = mock(GenerationModelCapabilityMapper.class);
        when(mapper.selectEnabledByCapabilityType("image")).thenReturn(List.of(seedream()));
        when(mapper.selectEnabledByModelId("doubao-seedream-5.0-lite"))
                .thenReturn(Optional.of(seedream()));
        return mapper;
    }

    private GenerateImagesRequest captureRequest(ArkService arkService) {
        ArgumentCaptor<GenerateImagesRequest> captor =
                ArgumentCaptor.forClass(GenerateImagesRequest.class);
        verify(arkService).generateImages(captor.capture());
        return captor.getValue();
    }

    private ImagesResponse pngResponse(String b64) {
        ImagesResponse.Image image = new ImagesResponse.Image();
        image.setB64Json(b64);
        ImagesResponse response = new ImagesResponse();
        response.setData(List.of(image));
        return response;
    }

    private ImagesResponse pngResponse(List<String> base64Images) {
        List<ImagesResponse.Image> images = new ArrayList<>();
        for (String b64 : base64Images) {
            ImagesResponse.Image image = new ImagesResponse.Image();
            image.setB64Json(b64);
            images.add(image);
        }
        ImagesResponse response = new ImagesResponse();
        response.setData(images);
        return response;
    }

    private GenerationModelCapability seedream() {
        GenerationModelCapability capability = new GenerationModelCapability();
        capability.setModelId("doubao-seedream-5.0-lite");
        capability.setCapabilityType("image");
        capability.setSupportedSizes(List.of(
                sizeOption("2k", "2K"), sizeOption("3k", "3K"), sizeOption("4k", "4K")));
        capability.setDefaultSize("2K");
        GenerationModelCapability.Features features = new GenerationModelCapability.Features();
        features.setReferenceImage(true);
        features.setQuantityMax(4);
        features.setSequentialImageGeneration(true);
        capability.setFeatures(features);
        return capability;
    }

    private GenerationModelCapability.SizeOption sizeOption(String id, String apiValue) {
        GenerationModelCapability.SizeOption option = new GenerationModelCapability.SizeOption();
        option.setId(id);
        option.setApiValue(apiValue);
        return option;
    }
}
