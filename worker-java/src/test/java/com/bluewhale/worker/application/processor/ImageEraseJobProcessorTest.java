package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.domain.dto.ClaimedImageEraseJobDto;
import com.bluewhale.worker.domain.dto.PublishImageEraseDto;
import com.bluewhale.worker.domain.entity.AssetEntity;
import com.bluewhale.worker.domain.entity.ImageEraseContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.ImageEraseError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitEraseClient;
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
 * ImageEraseJobProcessor 单测（契约 §15.5 / IKGOT6）。
 * <p>
 * 覆盖：input 业务键与场景-遮罩组合兜底校验、源/遮罩素材与凭证缺失分类、错误码归一
 * （§5 信号保留、其余归 image_erase_failed，无自动重试）、两场景成功链（出站参数映射 →
 * 经 mock 客户端拿到本地结果图 URL → 下载 → TOS 转存 → publishImageEraseResult payload）、
 * claim 异常上抛语义。不连真实 MQ/DB/TOS/网关（结果图用本地 HttpServer 桩）。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ImageEraseJobProcessorTest {

    /** 1x1 PNG（ImageIO 可解析，宽高断言用）。 */
    private static final byte[] PNG_1X1 = Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    @Mock private JobStateMachineService stateMachine;
    @Mock private AssetMapper assetMapper;
    @Mock private GenerationCredentialService credentialService;
    @Mock private NewApiMediaKitEraseClient mediaKitEraseClient;
    @Mock private TosMediaStorage tosService;

    private ImageEraseJobProcessor processor;
    private HttpServer resultServer;
    private String resultUrl;

    @BeforeEach
    void setUp() throws Exception {
        processor = new ImageEraseJobProcessor(
                stateMachine, new AssetSourceService(assetMapper),
                credentialService, mediaKitEraseClient, tosService);
        when(stateMachine.failJob(anyString(), anyString(), anyString(), any(), anyString(), anyLong()))
                .thenReturn(true);

        // 结果图桩（24h 有效的火山 URL 用本地 HttpServer 模拟）
        resultServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        resultServer.createContext("/erased.png", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "image/png");
            exchange.sendResponseHeaders(200, PNG_1X1.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(PNG_1X1);
            }
        });
        resultServer.start();
        resultUrl = "http://127.0.0.1:" + resultServer.getAddress().getPort() + "/erased.png";
    }

    @AfterEach
    void tearDown() {
        resultServer.stop(0);
    }

    private ClaimedImageEraseJobDto makeClaim(Map<String, Object> input) {
        return new ClaimedImageEraseJobDto("100", "42", "9", input, "worker-1", 5L);
    }

    private Map<String, Object> textSceneInput() {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("target_node_id", "node-abc");
        input.put("erase_scene", "full_screen_text_erase");
        input.put("provider_credential", "sk-frozen-token");
        return input;
    }

    private Map<String, Object> areaSceneInput() {
        Map<String, Object> input = new HashMap<>();
        input.put("source_asset_id", "555");
        input.put("target_node_id", "node-abc");
        input.put("erase_scene", "selected_area_erase");
        input.put("mask_asset_id", "777");
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

    private void stubMaskAsset() {
        AssetEntity mask = new AssetEntity();
        mask.setType("image");
        mask.setUrl("https://example.com/mask.png");
        mask.setStorageKey("uploads/9/image/mask.png");
        when(assetMapper.resolveSourceAssetWithLinked(eq(777L), eq(9L), eq(42L), anyList()))
                .thenReturn(mask);
    }

    private void stubClaim(Map<String, Object> input) {
        when(stateMachine.claimImageErase(eq("100"), anyString()))
                .thenReturn(Optional.of(makeClaim(input)));
        when(credentialService.open("sk-frozen-token")).thenReturn("sk-frozen-token");
    }

    private void stubPublish() {
        when(tosService.uploadImageBytes(any(), anyString(), eq("9")))
                .thenReturn(new TosMediaStorage.UploadResult(
                        "https://tos/erased.png", "uploads/9/image/erased.png", "image/png", PNG_1X1.length, "0123456789abcdef0123456789abcdef"));
        when(stateMachine.publishImageEraseResult(any())).thenReturn(true);
    }

    private void assertFailCode(String expectedCode) {
        verify(stateMachine).failJob(eq("100"), eq(expectedCode), anyString(),
                any(), eq("worker-1"), eq(5L));
    }

    // ========== claim 语义（IKC9EJ 同构） ==========

    @Test
    @DisplayName("claim 抛 DB 异常 → 上抛（不 fail job，不 ack → 重投）")
    void claimThrowsDbError_propagates() {
        when(stateMachine.claimImageErase(eq("100"), anyString()))
                .thenThrow(new RuntimeException("DB connection refused"));

        Throwable thrown = catchThrowable(() -> processor.handle("100"));

        assertThat(thrown).hasMessageContaining("DB connection refused");
        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("claim 返回空 → 静默返回（无可认领 / 重复唤醒）")
    void claimReturnsEmpty_silentReturn() {
        when(stateMachine.claimImageErase(eq("100"), anyString())).thenReturn(Optional.empty());

        processor.handle("100");

        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
        verify(stateMachine, never()).publishImageEraseResult(any());
    }

    // ========== input 业务键与场景-遮罩组合兜底校验（§15.2；权威复核在创建入口 IKGOT4） ==========

    @Test
    @DisplayName("缺 source_asset_id → invalid_input")
    void missingSourceAssetId_invalidInput() {
        Map<String, Object> input = textSceneInput();
        input.remove("source_asset_id");
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("erase_scene 非枚举值 → invalid_input")
    void invalidScene_invalidInput() {
        Map<String, Object> input = textSceneInput();
        input.put("erase_scene", "full_screen_icon_erase");
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("full_screen_text_erase 带 mask_asset_id → invalid_input（契约 strict 分支禁填）")
    void textSceneWithMask_invalidInput() {
        Map<String, Object> input = textSceneInput();
        input.put("mask_asset_id", "777");
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    @Test
    @DisplayName("selected_area_erase 缺 mask_asset_id → invalid_input")
    void areaSceneWithoutMask_invalidInput() {
        Map<String, Object> input = areaSceneInput();
        input.remove("mask_asset_id");
        stubClaim(input);

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_INVALID_INPUT);
    }

    // ========== 源素材 / 遮罩素材与凭证 ==========

    @Test
    @DisplayName("源素材不可用 → image_erase_failed + 可读原因")
    void sourceAssetUnavailable_eraseFailed() {
        stubClaim(textSceneInput());
        when(assetMapper.resolveSourceAssetWithLinked(eq(555L), eq(9L), eq(42L), anyList()))
                .thenReturn(null);

        processor.handle("100");

        assertFailCode(ImageEraseContract.ERROR_IMAGE_ERASE_FAILED);
        verify(mediaKitEraseClient, never()).erase(anyString(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("selected_area_erase 遮罩素材不可用 → image_erase_failed")
    void maskAssetUnavailable_eraseFailed() {
        stubClaim(areaSceneInput());
        stubSourceAsset();
        when(assetMapper.resolveSourceAssetWithLinked(eq(777L), eq(9L), eq(42L), anyList()))
                .thenReturn(null);

        processor.handle("100");

        assertFailCode(ImageEraseContract.ERROR_IMAGE_ERASE_FAILED);
        verify(mediaKitEraseClient, never()).erase(anyString(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("缺冻结凭证 → provider_credential_missing（与 image/imageEnhance 同构）")
    void missingCredential_credentialMissing() {
        Map<String, Object> input = textSceneInput();
        input.remove("provider_credential");
        stubClaim(input);
        stubSourceAsset();

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING);
    }

    // ========== 错误码归一（§15.5：§5 信号保留，其余归 image_erase_failed；无自动重试） ==========

    @Test
    @DisplayName("客户端 content_rejected → 保留既有码投影（§5 信号）")
    void contentRejected_preserved() {
        stubClaim(textSceneInput());
        stubSourceAsset();
        when(mediaKitEraseClient.erase(anyString(), anyString(), anyString(), any()))
                .thenThrow(new ImageEraseError(GenerationError.ERROR_CONTENT_REJECTED,
                        "图片擦除失败: HTTP 400 sensitive content"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_CONTENT_REJECTED);
    }

    @Test
    @DisplayName("客户端 quota_exhausted → 保留既有码投影（§5 信号）")
    void quotaExhausted_preserved() {
        stubClaim(textSceneInput());
        stubSourceAsset();
        when(mediaKitEraseClient.erase(anyString(), anyString(), anyString(), any()))
                .thenThrow(new ImageEraseError(GenerationError.ERROR_QUOTA_EXHAUSTED,
                        "图片擦除失败: HTTP 402 剩余额度不足"));

        processor.handle("100");

        assertFailCode(GenerationError.ERROR_QUOTA_EXHAUSTED);
    }

    @Test
    @DisplayName("客户端 provider_failed → 归并 image_erase_failed（兜底，无自动重试）")
    void providerFailed_normalizedToEraseFailed() {
        stubClaim(textSceneInput());
        stubSourceAsset();
        when(mediaKitEraseClient.erase(anyString(), anyString(), anyString(), any()))
                .thenThrow(new ImageEraseError(GenerationError.ERROR_PROVIDER_FAILED,
                        "图片擦除失败: HTTP 400 缺少可用渠道"));

        processor.handle("100");

        assertFailCode(ImageEraseContract.ERROR_IMAGE_ERASE_FAILED);
    }

    @Test
    @DisplayName("客户端超时（provider_timeout）→ 归并 image_erase_failed（不重试）")
    void providerTimeout_normalizedToEraseFailed() {
        stubClaim(textSceneInput());
        stubSourceAsset();
        when(mediaKitEraseClient.erase(anyString(), anyString(), anyString(), any()))
                .thenThrow(new ImageEraseError(GenerationError.ERROR_PROVIDER_TIMEOUT,
                        "MediaKit 图片擦除超时"));

        processor.handle("100");

        assertFailCode(ImageEraseContract.ERROR_IMAGE_ERASE_FAILED);
    }

    // ========== 两场景成功链（§15.3 出站映射 + §15.5 回填：下载 → TOS → 发布 payload 带宽高） ==========

    @Test
    @DisplayName("full_screen_text_erase 成功链：出站不带 mask → 下载结果图 → TOS 转存 → 发布 payload 带宽高")
    void textSceneSuccessChain() {
        stubClaim(textSceneInput());
        stubSourceAsset();
        when(mediaKitEraseClient.erase(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq("full_screen_text_erase"), isNull()))
                .thenReturn(new NewApiMediaKitEraseClient.EraseResult(resultUrl));
        stubPublish();

        processor.handle("100");

        // 出站映射：text 场景 maskUrl=null（客户端不发 mask_url 键）
        verify(mediaKitEraseClient).erase(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq("full_screen_text_erase"), isNull());
        ArgumentCaptor<PublishImageEraseDto> captor = ArgumentCaptor.forClass(PublishImageEraseDto.class);
        verify(stateMachine).publishImageEraseResult(captor.capture());
        PublishImageEraseDto published = captor.getValue();
        assertThat(published.url()).isEqualTo("https://tos/erased.png");
        assertThat(published.storageKey()).isEqualTo("uploads/9/image/erased.png");
        assertThat(published.mime()).isEqualTo("image/png");
        assertThat(published.size()).isEqualTo(PNG_1X1.length);
        assertThat(published.width()).isEqualTo(1);
        assertThat(published.height()).isEqualTo(1);
        // IKGS73：md5 必须从 stored 穿透到发布入参。没有这条，processor 哪天传了 null，
        // 全套测试照样绿，而 assets.md5 会静默变空 —— 正是本单要消灭的那类失效。
        // （已实测：去掉 ImageEraseJobProcessor 里的 stored.md5() 后，本文件 17 条全绿。）
        assertThat(published.md5()).isEqualTo("0123456789abcdef0123456789abcdef");
        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("selected_area_erase 成功链：出站 maskUrl=遮罩素材公网地址 → 发布 payload")
    void areaSceneSuccessChain() {
        stubClaim(areaSceneInput());
        stubSourceAsset();
        stubMaskAsset();
        when(mediaKitEraseClient.erase(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq("selected_area_erase"), eq("https://example.com/mask.png")))
                .thenReturn(new NewApiMediaKitEraseClient.EraseResult(resultUrl));
        stubPublish();

        processor.handle("100");

        // 出站映射：area 场景 maskUrl=遮罩 Asset url（落库即 TOS public-read）
        verify(mediaKitEraseClient).erase(eq("sk-frozen-token"), eq("https://example.com/src.png"),
                eq("selected_area_erase"), eq("https://example.com/mask.png"));
        verify(stateMachine).publishImageEraseResult(any());
        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }

    @Test
    @DisplayName("结果图下载 404 → image_erase_failed，不转存不发布")
    void resultDownloadFails_eraseFailed() {
        resultServer.removeContext("/erased.png");
        resultServer.createContext("/erased.png", exchange -> {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
        });
        stubClaim(textSceneInput());
        stubSourceAsset();
        when(mediaKitEraseClient.erase(anyString(), anyString(), anyString(), any()))
                .thenReturn(new NewApiMediaKitEraseClient.EraseResult(resultUrl));

        processor.handle("100");

        assertFailCode(ImageEraseContract.ERROR_IMAGE_ERASE_FAILED);
        verify(tosService, never()).uploadImageBytes(any(), anyString(), anyString());
        verify(stateMachine, never()).publishImageEraseResult(any());
    }

    @Test
    @DisplayName("publish 守卫未命中（stale worker）→ 不抛错不落失败终态")
    void publishGuardMissed_noFailure() {
        stubClaim(textSceneInput());
        stubSourceAsset();
        when(mediaKitEraseClient.erase(anyString(), anyString(), anyString(), any()))
                .thenReturn(new NewApiMediaKitEraseClient.EraseResult(resultUrl));
        when(tosService.uploadImageBytes(any(), anyString(), anyString()))
                .thenReturn(new TosMediaStorage.UploadResult(
                        "https://tos/e.png", "uploads/9/image/e.png", "image/png", PNG_1X1.length, "0123456789abcdef0123456789abcdef"));
        when(stateMachine.publishImageEraseResult(any())).thenReturn(false);

        processor.handle("100");

        verify(stateMachine, never()).failJob(anyString(), anyString(), anyString(), any(),
                anyString(), anyLong());
    }
}
