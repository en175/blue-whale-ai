package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedImageOutpaintJobDto;
import com.bluewhale.worker.domain.dto.PublishImageOutpaintDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.ImageOutpaintContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageOutpaintError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitOutpaintClient;
import com.bluewhale.worker.infrastructure.mapper.AssetMapper;
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
 * ImageOutpaintJobProcessor 单测（IKGOQW，以 ImageEnhanceJobProcessorTest 为模板）。
 * <p>
 * 覆盖：input 冻结键兜底校验（source_asset_id / 四个 expand 值域）、源素材/凭证缺失分类、
 * 错误码归一（§5 信号保留、其余归 image_outpaint_failed，无自动重试）、成功链
 * （mock 客户端拿到本地结果图 URL → 下载 → TOS 转存 → publishImageOutpaintResult payload）、
 * claim 异常上抛语义。不连真实 MQ/DB/TOS/网关（结果图用本地 HttpServer 桩）。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ImageOutpaintJobProcessorTest {

    /** 1x1 PNG（ImageIO 可解析，宽高断言用）。 */
    private static final byte[] PNG_1X1 = Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    @Mock private JobStateMachineService stateMachine;
    @Mock private AssetMapper assetMapper;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiMediaKitOutpaintClient mediaKitClient;
    @Mock private TosMediaStorage tosService;

    private ImageOutpaintJobProcessor processor;
    private HttpServer resultServer;
    private String resultUrl;

    @BeforeEach
    void setUp() throws Exception {
        processor = new ImageOutpaintJobProcessor(
                stateMachine, new AssetSourceService(assetMapper),
                credentialService, mediaKitClient, tosService);
        when(stateMachine.failJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong()))
                .thenReturn(true);

        // 结果图桩（24h 有效的火山 URL 用本地 HttpServer 模拟）
        resultServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        resultServer.createContext("/expanded.png", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "image/png");
            exchange.sendResponseHeaders(200, PNG_1X1.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(PNG_1X1);
            }
        });
        resultServer.start();
        resultUrl = "http://127.0.0.1:" + resultServer.getAddress().getPort() + "/expanded.png";
    }

    @AfterEach
    void tearDown() {
        resultServer.stop(0);
    }

    private ClaimedImageOutpaintJobDto makeClaim(Map<String, Object> input) {
        return new ClaimedImageOutpaintJobDto("100", "42", "9", input, "worker-1", 5L);
    }

    private Map<String, Object> validInput() {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("target_node_id", "node-abc");
        input.put("expand_top", 0.1);
        input.put("expand_bottom", 0.0);
        input.put("expand_left", 0.25);
        input.put("expand_right", 0.4);
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
        when(stateMachine.claimImageOutpaint(eq("100"), anyString()))
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
        when(stateMachine.claimImageOutpaint(eq("100"), anyString()))
                .thenThrow(new RuntimeException("DB connection refused"));

        Throwable thrown = catchThrowable(() -> processor.handle("100"));

        assertThat(thrown).hasMessageContaining("DB connection refused");
        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领 / 重复唤醒）")
    void claimReturnsEmpty_silentReturn() {
        when(stateMachine.claimImageOutpaint(eq("100"), anyString())).thenReturn(Optional.empty());

        processor.handle("100");

        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(stateMachine, never()).publishImageOutpaintResult(any());
    }

    // ========== input 冻结键兜底校验（创建入口复核是权威，worker 兜底防御） ==========

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
    @DisplayName("expand_top 缺失 → invalid_input")
    void missingExpandRatio_invalidInput() {
        Map<String, Object> input = validInput();
        input.remove("expand_top");
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("expand_left 超 0.4 值域 → invalid_input")
    void expandRatioOutOfRange_invalidInput() {
        Map<String, Object> input = validInput();
        input.put("expand_left", 0.5);
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("expand_bottom 非数值 → invalid_input")
    void expandRatioNotNumber_invalidInput() {
        Map<String, Object> input = validInput();
        input.put("expand_bottom", "wide");
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    // ========== 源素材与凭证 ==========

    @Test
    @DisplayName("源素材不可用 → image_outpaint_failed + 可读原因")
    void sourceAssetUnavailable_outpaintFailed() {
        stubClaim(validInput());
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(null);

        processor.handle("100");

        assertFailCode(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED);
        verify(mediaKitClient, never()).expandImageCanvas(anyString(), anyString(),
                anyDouble(), anyDouble(), anyDouble(), anyDouble());
    }

    @Test
    @DisplayName("源素材非图片 → image_outpaint_failed")
    void sourceAssetNotImage_outpaintFailed() {
        stubClaim(validInput());
        AssetEntity source = new AssetEntity();
        source.setType("video");
        source.setUrl("https://example.com/src.mp4");
        source.setStorageKey("uploads/9/video/src.mp4");
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(source);

        processor.handle("100");

        assertFailCode(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED);
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

    // ========== 错误码归一（§5 信号保留，其余归 image_outpaint_failed；无自动重试） ==========

    @Test
    @DisplayName("客户端 content_rejected → 保留既有码投影（§5 信号）")
    void contentRejected_preserved() {
        stubClaim(validInput());
        stubSourceAsset();
        when(mediaKitClient.expandImageCanvas(anyString(), anyString(),
                anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenThrow(new ImageOutpaintError(GenerationError.ERROR_CONTENT_REJECTED,
                        "智能扩图失败: HTTP 400 sensitive content"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_CONTENT_REJECTED);
        verify(stateMachine, never()).requeueImageJobForRetry(anyString(), any());
    }

    @Test
    @DisplayName("客户端 quota_exhausted → 保留既有码投影（§5 信号）")
    void quotaExhausted_preserved() {
        stubClaim(validInput());
        stubSourceAsset();
        when(mediaKitClient.expandImageCanvas(anyString(), anyString(),
                anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenThrow(new ImageOutpaintError(GenerationError.ERROR_QUOTA_EXHAUSTED,
                        "智能扩图失败: HTTP 402 剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("客户端 provider_failed（网关 400 缺渠道）→ 归并 image_outpaint_failed（兜底，无自动重试）")
    void providerFailed_normalizedToOutpaintFailed() {
        stubClaim(validInput());
        stubSourceAsset();
        when(mediaKitClient.expandImageCanvas(anyString(), anyString(),
                anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenThrow(new ImageOutpaintError(GenerationError.ERROR_PROVIDER_FAILED,
                        "智能扩图失败: HTTP 400 缺少可用渠道"));

        processor.handle("100");

        assertFailCode(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED);
        verify(stateMachine, never()).requeueImageJobForRetry(anyString(), any());
    }

    @Test
    @DisplayName("客户端超时（provider_timeout）→ 归并 image_outpaint_failed（不重试）")
    void providerTimeout_normalizedToOutpaintFailed() {
        stubClaim(validInput());
        stubSourceAsset();
        when(mediaKitClient.expandImageCanvas(anyString(), anyString(),
                anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenThrow(new ImageOutpaintError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 智能扩图超时"));

        processor.handle("100");

        assertFailCode(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED);
    }

    // ========== 成功链（下载落库 + Asset 创建 + 终态事件） ==========

    @Test
    @DisplayName("成功链：四个 expand 值原样出站 → 下载结果图 → TOS 转存 → 发布 payload 带宽高")
    void successChain_mapsRatiosDownloadsAndPublishes() {
        stubClaim(validInput());
        stubSourceAsset();
        when(mediaKitClient.expandImageCanvas(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq(0.1), eq(0.0), eq(0.25), eq(0.4)))
                .thenReturn(new NewApiMediaKitOutpaintClient.OutpaintResult(resultUrl));
        when(tosService.uploadImageBytes(any(), eq("image/png"), eq("9")))
                .thenReturn(new TosMediaStorage.UploadResult(
                        "https://tos/expanded.png", "uploads/9/image/expanded.png", "image/png", PNG_1X1.length,
                        "md5-expanded"));
        when(stateMachine.publishImageOutpaintResult(any())).thenReturn(true);

        processor.handle("100");

        // 出站映射：image_url = 源素材公网地址；四值与冻结输入一致（精确 matcher 的 stub
        // 未命中会返回 null → NPE，故等价于断言）
        verify(mediaKitClient).expandImageCanvas(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq(0.1), eq(0.0), eq(0.25), eq(0.4));
        ArgumentCaptor<PublishImageOutpaintDto> captor =
                ArgumentCaptor.forClass(PublishImageOutpaintDto.class);
        verify(stateMachine).publishImageOutpaintResult(captor.capture());
        PublishImageOutpaintDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/expanded.png");
        assertThat(published.storageKey()).isEqualTo("uploads/9/image/expanded.png");
        assertThat(published.mime()).isEqualTo("image/png");
        assertThat(published.size()).isEqualTo(PNG_1X1.length);
        // IKGS73：产物 md5 自 TOS 上传出口透传进发布 DTO（落 assets.md5 供去重）
        assertThat(published.md5()).isEqualTo("md5-expanded");
        assertThat(published.width()).isEqualTo(1);
        assertThat(published.height()).isEqualTo(1);
        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("结果图下载 404 → image_outpaint_failed，不转存不发布")
    void resultDownloadFails_outpaintFailed() {
        resultServer.removeContext("/expanded.png");
        resultServer.createContext("/expanded.png", exchange -> {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
        });
        stubClaim(validInput());
        stubSourceAsset();
        when(mediaKitClient.expandImageCanvas(anyString(), anyString(),
                anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenReturn(new NewApiMediaKitOutpaintClient.OutpaintResult(resultUrl));

        processor.handle("100");

        assertFailCode(ImageOutpaintContract.ERROR_IMAGE_OUTPAINT_FAILED);
        verify(tosService, never()).uploadImageBytes(any(), anyString(), anyString());
        verify(stateMachine, never()).publishImageOutpaintResult(any());
    }

    @Test
    @DisplayName("publish 守卫未命中（stale worker）→ 不抛错不落失败终态")
    void publishGuardMissed_noFailure() {
        stubClaim(validInput());
        stubSourceAsset();
        when(mediaKitClient.expandImageCanvas(anyString(), anyString(),
                anyDouble(), anyDouble(), anyDouble(), anyDouble()))
                .thenReturn(new NewApiMediaKitOutpaintClient.OutpaintResult(resultUrl));
        when(tosService.uploadImageBytes(any(), anyString(), anyString()))
                .thenReturn(new TosMediaStorage.UploadResult(
                        "https://tos/e.png", "uploads/9/image/e.png", "image/png", PNG_1X1.length, "md5-stub"));
        when(stateMachine.publishImageOutpaintResult(any())).thenReturn(false);

        processor.handle("100");

        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }
}
