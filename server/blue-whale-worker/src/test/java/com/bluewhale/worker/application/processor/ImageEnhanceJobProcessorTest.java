package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.PublishImageEnhanceDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.contract.ImageEnhanceContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageEnhanceError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitClient;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.storage.TosMediaStorage;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * ImageEnhanceJobProcessor 单测（契约 §14.5 / IKGM9D）。
 * <p>
 * 覆盖：input 冻结六键兜底校验、源素材/凭证缺失分类、错误码归一（§5 信号保留、
 * 其余归 image_enhance_failed，无自动重试）、成功链（经 mock 客户端拿到本地结果图 URL →
 * 下载 → TOS 转存 → publishImageEnhanceResult payload）、claim 异常上抛语义。
 * 不连真实 MQ/DB/TOS/网关（结果图用本地 HttpServer 桩）。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ImageEnhanceJobProcessorTest {

    /** 1x1 PNG（ImageIO 可解析，宽高断言用）。 */
    private static final byte[] PNG_1X1 = Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    @Mock private JobStateMachineService stateMachine;
    @Mock private JobClaimService claimService;
    @Mock private GenerationJobMapper jobMapper;
    @Mock private AssetMapper assetMapper;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiMediaKitClient mediaKitClient;
    @Mock private TosMediaStorage tosService;

    private ImageEnhanceJobProcessor processor;
    private HttpServer resultServer;
    private String resultUrl;

    @BeforeEach
    void setUp() throws Exception {
        processor = new ImageEnhanceJobProcessor(
                stateMachine, claimService, jobMapper,
                new AssetSourceService(assetMapper),
                credentialService, mediaKitClient, tosService);
        when(stateMachine.failJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong()))
                .thenReturn(true);

        // 结果图桩（24h 有效的火山 URL 用本地 HttpServer 模拟）
        resultServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        resultServer.createContext("/enhanced.png", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "image/png");
            exchange.sendResponseHeaders(200, PNG_1X1.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(PNG_1X1);
            }
        });
        resultServer.start();
        resultUrl = "http://127.0.0.1:" + resultServer.getAddress().getPort() + "/enhanced.png";
    }

    @AfterEach
    void tearDown() {
        resultServer.stop(0);
    }

    private ClaimedJob makeClaim(Map<String, Object> input) {
        return new ClaimedJob("100", "42", "9", input, "image_enhance",
                null, false, "worker-1", 5L, 0, 0, null, null, null);
    }

    private Map<String, Object> validInput() {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("target_node_id", "node-abc");
        input.put("version_tier", "max");
        input.put("multiple", 4);
        input.put("generative_enhance_mode", "fidelity_first");
        input.put("enable_correct_color", false);
        input.put("provider_credential", "sk-frozen-token");
        return input;
    }

    private void stubSourceAsset() {
        AssetEntity source = new AssetEntity();
        source.setType("image");
        source.setUrl("https://example.com/src.png");
        source.setStorageKey("uploads/9/image/src.png");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(source);
    }

    private void stubClaim(Map<String, Object> input) {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input)));
        when(credentialService.open("sk-frozen-token")).thenReturn("sk-frozen-token");
    }

    private void assertFailCode(String expectedCode) {
        verify(stateMachine).failJob(eq("100"), eq(expectedCode), anyString(),
                any(), eq("worker-1"), eq(5L));
    }

    // ========== claim 语义（IKC9EJ 同构） ==========

    @Test
    @DisplayName("claim 抛 DB 异常 → 上抛（不 fail job，不 ack → 重投）")
    void claimThrowsDbError_propagates() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString()))
                .thenThrow(new RuntimeException("DB connection refused"));

        Throwable thrown = catchThrowable(() -> processor.handle("100"));

        assertThat(thrown).hasMessageContaining("DB connection refused");
        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领 / 重复唤醒）")
    void claimReturnsEmpty_silentReturn() {
        when(claimService.claim(any(ClaimSpec.class), eq("100"), anyString())).thenReturn(Optional.empty());

        processor.handle("100");

        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(stateMachine, never()).publishImageEnhanceResult(any());
    }

    // ========== input 冻结六键兜底校验（§14.2；权威复核在创建入口 IKGM99） ==========

    @Test
    @DisplayName("缺 source_asset_id → invalid_input")
    void missingSourceAssetId_invalidInput() {
        Map<String, Object> input = validInput();
        input.remove("source_asset_id");
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("version_tier 非枚举值 → invalid_input")
    void invalidTier_invalidInput() {
        Map<String, Object> input = validInput();
        input.put("version_tier", "standard");
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("multiple 不在 2/4/6 → invalid_input")
    void invalidMultiple_invalidInput() {
        Map<String, Object> input = validInput();
        input.put("multiple", 3);
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    // ========== 源素材与凭证 ==========

    @Test
    @DisplayName("源素材不可用 → image_enhance_failed + 可读原因")
    void sourceAssetUnavailable_enhanceFailed() {
        stubClaim(validInput());
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(null);

        processor.handle("100");

        assertFailCode(ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED);
        verify(mediaKitClient, never()).enhance(anyString(), anyString(), anyString(), anyInt(),
                any(), any());
    }

    @Test
    @DisplayName("源素材非图片 → image_enhance_failed")
    void sourceAssetNotImage_enhanceFailed() {
        stubClaim(validInput());
        AssetEntity source = new AssetEntity();
        source.setType("video");
        source.setUrl("https://example.com/src.mp4");
        source.setStorageKey("uploads/9/video/src.mp4");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(source);

        processor.handle("100");

        assertFailCode(ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED);
    }

    @Test
    @DisplayName("缺冻结凭证 → provider_credential_missing（与 image/audio 同构）")
    void missingCredential_credentialMissing() {
        Map<String, Object> input = validInput();
        input.remove("provider_credential");
        stubClaim(input);
        stubSourceAsset();

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }

    // ========== 错误码归一（§14.5：§5 信号保留，其余归 image_enhance_failed；无自动重试） ==========

    @Test
    @DisplayName("客户端 content_rejected → 保留既有码投影（§5 信号）")
    void contentRejected_preserved() {
        Map<String, Object> input = validInput();
        stubClaim(input);
        stubSourceAsset();
        when(mediaKitClient.enhance(anyString(), anyString(), anyString(), anyInt(), any(), any()))
                .thenThrow(new ImageEnhanceError(GenerationError.ERROR_CONTENT_REJECTED,
                        "高清放大失败: HTTP 400 sensitive content"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_CONTENT_REJECTED);
        verify(stateMachine, never()).requeueImageJobForRetry(anyString(), any());
    }

    @Test
    @DisplayName("客户端 quota_exhausted → 保留既有码投影（§5 信号）")
    void quotaExhausted_preserved() {
        stubClaim(validInput());
        stubSourceAsset();
        when(mediaKitClient.enhance(anyString(), anyString(), anyString(), anyInt(), any(), any()))
                .thenThrow(new ImageEnhanceError(GenerationError.ERROR_QUOTA_EXHAUSTED,
                        "高清放大失败: HTTP 402 剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("客户端 provider_failed → 归并 image_enhance_failed（兜底，无自动重试）")
    void providerFailed_normalizedToEnhanceFailed() {
        stubClaim(validInput());
        stubSourceAsset();
        when(mediaKitClient.enhance(anyString(), anyString(), anyString(), anyInt(), any(), any()))
                .thenThrow(new ImageEnhanceError(GenerationError.ERROR_PROVIDER_FAILED,
                        "高清放大失败: HTTP 400 缺少可用渠道"));

        processor.handle("100");

        assertFailCode(ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED);
        verify(stateMachine, never()).requeueImageJobForRetry(anyString(), any());
    }

    @Test
    @DisplayName("客户端超时（provider_timeout）→ 归并 image_enhance_failed（不重试）")
    void providerTimeout_normalizedToEnhanceFailed() {
        stubClaim(validInput());
        stubSourceAsset();
        when(mediaKitClient.enhance(anyString(), anyString(), anyString(), anyInt(), any(), any()))
                .thenThrow(new ImageEnhanceError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 高清放大超时"));

        processor.handle("100");

        assertFailCode(ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED);
    }

    // ========== 成功链（下载落库 + Asset 创建 + 终态事件） ==========

    @Test
    @DisplayName("成功链：版本档映射与能力裁剪出站 → 下载结果图 → TOS 转存 → 发布 payload 带宽高")
    void successChain_mapsTierDownloadsAndPublishes() {
        stubClaim(validInput());
        stubSourceAsset();
        when(mediaKitClient.enhance(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq("max"), eq(4), eq("fidelity_first"), eq(false)))
                .thenReturn(new NewApiMediaKitClient.EnhanceResult(resultUrl));
        when(tosService.uploadImageBytes(any(), eq("image/png"), eq("9")))
                .thenReturn(new TosMediaStorage.UploadResult(
                        "https://tos/enhanced.png", "uploads/9/image/enhanced.png", "image/png", PNG_1X1.length, "0123456789abcdef0123456789abcdef"));
        when(stateMachine.publishImageEnhanceResult(any())).thenReturn(true);

        processor.handle("100");

        // 出站映射：max→max，max 档两高级参数都发（精确 matcher 的 stub 未命中会返回 null → NPE，故等价于断言）
        verify(mediaKitClient).enhance(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq("max"), eq(4), eq("fidelity_first"), eq(false));
        ArgumentCaptor<PublishImageEnhanceDto> captor = ArgumentCaptor.forClass(PublishImageEnhanceDto.class);
        verify(stateMachine).publishImageEnhanceResult(captor.capture());
        PublishImageEnhanceDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/enhanced.png");
        assertThat(published.storageKey()).isEqualTo("uploads/9/image/enhanced.png");
        assertThat(published.mime()).isEqualTo("image/png");
        assertThat(published.size()).isEqualTo(PNG_1X1.length);
        assertThat(published.width()).isEqualTo(1);
        assertThat(published.height()).isEqualTo(1);
        // IKGS73：md5 必须从 stored 穿透到发布入参。没有这条，processor 哪天传了 null，
        // 全套测试照样绿，而 assets.md5 会静默变空 —— 正是本单要消灭的那类失效。
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("lite 档出站裁剪：tool_version=standard 且两高级参数传 null（不发键）")
    void liteTierOutboundCropped() {
        Map<String, Object> input = validInput();
        input.put("version_tier", "lite");
        input.put("generative_enhance_mode", "generative_first");
        input.put("enable_correct_color", true);
        stubClaim(input);
        stubSourceAsset();
        when(mediaKitClient.enhance(anyString(), anyString(), anyString(), anyInt(), isNull(), isNull()))
                .thenReturn(new NewApiMediaKitClient.EnhanceResult(resultUrl));
        when(tosService.uploadImageBytes(any(), anyString(), anyString()))
                .thenReturn(new TosMediaStorage.UploadResult(
                        "https://tos/e.png", "uploads/9/image/e.png", "image/png", PNG_1X1.length, "0123456789abcdef0123456789abcdef"));
        when(stateMachine.publishImageEnhanceResult(any())).thenReturn(true);

        processor.handle("100");

        // lite→standard + 能力矩阵裁剪（TIERS_WITH_ENHANCE_MODE / TIERS_WITH_CORRECT_COLOR 均不含 lite）
        verify(mediaKitClient).enhance(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq("standard"), eq(4), isNull(), isNull());
    }

    @Test
    @DisplayName("pro 档出站裁剪：professional + 发策略、不发色彩校正")
    void proTierOutboundCropped() {
        Map<String, Object> input = validInput();
        input.put("version_tier", "pro");
        input.put("enable_correct_color", true);
        stubClaim(input);
        stubSourceAsset();
        when(mediaKitClient.enhance(anyString(), anyString(), anyString(), anyInt(),
                eq("fidelity_first"), isNull()))
                .thenReturn(new NewApiMediaKitClient.EnhanceResult(resultUrl));
        when(tosService.uploadImageBytes(any(), anyString(), anyString()))
                .thenReturn(new TosMediaStorage.UploadResult(
                        "https://tos/e.png", "uploads/9/image/e.png", "image/png", PNG_1X1.length, "0123456789abcdef0123456789abcdef"));
        when(stateMachine.publishImageEnhanceResult(any())).thenReturn(true);

        processor.handle("100");

        verify(mediaKitClient).enhance(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq("professional"), eq(4), eq("fidelity_first"), isNull());
    }

    @Test
    @DisplayName("结果图下载 404 → image_enhance_failed，不转存不发布")
    void resultDownloadFails_enhanceFailed() {
        resultServer.removeContext("/enhanced.png");
        resultServer.createContext("/enhanced.png", exchange -> {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
        });
        stubClaim(validInput());
        stubSourceAsset();
        when(mediaKitClient.enhance(anyString(), anyString(), anyString(), anyInt(), any(), any()))
                .thenReturn(new NewApiMediaKitClient.EnhanceResult(resultUrl));

        processor.handle("100");

        assertFailCode(ImageEnhanceContract.ERROR_IMAGE_ENHANCE_FAILED);
        verify(tosService, never()).uploadImageBytes(any(), anyString(), anyString());
        verify(stateMachine, never()).publishImageEnhanceResult(any());
    }

    @Test
    @DisplayName("publish 守卫未命中（stale worker）→ 不抛错不落失败终态")
    void publishGuardMissed_noFailure() {
        stubClaim(validInput());
        stubSourceAsset();
        when(mediaKitClient.enhance(anyString(), anyString(), anyString(), anyInt(), any(), any()))
                .thenReturn(new NewApiMediaKitClient.EnhanceResult(resultUrl));
        when(tosService.uploadImageBytes(any(), anyString(), anyString()))
                .thenReturn(new TosMediaStorage.UploadResult(
                        "https://tos/e.png", "uploads/9/image/e.png", "image/png", PNG_1X1.length, "0123456789abcdef0123456789abcdef"));
        when(stateMachine.publishImageEnhanceResult(any())).thenReturn(false);

        processor.handle("100");

        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }
}
