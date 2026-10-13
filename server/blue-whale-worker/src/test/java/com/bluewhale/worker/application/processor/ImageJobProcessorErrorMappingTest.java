package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.entity.GenerationModelCapabilityEntity;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageProviderError;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient;
import com.bluewhale.worker.infrastructure.gateway.ImageProtocol;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient.GeneratedImage;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationModelCapabilityMapper;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ImageJobProcessorErrorMappingTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobFinalizer finalizer;
    @Mock private AssetSourceService assetSource;
    @Mock private UpstreamCredential upstreamCredential;
    @Mock private NewApiImageClient imageClient;
    @Mock private GenerationModelCapabilityMapper capabilityMapper;
    @Mock private TosMediaStorage tosService;

    private ImageJobProcessor processor;

    @BeforeEach
    void setUp() {
        processor = new ImageJobProcessor(
                stateMachine, finalizer, assetSource, upstreamCredential,
                imageClient, capabilityMapper, tosService);
    }


    @Test
    @DisplayName("G27: 缺少 prompt → invalid_input")
    void missingPrompt() {
        mockClaim(Map.of("model_id", "gpt-image-1"));

        processor.handle("100");

        verifyFailWithCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("G27b: 缺少 model_id → invalid_input")
    void missingModelId() {
        mockClaim(Map.of("prompt", "hello"));

        processor.handle("100");

        verifyFailWithCode(GenerationError.ERROR_INVALID_INPUT);
    }


    @Test
    @DisplayName("G28: capability 缺失 → model_unavailable")
    void modelUnavailable() {
        mockClaim(Map.of("prompt", "hello", "model_id", "unknown-model"));
        when(capabilityMapper.findByModelId("unknown-model")).thenReturn(null);

        processor.handle("100");

        verifyFailWithCode(GenerationError.ERROR_MODEL_UNAVAILABLE);
    }


    @Test
    @DisplayName("G29: 参考图数量超限 → invalid_reference")
    void referenceLimitExceeded() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1",
                "input_asset_ids", List.of("1", "2", "3")));
        mockClaim(input);

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        cap.setFeatures("{\"imageReferenceMax\": 2}");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);

        processor.handle("100");

        verifyFailWithCode(GenerationError.ERROR_INVALID_REFERENCE);
    }


    @Test
    @DisplayName("G30: 参考素材不存在 → invalid_reference")
    void referenceAssetMissing() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1",
                "input_asset_ids", List.of("1", "2")));
        mockClaim(input);

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(assetSource.resolveInputAssets(anyList(), anyString(), anyString()))
                .thenReturn(Map.of("1", mockAsset("1", "image")));

        processor.handle("100");

        verifyFailWithCode(GenerationError.ERROR_INVALID_REFERENCE);
    }


    @Test
    @DisplayName("G31: 上游凭证未配置 → provider_credential_missing")
    void missingCredential() {
        mockClaim(Map.of("prompt", "hello", "model_id", "gpt-image-1"));
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(mockCapability("gpt-image-1"));

        when(upstreamCredential.requireKey())
                .thenThrow(new IllegalStateException(
                        "上游凭证未配置：请在管理端「系统设置 → 上游凭证」填入 new-api 的项目统一 key"));
        processor.handle("100");

        verifyFailWithCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }


    @Test
    @DisplayName("G32: gpt 渠道映射失败 → invalid_reference_type")
    void channelMappingFailed() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1",
                "size", "nonexistent", "aspect_ratio", "99:1"));
        mockClaim(input);

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        cap.setChannel("gpt-image");
        cap.setRequestMapping("{\"matrix\":{}}");
        cap.setDefaultSize("default-size");
        cap.setDefaultAspectRatio("1:1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(upstreamCredential.requireKey()).thenReturn("token");

        processor.handle("100");

        verifyFailWithCode(GenerationError.ERROR_INVALID_REFERENCE_TYPE);
    }


    @Test
    @DisplayName("G33: provider 返回 0 张 → no_result")
    void noResult() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1"));
        mockClaim(input);

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(upstreamCredential.requireKey()).thenReturn("token");
        when(imageClient.generate(anyString(), any(ImageProtocol.class), anyString(),
                anyString(), anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList()))
                .thenReturn(List.of());

        processor.handle("100");

        verifyFailWithCode(GenerationError.ERROR_NO_RESULT);
    }


    @Test
    @DisplayName("G40: 成功路径把 TOS 出口的 md5 透传进 createAsset（IKGS73）")
    void successCarriesMd5() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1"));
        mockClaim(input);

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(upstreamCredential.requireKey()).thenReturn("token");
        when(imageClient.generate(anyString(), any(ImageProtocol.class), anyString(),
                anyString(), anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList()))
                .thenReturn(List.of(new GeneratedImage(
                        null, "abc".getBytes(java.nio.charset.StandardCharsets.UTF_8),
                        "image/png", 1, 1, "req-1")));
        when(tosService.uploadImageBytes(any(), anyString(), anyString()))
                .thenReturn(new TosMediaStorage.UploadResult(
                        "https://tos/i.png", "uploads/1/image/i.png", "image/png", 3L,
                        "0123456789abcdef0123456789abcdef"));
        when(stateMachine.createAsset(any())).thenReturn("a1");

        processor.handle("100");

        ArgumentCaptor<JobStateMachineService.CreateAssetInput> captor =
                ArgumentCaptor.forClass(JobStateMachineService.CreateAssetInput.class);
        verify(stateMachine).createAsset(captor.capture());
        assertThat(captor.getValue().md5()).isEqualTo("0123456789abcdef0123456789abcdef");
    }


    @Test
    @DisplayName("G34: provider_failed + retry<3 → requeue 30s backoff")
    void transientRetry_requeue30s() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1"));
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 0, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(upstreamCredential.requireKey()).thenReturn("token");
        when(imageClient.generate(anyString(), any(ImageProtocol.class), anyString(),
                anyString(), anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList()))
                .thenThrow(new ImageProviderError(
                        GenerationError.ERROR_PROVIDER_FAILED, "network error"));
        when(stateMachine.requeueImageJobForRetry(eq("100"), any(LocalDateTime.class)))
                .thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<LocalDateTime> captor = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(stateMachine).requeueImageJobForRetry(eq("100"), captor.capture());
        LocalDateTime nextActionAt = captor.getValue();
        assertThat(nextActionAt).isAfter(LocalDateTime.now().plusSeconds(25));
        assertThat(nextActionAt).isBefore(LocalDateTime.now().plusSeconds(35));

        verify(finalizer, never()).failJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("G35: provider_failed + retry_count=1 → requeue 60s backoff")
    void transientRetry_requeue60s() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1"));
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 1, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(upstreamCredential.requireKey()).thenReturn("token");
        when(imageClient.generate(anyString(), any(ImageProtocol.class), anyString(),
                anyString(), anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList()))
                .thenThrow(new ImageProviderError(
                        GenerationError.ERROR_PROVIDER_FAILED, "network error"));
        when(stateMachine.requeueImageJobForRetry(eq("100"), any(LocalDateTime.class)))
                .thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<LocalDateTime> captor = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(stateMachine).requeueImageJobForRetry(eq("100"), captor.capture());
        LocalDateTime nextActionAt = captor.getValue();
        assertThat(nextActionAt).isAfter(LocalDateTime.now().plusSeconds(55));
        assertThat(nextActionAt).isBefore(LocalDateTime.now().plusSeconds(65));
    }

    @Test
    @DisplayName("G36: provider_failed + retry_count=2 → requeue 120s backoff")
    void transientRetry_requeue120s() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1"));
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 2, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(upstreamCredential.requireKey()).thenReturn("token");
        when(imageClient.generate(anyString(), any(ImageProtocol.class), anyString(),
                anyString(), anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList()))
                .thenThrow(new ImageProviderError(
                        GenerationError.ERROR_PROVIDER_FAILED, "network error"));
        when(stateMachine.requeueImageJobForRetry(eq("100"), any(LocalDateTime.class)))
                .thenReturn(true);

        processor.handle("100");

        ArgumentCaptor<LocalDateTime> captor = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(stateMachine).requeueImageJobForRetry(eq("100"), captor.capture());
        LocalDateTime nextActionAt = captor.getValue();
        assertThat(nextActionAt).isAfter(LocalDateTime.now().plusSeconds(115));
        assertThat(nextActionAt).isBefore(LocalDateTime.now().plusSeconds(125));
    }

    @Test
    @DisplayName("G37: provider_failed + retry_count>=3 → fail (max exceeded)")
    void transientRetry_maxExceeded_fail() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1"));
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 3, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(upstreamCredential.requireKey()).thenReturn("token");
        when(imageClient.generate(anyString(), any(ImageProtocol.class), anyString(),
                anyString(), anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList()))
                .thenThrow(new ImageProviderError(
                        GenerationError.ERROR_PROVIDER_FAILED, "network error"));

        processor.handle("100");

        verify(stateMachine, never()).requeueImageJobForRetry(anyString(), any(LocalDateTime.class));
        verifyFailWithCode(GenerationError.ERROR_PROVIDER_FAILED);
    }

    @Test
    @DisplayName("G38: content_rejected（非瞬态）→ fail 不 requeue")
    void contentRejected_noRequeue() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1"));
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 0, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(upstreamCredential.requireKey()).thenReturn("token");
        when(imageClient.generate(anyString(), any(ImageProtocol.class), anyString(),
                anyString(), anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList()))
                .thenThrow(new ImageProviderError(
                        GenerationError.ERROR_CONTENT_REJECTED, "copyright"));

        processor.handle("100");

        verify(stateMachine, never()).requeueImageJobForRetry(anyString(), any(LocalDateTime.class));
        verifyFailWithCode(GenerationError.ERROR_CONTENT_REJECTED);
    }


    @Test
    @DisplayName("imageRetryBackoffMs: 30/60/120 封顶 300")
    void backoffSchedule() {
        assertThat(ImageJobProcessor.imageRetryBackoffMs(0)).isEqualTo(30_000L);
        assertThat(ImageJobProcessor.imageRetryBackoffMs(1)).isEqualTo(60_000L);
        assertThat(ImageJobProcessor.imageRetryBackoffMs(2)).isEqualTo(120_000L);
        assertThat(ImageJobProcessor.imageRetryBackoffMs(3)).isEqualTo(240_000L);
        assertThat(ImageJobProcessor.imageRetryBackoffMs(4)).isEqualTo(300_000L);
        assertThat(ImageJobProcessor.imageRetryBackoffMs(10)).isEqualTo(300_000L);
    }


    @Test
    @DisplayName("positiveDimension: 正有限数 round，否则 null")
    void positiveDimension() {
        assertThat(ImageJobProcessor.positiveDimension(100)).isEqualTo(100);
        assertThat(ImageJobProcessor.positiveDimension(null)).isNull();
        assertThat(ImageJobProcessor.positiveDimension(0)).isNull();
        assertThat(ImageJobProcessor.positiveDimension(-1)).isNull();
    }


    private void mockClaim(Map<String, Object> input) {
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 0, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));
    }

    private GenerationModelCapabilityEntity mockCapability(String modelId) {
        GenerationModelCapabilityEntity cap = new GenerationModelCapabilityEntity();
        cap.setModelId(modelId);
        cap.setApiSize("1024x1024");
        cap.setWidth(1024);
        cap.setHeight(1024);
        cap.setCapabilityType("image");
        cap.setChannel("seedream-image");
        cap.setFeatures("{\"imageReferenceMax\": 10}");
        return cap;
    }

    private com.bluewhale.worker.domain.entity.AssetEntity mockAsset(String id, String type) {
        var asset = new com.bluewhale.worker.domain.entity.AssetEntity();
        asset.setId(Long.parseLong(id));
        asset.setType(type);
        asset.setUrl("https://example.com/" + id + ".jpg");
        return asset;
    }

    private void verifyFailWithCode(String expectedCode) {
        ArgumentCaptor<String> codeCaptor = ArgumentCaptor.forClass(String.class);
        verify(finalizer).failJob(anyString(), codeCaptor.capture(), anyString(),
                any(Map.class), anyString(), anyLong());
        assertThat(codeCaptor.getValue()).isEqualTo(expectedCode);
    }

    @Test
    @DisplayName("G49b: cancelRequested → 走 cancelJobBeforeDispatch（终态 cancelled），不再 failJob")
    void cancelRequested() {
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", Map.of(), 0, true, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        processor.handle("100");

        verify(stateMachine).cancelJobBeforeDispatch(eq("100"), anyString(), eq(1L));
        verify(finalizer, never()).failJob(anyString(), anyString(), anyString(),
                any(Map.class), anyString(), anyLong());
    }
}
