package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedJobDto;
import com.bluewhale.worker.domain.entity.GenerationModelCapabilityEntity;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageProviderError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient;
import com.bluewhale.worker.infrastructure.gateway.ImageProtocol;
import com.bluewhale.worker.infrastructure.gateway.NewApiImageClient.GeneratedImage;
import com.bluewhale.worker.infrastructure.mapper.GenerationModelCapabilityMapper;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import com.bluewhale.worker.application.service.WorkerClock;
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

/**
 * 图片处理器错误映射测试（generation-worker.ts 附录 A image 行号逐字对齐）。
 * <p>
 * 覆盖：
 * - invalid_input（:303）：缺少 prompt 或 model_id
 * - model_unavailable（:338）：capability 缺失
 * - invalid_reference（:349/362）：参考图数量超限 / 素材不存在
 * - invalid_reference_type（:537/550）：渠道映射失败
 * - provider_credential_missing（:502）：凭证缺失
 * - unsupported_input（:558）：参考图无 URL
 * - no_result（:600）：provider 返回 0 张
 * - provider_failed（:687）：provider 抛错 → 瞬态重试或终态
 */
@ExtendWith(MockitoExtension.class)
class ImageJobProcessorErrorMappingTest {

    @Mock private JobStateMachineService stateMachine;
    @Mock private AssetSourceService assetSource;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiImageClient imageClient;
    @Mock private GenerationModelCapabilityMapper capabilityMapper;
    @Mock private TosMediaStorage tosService;

    private ImageJobProcessor processor;

    @BeforeEach
    void setUp() {
        processor = new ImageJobProcessor(
                stateMachine, assetSource, credentialService,
                imageClient, capabilityMapper, tosService);
    }

    // ========== invalid_input（:303） ==========

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

    // ========== model_unavailable（:338） ==========

    @Test
    @DisplayName("G28: capability 缺失 → model_unavailable")
    void modelUnavailable() {
        mockClaim(Map.of("prompt", "hello", "model_id", "unknown-model"));
        when(capabilityMapper.findByModelId("unknown-model")).thenReturn(null);

        processor.handle("100");

        verifyFailWithCode(GenerationError.ERROR_MODEL_UNAVAILABLE);
    }

    // ========== invalid_reference（:349） ==========

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

    // ========== invalid_reference（:362） ==========

    @Test
    @DisplayName("G30: 参考素材不存在 → invalid_reference")
    void referenceAssetMissing() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1",
                "input_asset_ids", List.of("1", "2")));
        mockClaim(input);

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        // 只解析到 1 个（另一个不存在）
        when(assetSource.resolveInputAssets(anyList(), anyString(), anyString()))
                .thenReturn(Map.of("1", mockAsset("1", "image")));

        processor.handle("100");

        verifyFailWithCode(GenerationError.ERROR_INVALID_REFERENCE);
    }

    // ========== provider_credential_missing（:502） ==========

    @Test
    @DisplayName("G31: 缺少凭证 → provider_credential_missing")
    void missingCredential() {
        mockClaim(Map.of("prompt", "hello", "model_id", "gpt-image-1"));
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(mockCapability("gpt-image-1"));

        processor.handle("100");

        verifyFailWithCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }

    // ========== invalid_reference_type（:537） ==========

    @Test
    @DisplayName("G32: gpt 渠道映射失败 → invalid_reference_type")
    void channelMappingFailed() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1",
                "size", "nonexistent", "aspect_ratio", "99:1",
                "provider_credential", "sealed-token"));
        mockClaim(input);

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        cap.setChannelParser("gpt");
        cap.setRequestMapping("{\"matrix\":{}}");
        cap.setDefaultSize("default-size");
        cap.setDefaultAspectRatio("1:1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(credentialService.open("sealed-token")).thenReturn("token");

        processor.handle("100");

        verifyFailWithCode(GenerationError.ERROR_INVALID_REFERENCE_TYPE);
    }

    // ========== no_result（:600） ==========

    @Test
    @DisplayName("G33: provider 返回 0 张 → no_result")
    void noResult() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1",
                "provider_credential", "sealed-token"));
        mockClaim(input);

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(credentialService.open("sealed-token")).thenReturn("token");
        when(imageClient.generate(anyString(), any(ImageProtocol.class), anyString(),
                anyString(), anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList()))
                .thenReturn(List.of());

        processor.handle("100");

        verifyFailWithCode(GenerationError.ERROR_NO_RESULT);
    }

    // ========== IKGS73：成功路径的 md5 透传 ==========
    //
    // 放在本类而不是新建测试类：走到 createAsset 所需的 stub 链（claim / capability / credential /
    // provider）全在这里，另起一个类要么复制这套 helper、要么把它抽成共享基类，代价都比收益大。
    // 本类名里的「ErrorMapping」因此不再完全准确——但测试的归属该由 stub 复杂度决定，不由类名决定。

    @Test
    @DisplayName("G40: 成功路径把 TOS 出口的 md5 透传进 createAsset（IKGS73）")
    void successCarriesMd5() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1",
                "provider_credential", "sealed-token"));
        mockClaim(input);

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(credentialService.open("sealed-token")).thenReturn("token");
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

        // image 是生成量最大的类型，而它的 createAsset 入参此前没有任何断言——md5 在这一层
        // 被吞掉时全套测试仍然绿。这条把它钉住。
        ArgumentCaptor<JobStateMachineService.CreateAssetInput> captor =
                ArgumentCaptor.forClass(JobStateMachineService.CreateAssetInput.class);
        verify(stateMachine).createAsset(captor.capture());
        assertThat(captor.getValue().md5()).isEqualTo("0123456789abcdef0123456789abcdef");
    }

    // ========== 瞬态重试（:705-725） ==========

    @Test
    @DisplayName("G34: provider_failed + retry<3 → requeue 30s backoff")
    void transientRetry_requeue30s() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1",
                "provider_credential", "sealed-token"));
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 1, 0, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(credentialService.open("sealed-token")).thenReturn("token");
        when(imageClient.generate(anyString(), any(ImageProtocol.class), anyString(),
                anyString(), anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList()))
                .thenThrow(new ImageProviderError(
                        GenerationError.ERROR_PROVIDER_FAILED, "network error"));
        when(stateMachine.requeueImageJobForRetry(eq("100"), any(LocalDateTime.class)))
                .thenReturn(true);

        processor.handle("100");

        // 验证 requeue 被调用（30s backoff for retry_count=0）
        ArgumentCaptor<LocalDateTime> captor = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(stateMachine).requeueImageJobForRetry(eq("100"), captor.capture());
        LocalDateTime nextActionAt = captor.getValue();
        // nextActionAt ≈ now + 30s
        assertThat(nextActionAt).isAfter(WorkerClock.now().plusSeconds(25));
        assertThat(nextActionAt).isBefore(WorkerClock.now().plusSeconds(35));

        // 不应调用 failJob
        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(),
                any(), anyString(), anyLong());
    }

    @Test
    @DisplayName("G35: provider_failed + retry_count=1 → requeue 60s backoff")
    void transientRetry_requeue60s() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1",
                "provider_credential", "sealed-token"));
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 1, 1, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(credentialService.open("sealed-token")).thenReturn("token");
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
        // nextActionAt ≈ now + 60s
        assertThat(nextActionAt).isAfter(WorkerClock.now().plusSeconds(55));
        assertThat(nextActionAt).isBefore(WorkerClock.now().plusSeconds(65));
    }

    @Test
    @DisplayName("G36: provider_failed + retry_count=2 → requeue 120s backoff")
    void transientRetry_requeue120s() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1",
                "provider_credential", "sealed-token"));
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 1, 2, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(credentialService.open("sealed-token")).thenReturn("token");
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
        // nextActionAt ≈ now + 120s
        assertThat(nextActionAt).isAfter(WorkerClock.now().plusSeconds(115));
        assertThat(nextActionAt).isBefore(WorkerClock.now().plusSeconds(125));
    }

    @Test
    @DisplayName("G37: provider_failed + retry_count>=3 → fail (max exceeded)")
    void transientRetry_maxExceeded_fail() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1",
                "provider_credential", "sealed-token"));
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 1, 3, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(credentialService.open("sealed-token")).thenReturn("token");
        when(imageClient.generate(anyString(), any(ImageProtocol.class), anyString(),
                anyString(), anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList()))
                .thenThrow(new ImageProviderError(
                        GenerationError.ERROR_PROVIDER_FAILED, "network error"));

        processor.handle("100");

        // 不调用 requeue（max exceeded）
        verify(stateMachine, never()).requeueImageJobForRetry(anyString(), any(LocalDateTime.class));
        // 调用 failJob
        verifyFailWithCode(GenerationError.ERROR_PROVIDER_FAILED);
    }

    @Test
    @DisplayName("G38: content_rejected（非瞬态）→ fail 不 requeue")
    void contentRejected_noRequeue() {
        Map<String, Object> input = new HashMap<>(Map.of(
                "prompt", "hello", "model_id", "gpt-image-1",
                "provider_credential", "sealed-token"));
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 1, 0, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));

        GenerationModelCapabilityEntity cap = mockCapability("gpt-image-1");
        when(capabilityMapper.findByModelId("gpt-image-1")).thenReturn(cap);
        when(credentialService.open("sealed-token")).thenReturn("token");
        when(imageClient.generate(anyString(), any(ImageProtocol.class), anyString(),
                anyString(), anyInt(), any(), any(), anyBoolean(), anyBoolean(), anyList()))
                .thenThrow(new ImageProviderError(
                        GenerationError.ERROR_CONTENT_REJECTED, "copyright"));

        processor.handle("100");

        verify(stateMachine, never()).requeueImageJobForRetry(anyString(), any(LocalDateTime.class));
        verifyFailWithCode(GenerationError.ERROR_CONTENT_REJECTED);
    }

    // ========== 退避公式测试 ==========

    @Test
    @DisplayName("imageRetryBackoffMs: 30/60/120 封顶 300")
    void backoffSchedule() {
        assertThat(ImageJobProcessor.imageRetryBackoffMs(0)).isEqualTo(30_000L);
        assertThat(ImageJobProcessor.imageRetryBackoffMs(1)).isEqualTo(60_000L);
        assertThat(ImageJobProcessor.imageRetryBackoffMs(2)).isEqualTo(120_000L);
        assertThat(ImageJobProcessor.imageRetryBackoffMs(3)).isEqualTo(240_000L);
        assertThat(ImageJobProcessor.imageRetryBackoffMs(4)).isEqualTo(300_000L); // 封顶
        assertThat(ImageJobProcessor.imageRetryBackoffMs(10)).isEqualTo(300_000L);
    }

    // ========== positiveDimension ==========

    @Test
    @DisplayName("positiveDimension: 正有限数 round，否则 null")
    void positiveDimension() {
        assertThat(ImageJobProcessor.positiveDimension(100)).isEqualTo(100);
        assertThat(ImageJobProcessor.positiveDimension(null)).isNull();
        assertThat(ImageJobProcessor.positiveDimension(0)).isNull();
        assertThat(ImageJobProcessor.positiveDimension(-1)).isNull();
    }

    // ========== 辅助方法 ==========

    private void mockClaim(Map<String, Object> input) {
        ClaimedJobDto job = new ClaimedJobDto(
                "100", "1", "1", "image", input, 1, 0, false, 1L);
        when(stateMachine.claimImageJobById(eq("100"), anyString()))
                .thenReturn(Optional.of(job));
    }

    private GenerationModelCapabilityEntity mockCapability(String modelId) {
        GenerationModelCapabilityEntity cap = new GenerationModelCapabilityEntity();
        cap.setModelId(modelId);
        cap.setApiSize("1024x1024");
        cap.setWidth(1024);
        cap.setHeight(1024);
        cap.setChannelParser("seedream");
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
        verify(stateMachine).failJob(anyString(), codeCaptor.capture(), anyString(),
                any(Map.class), anyString(), anyLong());
        assertThat(codeCaptor.getValue()).isEqualTo(expectedCode);
    }
}
